import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import fetch from "node-fetch";
import { v4 as uuid } from "uuid";
import vscode from "vscode";
import { PackageInfo } from "../config/package_info";
import { CodeProvider } from "./redirect";

const PROVIDER_ID = "google";
const PROVIDER_LABEL = "Google";
const REQUIRED_SCOPES = ["profile", "email"] as const;
const SESSIONS_KEY = `${PROVIDER_ID}.sessions`;

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
  private readonly disposable: vscode.Disposable;
  private readonly emitter: vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>;

  /**
   * Initializes the GoogleAuthProvider.
   *
   * @param vs - The VS Code API.
   * @param context - The extension context used for managing lifecycle.
   * @param oAuth2Client - The OAuth2 client for handling Google authentication.
   * @param codeProvider - The provider responsible for generating authorization codes.
   */
  constructor(
    private readonly vs: typeof vscode,
    private readonly context: vscode.ExtensionContext,
    private readonly oAuth2Client: OAuth2Client,
    private readonly codeProvider: CodeProvider,
  ) {
    this.emitter =
      new vs.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
    this.onDidChangeSessions = this.emitter.event;

    this.disposable = this.vs.Disposable.from(
      this.vs.authentication.registerAuthenticationProvider(
        PROVIDER_ID,
        PROVIDER_LABEL,
        this,
        { supportsMultipleAccounts: false },
      ),
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
    this.disposable.dispose();
  }

  /**
   * Retrieves the authentication sessions that have been persisted.
   *
   * @param _scopes - Currently unused.
   * @param _options - Currently unused.
   * @returns An array of stored authentication sessions.
   */
  async getSessions(
    _scopes: readonly string[] | undefined,
    _options: vscode.AuthenticationProviderSessionOptions,
  ): Promise<vscode.AuthenticationSession[]> {
    const sessionJson = await this.context.secrets.get(SESSIONS_KEY);
    if (!sessionJson) {
      return [];
    }
    return parseAuthenticationSessions(sessionJson);
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

      await this.context.secrets.store(SESSIONS_KEY, JSON.stringify([session]));

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
    const sessionsJson = await this.context.secrets.get(SESSIONS_KEY);
    if (!sessionsJson) {
      return;
    }
    const sessions = parseAuthenticationSessions(sessionsJson);

    const sessionIndex = sessions.findIndex((s) => s.id === sessionId);
    if (sessionIndex === -1) {
      return;
    }

    const [removedSession] = sessions.splice(sessionIndex, 1);

    await this.context.secrets.store(SESSIONS_KEY, JSON.stringify(sessions));

    this.emitter.fire({
      added: [],
      removed: [removedSession],
      changed: [],
    });
  }

  private async login(scopes: string) {
    return await this.vs.window.withProgress<string>(
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
  }

  private async getCallbackUri(nonce: string): Promise<vscode.Uri> {
    const scheme = this.vs.env.uriScheme;
    const packageInfo = this.context.extension.packageJSON as PackageInfo;
    const pub = packageInfo.publisher;
    const name = packageInfo.name;

    const uri = this.vs.Uri.parse(`${scheme}://${pub}.${name}?nonce=${nonce}`);

    return await this.vs.env.asExternalUri(uri);
  }

  private async getUserInfo(token: string): Promise<UserInfo> {
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
    if (!isUserInfo(json)) {
      throw new Error(`Invalid user info, got: ${JSON.stringify(json)}`);
    }

    return json;
  }
}

function parseAuthenticationSessions(
  sessionsJson: string,
): vscode.AuthenticationSession[] {
  const sessions: unknown = JSON.parse(sessionsJson);
  if (!areAuthenticationSessions(sessions)) {
    throw new Error(
      `Invalid authentication sessions, got: ${JSON.stringify(sessionsJson)}`,
    );
  }
  return sessions;
}

/**
 * Type guard to check if a value is a string.
 */
const isString = (value: unknown): value is string => {
  return typeof value === "string";
};

/**
 * Type guard to check if a value is an array of strings.
 */
const isStringArray = (value: unknown): value is readonly string[] => {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
};

/**
 * Type guard to check if a value matches the AuthenticationSessionAccountInformation shape
 */
const isAuthSessionAccountInfo = (
  value: unknown,
): value is vscode.AuthenticationSessionAccountInformation => {
  if (!value || typeof value !== "object") {
    return false;
  }

  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access*/

  const account = value as any;
  return (
    typeof account === "object" &&
    account !== null &&
    "id" in account &&
    "label" in account &&
    isString(account.id) &&
    isString(account.label)
  );
};

/**
 * Type guard to check if a value matches the AuthenticationSession interface
 */
const isAuthenticationSession = (
  value: unknown,
): value is vscode.AuthenticationSession => {
  if (!value || typeof value !== "object") {
    return false;
  }

  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access*/
  const session = value as any;
  return (
    "id" in session &&
    "accessToken" in session &&
    "account" in session &&
    "scopes" in session &&
    isString(session.id) &&
    isString(session.accessToken) &&
    isAuthSessionAccountInfo(session.account) &&
    isStringArray(session.scopes)
  );
};

/**
 * Type guard to check if a value is an array of {@link vscode.AuthenticationSession} objects.
 */
const areAuthenticationSessions = (
  value: unknown,
): value is vscode.AuthenticationSession[] => {
  return Array.isArray(value) && value.every(isAuthenticationSession);
};

/**
 * User information queried for following a successful login.
 */
interface UserInfo {
  name: string;
  email: string;
}

/**
 * Type guard to validate the object is {@link UserInfo}.
 */
function isUserInfo(obj: unknown): obj is UserInfo {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }

  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access*/
  const userInfo = obj as any;
  return (
    "name" in userInfo &&
    "email" in userInfo &&
    isString(userInfo.name) &&
    isString(userInfo.email)
  );
}
