import vscode from "vscode";
import { z } from "zod";
import { PROVIDER_ID } from "../config/constants";

const SESSIONS_KEY = `${PROVIDER_ID}.sessions`;

/**
 * Server storage for Authentication sessions.
 *
 * Implementation assumes full ownership over the backing secret storage file.
 *
 * Currently only supports a single session, since we only ever need the one
 * scope. Despite this, the implementation is designed to be extensible to
 * multiple sessions in the future (stores an array of sessions). We are likely
 * to do this if and when we support Drive-specific functionality.
 */
export class AuthStorage {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  /**
   * Retrieve the authentication session, if it exists.
   *
   * @returns The authentication session, if it exists. Otherwise, `undefined`.
   */
  async getSession(): Promise<vscode.AuthenticationSession | undefined> {
    const sessionJson = await this.secrets.get(SESSIONS_KEY);
    if (!sessionJson) {
      return undefined;
    }
    const sessions = parseAuthenticationSessions(sessionJson);
    // This is guarded by the Zod schema, so it should always be a single
    // session.
    if (sessions.length != 1) {
      throw new Error(
        `Unexpected number of sessions: ${sessions.length.toString()}`,
      );
    }
    return sessions[0];
  }

  /**
   * Stores the authentication session.
   */
  async storeSession(session: vscode.AuthenticationSession): Promise<void> {
    return this.secrets.store(SESSIONS_KEY, JSON.stringify([session]));
  }

  /**
   * Removes a session by ID.
   *
   * @param sessionId - The session ID.
   * @returns The removed session, if it was found and removed. Otherwise,
   * `undefined`.
   */
  async removeSession(
    sessionId: string,
  ): Promise<vscode.AuthenticationSession | undefined> {
    const session = await this.getSession();
    if (!session) {
      return undefined;
    }
    if (session.id !== sessionId) {
      return undefined;
    }
    await this.secrets.delete(SESSIONS_KEY);
    return session;
  }
}

const AuthenticationSessionAccountInformationSchema = z.object({
  id: z.string(),
  label: z.string(),
});

const AuthenticationSessionsSchema = z
  .array(
    z.object({
      id: z.string(),
      accessToken: z.string(),
      account: AuthenticationSessionAccountInformationSchema,
      scopes: z.array(z.string()),
    }),
  )
  .length(1);

function parseAuthenticationSessions(
  sessionsJson: string,
): vscode.AuthenticationSession[] {
  const sessions: unknown = JSON.parse(sessionsJson);

  return AuthenticationSessionsSchema.parse(sessions);
}
