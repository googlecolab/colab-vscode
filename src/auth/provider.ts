import {
  OAuth2Client,
  CodeChallengeMethod,
  Credentials,
} from "google-auth-library";
import fetch from "node-fetch";
import { v4 as uuid } from "uuid";
import vscode, { AuthenticationSession } from "vscode";
import { z } from "zod";
import { PackageInfo } from "../config/package-info";
import { CodeProvider } from "./redirect";
import { AuthStorage, RefreshableAuthenticationSession } from "./storage";

export const REQUIRED_SCOPES = ["profile", "email"] as const;
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
  private readonly authProvider: vscode.Disposable;
  private readonly emitter: vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>;
  private session?: Readonly<AuthenticationSession>;
  private isInitialized = false;

  /**
   * Initializes the GoogleAuthProvider.
   *
   * @param vs - The VS Code API.
   * @param context - The extension context used for managing lifecycle.
   * @param oAuth2Client - The OAuth2 client for handling Google authentication.
   * @param codeProvider - The provider responsible for generating authorization
   * codes.
   */
  constructor(
    private readonly vs: typeof vscode,
    private readonly packageInfo: PackageInfo,
    private readonly storage: AuthStorage,
    private readonly oAuth2Client: OAuth2Client,
    private readonly codeProvider: CodeProvider,
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
   * Initializes the provider by loading the session from storage, saturating
   * and refreshing the OAuth2 client.
   */
  async initialize() {
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
    await this.oAuth2Client.refreshAccessToken();
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
  }

  /**
   * Disposes the provider and cleans up resources.
   */
  dispose() {
    this.authProvider.dispose();
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
    this.assertInitialized();
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
    this.assertInitialized();
    try {
      const sortedScopes = scopes.sort();
      if (!matchesRequiredScopes(sortedScopes)) {
        throw new Error(
          `Only supports the following scopes: ${sortedScopes.join(", ")}`,
        );
      }
      const tokenInfo = await this.login(sortedScopes.join(" "));
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

      return this.session;
    } catch (err: unknown) {
      let reason = "unknown error";
      if (err instanceof Error) {
        reason = err.message;
      }
      this.vs.window.showErrorMessage(`Sign in failed: ${reason}`);
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
    this.assertInitialized();
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

  private async login(scopes: string): Promise<DefinedCredentials> {
    const res = await this.vs.window.withProgress<DefinedCredentials>(
      {
        location: this.vs.ProgressLocation.Notification,
        title: "Signing in to Google...",
        cancellable: true,
      },
      async (_, cancel: vscode.CancellationToken) => {
        const nonce = uuid();
        const promisedCode = this.codeProvider.waitForCode(nonce, cancel);

        const callbackUri = await this.getCallbackUri(nonce);
        const pkce = await this.oAuth2Client.generateCodeVerifierAsync();
        const authorizeUrl = this.oAuth2Client.generateAuthUrl({
          access_type: "offline",
          response_type: "code",
          scope: scopes,
          state: callbackUri.toString(),
          prompt: "consent",
          code_challenge_method: CodeChallengeMethod.S256,
          code_challenge: pkce.codeChallenge,
        });

        await this.vs.env.openExternal(this.vs.Uri.parse(authorizeUrl));

        const code = await promisedCode;

        const tokenResponse = await this.oAuth2Client.getToken({
          code,
          codeVerifier: pkce.codeVerifier,
        });
        if (tokenResponse.res?.status !== 200) {
          const details = tokenResponse.res
            ? tokenResponse.res.statusText
            : "unknown error";
          throw new Error(`Failed to get token: ${details}`);
        }
        if (!isDefinedCredentials(tokenResponse.tokens)) {
          throw new Error("Missing credential information");
        }

        return tokenResponse.tokens;
      },
    );
    this.vs.window.showInformationMessage("Signed in to Google!");

    return res;
  }

  private async getCallbackUri(nonce: string): Promise<vscode.Uri> {
    const scheme = this.vs.env.uriScheme;
    const pub = this.packageInfo.publisher;
    const name = this.packageInfo.name;

    const uri = this.vs.Uri.parse(`${scheme}://${pub}.${name}?nonce=${nonce}`);

    return await this.vs.env.asExternalUri(uri);
  }

  private async getUserInfo(
    token: string,
  ): Promise<z.infer<typeof UserInfoSchema>> {
    const url = "https://www.googleapis.com/oauth2/v2/userinfo";
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
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

  private assertInitialized(): void {
    if (!this.isInitialized) {
      throw new Error(`Must call initialize() first.`);
    }
  }
}

function matchesRequiredScopes(scopes: readonly string[]): boolean {
  return (
    scopes.length === REQUIRED_SCOPES.length &&
    REQUIRED_SCOPES.every((r) => scopes.includes(r))
  );
}

type RequiredCredentials = Pick<
  Credentials,
  "refresh_token" | "access_token" | "expiry_date" | "scope"
>;

type DefinedCredentials = Credentials & {
  [P in keyof RequiredCredentials]-?: NonNullable<RequiredCredentials[P]>;
};

function isDefinedCredentials(
  credentials: Credentials,
): credentials is DefinedCredentials {
  return (
    credentials.refresh_token != null &&
    credentials.access_token != null &&
    credentials.expiry_date != null &&
    credentials.scope != null
  );
}

/**
 * User information queried for following a successful login.
 */
const UserInfoSchema = z.object({
  name: z.string(),
  email: z.string(),
});
