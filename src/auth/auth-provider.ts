/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GaxiosError } from 'gaxios';
import { OAuth2Client } from 'google-auth-library';
import fetch from 'node-fetch';
import { v4 as uuid } from 'uuid';
import vscode, {
  AuthenticationProvider,
  AuthenticationProviderAuthenticationSessionsChangeEvent,
  AuthenticationProviderSessionOptions,
  AuthenticationSession,
  Disposable,
  Event,
  EventEmitter,
} from 'vscode';
import { z } from 'zod';
import { AUTHORIZATION_HEADER } from '../colab/headers';
import { log } from '../common/logging';
import { Toggleable } from '../common/toggleable';
import { telemetry } from '../telemetry';
import { Credentials } from './login';
import { AuthStorage, RefreshableAuthenticationSession } from './storage';

export const REQUIRED_SCOPES = [
  'profile',
  'email',
  'https://www.googleapis.com/auth/colaboratory',
] as const;
const PROVIDER_ID = 'google';
const PROVIDER_LABEL = 'Google';
const REFRESH_MARGIN_MS = 5 * 60 * 1000; // 5 minutes

/**
 * An {@link Event} which fires when an authentication session is added,
 * removed, or changed.
 */
export interface AuthChangeEvent
  extends AuthenticationProviderAuthenticationSessionsChangeEvent {
  /**
   * True when there is a valid {@link AuthenticationSession} for the
   * {@link AuthenticationProvider}.
   */
  hasValidSession: boolean;
}

/**
 * Provides authentication using Google OAuth2.
 *
 * Registers itself with the VS Code authentication API and emits events when
 * authentication sessions change.
 *
 * Session access tokens are refreshed JIT upon access if they are near or past
 * their expiry.
 */
export class GoogleAuthProvider implements AuthenticationProvider, Disposable {
  readonly onDidChangeSessions: Event<AuthChangeEvent>;
  private isInitialized = false;
  private authProvider?: Disposable;
  private readonly emitter: EventEmitter<AuthChangeEvent>;
  private session?: Readonly<AuthenticationSession>;
  private readonly disposeController = new AbortController();
  private readonly disposeSignal: AbortSignal = this.disposeController.signal;

