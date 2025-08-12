/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from "vscode";
import { z } from "zod";
import { PROVIDER_ID } from "../config/constants";

const SESSIONS_KEY = `${PROVIDER_ID}.sessions`;

/**
 * Server storage for authentication sessions.
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
   * Retrieve the refreshable authentication session.
   *
   * @returns The refreshable authentication session, if it exists. Otherwise,
   * `undefined`.
   */
  async getSession(): Promise<RefreshableAuthenticationSession | undefined> {
    const sessionJson = await this.secrets.get(SESSIONS_KEY);
    if (!sessionJson) {
      return undefined;
    }
    const sessions = parseAuthenticationSessions(sessionJson);
    if (sessions.length != 1) {
      throw new Error(
        `Unexpected number of sessions: ${sessions.length.toString()}`,
      );
    }
    return sessions[0];
  }

  /**
   * Stores the refreshable authentication session.
   */
  async storeSession(session: RefreshableAuthenticationSession): Promise<void> {
    return this.secrets.store(SESSIONS_KEY, JSON.stringify([session]));
  }

  /**
   * Removes a refreshable authentication session by ID.
   *
   * @param sessionId - The session ID.
   * @returns The removed session, if it was found and removed. Otherwise,
   * `undefined`.
   */
  async removeSession(
    sessionId: string,
  ): Promise<RefreshableAuthenticationSession | undefined> {
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

const RefreshableAuthenticationSessionSchema = z.object({
  id: z.string(),
  refreshToken: z.string(),
  account: z.object({
    id: z.string(),
    label: z.string(),
  }),
  scopes: z.array(z.string()),
});
export type RefreshableAuthenticationSession = z.infer<
  typeof RefreshableAuthenticationSessionSchema
>;

function parseAuthenticationSessions(
  sessionsJson: string,
): RefreshableAuthenticationSession[] {
  const sessions: unknown = JSON.parse(sessionsJson);

  return z.array(RefreshableAuthenticationSessionSchema).parse(sessions);
}
