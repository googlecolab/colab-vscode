import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import fetch from "node-fetch";
import { v4 as uuid } from "uuid";
import vscode from "vscode";
import { z } from "zod";
import { PackageInfo } from "../config/package_info";
import { CodeProvider } from "./redirect";
import { AuthStorage } from "./storage";

const PROVIDER_ID = "google";
const PROVIDER_LABEL = "Google";
const REQUIRED_SCOPES = ["profile", "email"] as const;

/**
 * Provides authentication using Google OAuth2.
 *
 * Registers itself with the VS Code authentication API and emits events
 * when authentication sessions change.
 */
export class GoogleAuthProvider
  implements vscode.AuthenticationProvider, vscode.Disposable
{
  readonly onDidChangeSessions: vscode.Event<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>;
  private readonly authProvider: vscode.Disposable;
  private readonly emitter: vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>;

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
  static async getSession(
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
  }

  /**
   * Get a list of sessions.
   *
   * @param _scopes - Currently unused.
   * @param _options - Currently unused.
   * @returns An array of stored authentication sessions.
   */
  async getSessions(
    _scopes: readonly string[] | undefined,
    _options: vscode.AuthenticationProviderSessionOptions,
  ): Promise<vscode.AuthenticationSession[]> {
    const session = await this.storage.getSession();
    return session ? [session] : [];
  }

  /**
   * Creates and stores an authentication session with the given scopes.
   *
   * @param scopes - Scopes required for the session.
   * @returns The created session.
   * @throws An error if login fails.
   */
  async createSession(scopes: string[]): Promise<vscode.AuthenticationSession> {
    try {
      const scopeSet = new Set([...scopes, ...REQUIRED_SCOPES]);
      const sortedScopes = Array.from(scopeSet).sort();
      const token = await this.login(sortedScopes.join(" "));
      if (!token) {
        throw new Error("Google login failed");
      }

      const user = await this.getUserInfo(token);
      const session: vscode.AuthenticationSession = {
        id: uuid(),
        accessToken: token,
        account: {
          label: user.name,
          id: user.email,
        },
        scopes: sortedScopes,
      };

      await this.storage.storeSession(session);

      this.emitter.fire({
        added: [session],
        removed: [],
        changed: [],
      });

      return session;
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
   * @param sessionId - The session ID.
   */
  async removeSession(sessionId: string): Promise<void> {
    const removedSession = await this.storage.removeSession(sessionId);

    if (removedSession) {
      this.emitter.fire({
        added: [],
        removed: [removedSession],
        changed: [],
      });
    }
  }

  private async login(scopes: string): Promise<string> {
    const token = await this.vs.window.withProgress<string>(
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
          response_type: "code",
          scope: scopes,
          state: callbackUri.toString(),
          prompt: "login",
          code_challenge_method: CodeChallengeMethod.S256,
          code_challenge: pkce.codeChallenge,
        });

        await this.vs.env.openExternal(this.vs.Uri.parse(authorizeUrl));

        const code = await promisedCode;

        const tokenResponse = await this.oAuth2Client.getToken({
          code,
          codeVerifier: pkce.codeVerifier,
        });

        if (
          tokenResponse.res?.status !== 200 ||
          !tokenResponse.tokens.access_token
        ) {
          throw new Error("No access token returned");
        }

        return tokenResponse.tokens.access_token;
      },
    );
    this.vs.window.showInformationMessage("Signed in to Google!");

    return token;
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
}

/**
 * User information queried for following a successful login.
 */
const UserInfoSchema = z.object({
  name: z.string(),
  email: z.string(),
});
