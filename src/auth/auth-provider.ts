/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GaxiosError } from "gaxios";
import { OAuth2Client } from "google-auth-library";
import fetch from "node-fetch";
import { v4 as uuid } from "uuid";
import vscode, { AuthenticationSession, Disposable } from "vscode";
import { z } from "zod";
import { AUTHORIZATION_HEADER } from "../colab/headers";
import { log } from "../common/logging";
import { Toggleable } from "../common/toggleable";
import { Credentials } from "./login";
import { AuthStorage, RefreshableAuthenticationSession } from "./storage";

export const REQUIRED_SCOPES = [
  "profile",
  "email",
  "https://www.googleapis.com/auth/colaboratory",
] as const;
const PROVIDER_ID = "google";
const PROVIDER_LABEL = "Google";
const REFRESH_MARGIN_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Provides authentication using Google OAuth2.
 *
 * Registers itself with the VS Code authentication API and emits events when
 * authentication sessions change.
 *
 * Session access tokens are refreshed JIT upon access if they are near or past
 * their expiry.
 */
export class GoogleAuthProvider
  implements vscode.AuthenticationProvider, vscode.Disposable
{
  readonly onDidChangeSessions: vscode.Event<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>;
  private isInitialized = false;
  private readonly authProvider: vscode.Disposable;
  private readonly emitter: vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>;
  private session?: Readonly<AuthenticationSession>;
  private readonly disposeController = new AbortController();
  private readonly disposeSignal: AbortSignal = this.disposeController.signal;

  /**
   * Initializes the GoogleAuthProvider.
   *
   * @param vs - The VS Code API.
   * @param context - The extension context used for managing lifecycle.
   * @param oAuth2Client - The OAuth2 client for handling Google authentication.
   * @param codeProvider - The provider responsible for generating authorization
   * codes.
   * @param login - A function that initiates the login process with the
   * specified scopes.
   */
  constructor(
    private readonly vs: typeof vscode,
    private readonly storage: AuthStorage,
    private readonly oAuth2Client: OAuth2Client,
    private readonly login: (scopes: string[]) => Promise<Credentials>,
  ) {
    this.emitter =
      new vs.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
    this.onDidChangeSessions = this.emitter.event;

    this.authProvider = this.vs.authentication.registerAuthenticationProvider(
      PROVIDER_ID,
      PROVIDER_LABEL,
      this,
      { supportsMultipleAccounts: false },
    );

    this.onDidChangeSessions(() => {
      void this.setSignedInContext();
    });
  }

  /**
   * Retrieves the Google OAuth2 authentication session.
   *
   * @param vs - The VS Code API.
   * @returns The authentication session.
   */
  static async getOrCreateSession(
    vs: typeof vscode,
  ): Promise<vscode.AuthenticationSession> {
    const session = await vs.authentication.getSession(
      PROVIDER_ID,
      REQUIRED_SCOPES,
      {
        createIfNone: true,
      },
    );
    return session;
  }

  /**
   * Disposes the provider and cleans up resources.
   */
  dispose() {
    this.authProvider.dispose();
    this.disposeController.abort(new Error("GoogleAuthProvider was disposed."));
  }

  /**
   * Initializes the provider by loading the session from storage, saturating
   * and refreshing the OAuth2 client.
   */
  async initialize() {
    if (this.disposeSignal.aborted) {
      throw this.disposeSignal.reason;
    }
    if (this.isInitialized) {
      return;
    }
    const session = await this.storage.getSession();
    if (!session) {
      this.isInitialized = true;
      return;
    }
    this.oAuth2Client.setCredentials({
      refresh_token: session.refreshToken,
      token_type: "Bearer",
      scope: session.scopes.join(" "),
    });
    try {
      await this.oAuth2Client.refreshAccessToken();
    } catch (err: unknown) {
      let shouldClearSession = false;
      let reason = "";

      if (
        err instanceof GaxiosError &&
        err.status === 400 &&
        err.message.includes("invalid_grant")
      ) {
        reason = "OAuth app access to Colab was revoked";
        shouldClearSession = true;
      } else if (err instanceof GaxiosError && err.status === 401) {
        // This should only ever be the case when developer building from source
        // switches the OAuth client ID / secret.
        reason = "The configured OAuth client has changed";
        shouldClearSession = true;
      }

      if (shouldClearSession) {
        log.warn(`${reason}. Clearing session.`, err);
        await this.storage.removeSession(session.id);
        await this.initialize();
        return;
      }
      log.error("Unable to refresh access token", err);
      throw err;
    }
    const accessToken = this.oAuth2Client.credentials.access_token;
    if (!accessToken) {
      throw new Error("Failed to refresh Google OAuth token.");
    }
    this.session = {
      id: session.id,
      accessToken,
      account: session.account,
      scopes: session.scopes,
    };
    this.isInitialized = true;
    this.emitter.fire({
      added: [],
      removed: [],
      changed: [this.session],
    });
  }

  /**
   * Sets the state of the toggles based on the authentication session.
   *
   * @returns A {@link Disposable} that can be used to stop toggling the
   * provided toggles when there are changes to the authorization status.
   */
  whileAuthorized(...toggles: Toggleable[]): Disposable {
    this.assertReady();
    const setToggles = () => {
      if (this.session === undefined) {
        toggles.forEach((t) => {
          t.off();
        });
      } else {
        toggles.forEach((t) => {
          t.on();
        });
      }
    };
    const listener = this.onDidChangeSessions(setToggles);
    // Call the function initially to set the correct state.
    setToggles();
    return listener;
  }

  /**
   * Get the list of managed sessions.
   *
   * The session's access token is refreshed if it is near or past its expiry.
   *
   * @param scopes - An optional array of scopes. If provided, the sessions
   * returned will match these permissions. Otherwise, all sessions are
   * returned.
   * @param options - Additional options for getting sessions. If an account is
   * passed in, sessions returned are limited to it.
   * @returns An array of managed authentication sessions.
   */
  async getSessions(
    scopes: readonly string[] | undefined,
    options: vscode.AuthenticationProviderSessionOptions,
  ): Promise<vscode.AuthenticationSession[]> {
    this.assertReady();
    if (scopes && !matchesRequiredScopes(scopes)) {
      return [];
    }
    await this.refreshSessionIfNeeded();
    if (options.account && this.session?.account != options.account) {
      return [];
    }
    return this.session ? [this.session] : [];
  }

  /**
   * Creates and stores an authentication session with the given scopes.
   *
   * @param scopes - Scopes required for the session. These must strictly be the
   * collection of {@link REQUIRED_SCOPES}.
   * @returns The created session.
   * @throws An error if login fails.
   */
  async createSession(scopes: string[]): Promise<vscode.AuthenticationSession> {
    this.assertReady();
    try {
      const sortedScopes = scopes.sort();
      if (!matchesRequiredScopes(sortedScopes)) {
        throw new Error(
          `Only supports the following scopes: ${sortedScopes.join(", ")}`,
        );
      }
      const tokenInfo = await this.login(sortedScopes);
      const user = await this.getUserInfo(tokenInfo.access_token);
      const existingSession = await this.storage.getSession();
      const newSession: RefreshableAuthenticationSession = {
        id: existingSession ? existingSession.id : uuid(),
        refreshToken: tokenInfo.refresh_token,
        account: {
          id: user.email,
          label: user.name,
        },
        scopes: sortedScopes,
      };
      await this.storage.storeSession(newSession);
      this.oAuth2Client.setCredentials(tokenInfo);
      this.session = {
        id: newSession.id,
        accessToken: tokenInfo.access_token,
        account: newSession.account,
        scopes: sortedScopes,
      };

      if (existingSession) {
        this.emitter.fire({
          added: [],
          removed: [],
          changed: [this.session],
        });
      } else {
        this.emitter.fire({
          added: [this.session],
          removed: [],
          changed: [],
        });
      }
      this.vs.window.showInformationMessage("Signed in to Google!");
      return this.session;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "unknown error";
      this.vs.window.showErrorMessage(`Sign in failed: ${msg}`);
      throw err;
    }
  }

  /**
   * Removes a session by ID.
   *
   * This will revoke the credentials (if the matching session is managed) and
   * remove the session from storage.
   *
   * @param sessionId - The session ID.
   */
  async removeSession(sessionId: string): Promise<void> {
    this.assertReady();
    if (!this.session || this.session.id !== sessionId) {
      return;
    }
    const removedSession = this.session;
    this.session = undefined;
    try {
      await this.oAuth2Client.revokeCredentials();
    } catch {
      // It's possible the token is already expired or revoked. We can swallow
      // errors since the user will be required to login again.
    }
    await this.storage.removeSession(sessionId);

    this.emitter.fire({
      added: [],
      removed: [removedSession],
      changed: [],
    });
  }

  async signOut() {
    if (!this.session) {
      return;
    }
    await this.removeSession(this.session.id);
  }

  private async setSignedInContext() {
    await this.vs.commands.executeCommand(
      "setContext",
      "colab.isSignedIn",
      !!this.session,
    );
  }

  private async refreshSessionIfNeeded(): Promise<void> {
    if (!this.session) {
      return;
    }
    const expiryDateMs = this.oAuth2Client.credentials.expiry_date;
    if (expiryDateMs && expiryDateMs > Date.now() + REFRESH_MARGIN_MS) {
      return;
    }
    await this.oAuth2Client.refreshAccessToken();
    const accessToken = this.oAuth2Client.credentials.access_token;
    if (!accessToken) {
      throw new Error("Failed to refresh Google OAuth token.");
    }
    this.session = {
      ...this.session,
      accessToken,
    };
  }

  private async getUserInfo(
    token: string,
  ): Promise<z.infer<typeof UserInfoSchema>> {
    const url = "https://www.googleapis.com/oauth2/v2/userinfo";
    const response = await fetch(url, {
      headers: {
        [AUTHORIZATION_HEADER.key]: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch user info: ${response.statusText}. Response: ${errorText}`,
      );
    }
    const json: unknown = await response.json();
    return UserInfoSchema.parse(json);
  }

  private assertReady(): void {
    if (!this.isInitialized) {
      throw new Error(`Must call initialize() first.`);
    }
    if (this.disposeSignal.aborted) {
      throw this.disposeSignal.reason;
    }
  }
}

function matchesRequiredScopes(scopes: readonly string[]): boolean {
  return (
    scopes.length === REQUIRED_SCOPES.length &&
    REQUIRED_SCOPES.every((r) => scopes.includes(r))
  );
}

/**
 * User information queried for following a successful login.
 */
const UserInfoSchema = z.object({
  name: z.string(),
  email: z.string(),
});