  /**
   * Initializes the GoogleAuthProvider.
   *
   * @param vs - The VS Code API.
   * @param storage - Persistent storage for refresh tokens and session metadata
   * @param oAuth2Client - The OAuth2 client for handling Google authentication
   * @param login - A function that initiates the login process with the
   * specified scopes.
   */
  constructor(
    private readonly vs: typeof vscode,
    private readonly storage: AuthStorage,
    private readonly oAuth2Client: OAuth2Client,
    private readonly login: (scopes: string[]) => Promise<Credentials>,
  ) {
    this.emitter = new vs.EventEmitter<AuthChangeEvent>();
    this.onDidChangeSessions = this.emitter.event;

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
  ): Promise<AuthenticationSession> {
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
    this.authProvider?.dispose();
    this.disposeController.abort(new Error('GoogleAuthProvider was disposed.'));
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
    const record = await this.storage.getSession(REQUIRED_SCOPES);
    if (!record) {
      this.isInitialized = true;
      this.register();
      return;
    }
    this.oAuth2Client.setCredentials({
      refresh_token: record.refreshToken,
      token_type: 'Bearer',
      scope: record.scopes.join(' '),
    });
    try {
      await this.oAuth2Client.refreshAccessToken();
    } catch (err: unknown) {
      const { shouldClearSession, reason } =
        this.shouldClearSessionOnRefreshError(err);
      if (shouldClearSession) {
        log.warn(`${reason}. Clearing session.`, err);
        await this.storage.removeSession(record.id);
        await this.initialize();
        return;
      }
      log.error('Unable to refresh access token', err);
      throw err;
    }
    const accessToken = this.oAuth2Client.credentials.access_token;
    if (!accessToken) {
      throw new Error('Failed to refresh Google OAuth token.');
    }
    const updatedSession = this.updateSession(record, accessToken);
    this.isInitialized = true;
    this.notifySessionChanged(updatedSession);
    this.register();
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
      if (!this.hasSessionForScopes(REQUIRED_SCOPES)) {
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
    options: AuthenticationProviderSessionOptions,
  ): Promise<AuthenticationSession[]> {
    this.assertReady();
    if (scopes && !matchesScopes(scopes, REQUIRED_SCOPES)) {
      return [];
    }
    let candidates = this.listSessions();
    if (scopes) {
      candidates = candidates.filter((s) => matchesScopes(s.scopes, scopes));
    }
    if (options.account) {
      candidates = candidates.filter(
        (s) => s.account.id === options.account?.id,
      );
    }
    const sessions: AuthenticationSession[] = [];
    for (const session of candidates) {
      try {
        sessions.push(await this.refreshSessionIfNeeded(session));
      } catch (err: unknown) {
        const { shouldClearSession, reason } =
          this.shouldClearSessionOnRefreshError(err);
        if (shouldClearSession) {
          log.warn(`${reason}. Clearing session.`, err);
          if (session.id) {
            await this.removeSession(session.id);
          }
        } else {
          log.error('Unable to refresh access token', err);
          sessions.push(session);
        }
      }
    }

    return sessions;
  }

  /**
   * Creates and stores an authentication session with the given scopes.
   *
   * @param scopes - Scopes required for the session. These must strictly be the
   * collection of {@link REQUIRED_SCOPES}.
   * @returns The created session.
   * @throws An error if login fails.
   */
  async createSession(scopes: string[]): Promise<AuthenticationSession> {
    this.assertReady();
    try {
      const sortedScopes = scopes.sort();
      if (!matchesScopes(sortedScopes, REQUIRED_SCOPES)) {
        throw new Error(
          `Only supports the following scopes: ${sortedScopes.join(', ')}`,
        );
      }
      const tokenInfo = await this.login(sortedScopes);
      const user = await this.getUserInfo(tokenInfo.access_token);
      const existingRecord = await this.storage.getSession(scopes);
      const newRecord: RefreshableAuthenticationSession = {
        id: existingRecord ? existingRecord.id : uuid(),
        refreshToken: tokenInfo.refresh_token,
        account: {
          id: user.email,
          label: user.name,
        },
        scopes: sortedScopes,
      };
      await this.storage.storeSession(newRecord);
      this.oAuth2Client.setCredentials(tokenInfo);
      const session = this.updateSession(newRecord, tokenInfo.access_token);
      if (existingRecord) {
        this.notifySessionChanged(session);
      } else {
        this.notifySessionAdded(session);
      }
      this.vs.window.showInformationMessage('Signed in to Google!');
      return session;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown error';
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
    const removedSession = this.getSession(sessionId);
    if (!removedSession) {
      return;
    }
    this.deleteSession(sessionId);
    try {
      await this.oAuth2Client.revokeCredentials();
    } catch {
      // It's possible the token is already expired or revoked. We can swallow
      // errors since the user will be required to login again.
    }
    await this.storage.removeSession(sessionId);
    this.notifySessionRemoved(removedSession);
  }

  async signOut() {
    if (!this.hasSessions()) {
      return;
    }
    telemetry.logSignOut();
    const sessions = this.listSessions();
    for (const session of sessions) {
      await this.removeSession(session.id);
    }
  }

  private register() {
    this.authProvider = this.vs.authentication.registerAuthenticationProvider(
      PROVIDER_ID,
      PROVIDER_LABEL,
      this,
      { supportsMultipleAccounts: false },
    );
  }

  private async setSignedInContext() {
    await this.vs.commands.executeCommand(
      'setContext',
      'colab.isSignedIn',
      !!this.hasSessions(),
    );
  }

  private shouldClearSessionOnRefreshError(err: unknown): {
    shouldClearSession: boolean;
    reason: string;
  } {
    if (isInvalidGrantError(err)) {
      return {
        shouldClearSession: true,
        reason: 'OAuth app access to Colab was revoked.',
      };
    }
    // This should only ever be the case when developer building from source
    if (isOAuthClientSwitchedError(err)) {
      return {
        shouldClearSession: true,
        reason: 'The configured OAuth client has changed',
      };
    }
    return { shouldClearSession: false, reason: '' };
  }

  private async refreshSessionIfNeeded(
    session: AuthenticationSession,
  ): Promise<AuthenticationSession> {
    const expiryDateMs = this.oAuth2Client.credentials.expiry_date;
    if (expiryDateMs && expiryDateMs > Date.now() + REFRESH_MARGIN_MS) {
      return session;
    }
    await this.oAuth2Client.refreshAccessToken();
    const accessToken = this.oAuth2Client.credentials.access_token;
    if (!accessToken) {
      throw new Error('Failed to refresh Google OAuth token.');
    }

    return this.updateSession(session, accessToken);
  }

  private async getUserInfo(
    token: string,
  ): Promise<z.infer<typeof UserInfoSchema>> {
    const url = 'https://www.googleapis.com/oauth2/v2/userinfo';
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

  private listSessions(): AuthenticationSession[] {
    return this.session ? [this.session] : [];
  }

  private hasSessions(): boolean {
    return this.session !== undefined;
  }

  private hasSessionForScopes(scopes: readonly string[]): boolean {
    if (matchesScopes(scopes, REQUIRED_SCOPES)) {
      return this.hasSessions();
    }
    return false;
  }

  private getSession(id: string): AuthenticationSession | undefined {
    if (this.session?.id === id) {
      return this.session;
    }
    return undefined;
  }

  private updateSession(
    record: AuthenticationSession | RefreshableAuthenticationSession,
    accessToken: string,
  ): AuthenticationSession {
    this.session = {
      id: record.id,
      accessToken,
      account: record.account,
      scopes: record.scopes,
    };
    return this.session;
  }

  private deleteSession(id: string) {
    if (this.session?.id === id) {
      this.session = undefined;
    }
  }

  private notifySessionAdded(session: AuthenticationSession) {
    this.emitter.fire({
      added: [session],
      removed: [],
      changed: [],
      hasValidSession: true,
    });
  }

  private notifySessionChanged(session: AuthenticationSession) {
    this.emitter.fire({
      added: [],
      removed: [],
      changed: [session],
      hasValidSession: true,
    });
  }

  private notifySessionRemoved(session: AuthenticationSession) {
    this.emitter.fire({
      added: [],
      removed: [session],
      changed: [],
      hasValidSession: this.hasSessions(),
    });
  }
}

function matchesScopes(
  scopes: readonly string[],
  scopesToMatch: readonly string[],
): boolean {
  return (
    scopes.length === scopesToMatch.length &&
    scopesToMatch.every((r) => scopes.includes(r))
  );
}

function isInvalidGrantError(err: unknown): boolean {
  return (
    err instanceof GaxiosError &&
    err.status === 400 &&
    err.message.includes('invalid_grant')
  );
}

function isOAuthClientSwitchedError(err: unknown): boolean {
  return err instanceof GaxiosError && err.status === 401;
}

/**
 * User information queried for following a successful login.
 */
const UserInfoSchema = z.object({
  name: z.string(),
  email: z.string(),
});
