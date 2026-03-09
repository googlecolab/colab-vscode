/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from 'vscode';
import { z } from 'zod';
import { log } from '../common/logging';
import { PROVIDER_ID } from '../config/constants';

const SESSIONS_KEY = `${PROVIDER_ID}.sessions`;

/**
 * Persistent storage for refreshable authentication sessions.
 *
 * This class wraps VS Code's SecretStorage to securely store refresh tokens.
 * It maintains an in-memory cache to minimize expensive asynchronous I/O
 * and string parsing.
 */
export class AuthStorage {
  private cachedSessions: RefreshableAuthenticationSession[] | undefined;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  /**
   * Retrieves all persisted sessions.
   *
   * @returns An array of refreshable authentication sessions.
   * If no sessions are stored, returns an empty array.
   */
  async getSessions(): Promise<RefreshableAuthenticationSession[]> {
    if (this.cachedSessions) {
      return this.cachedSessions;
    }

    const sessionJson = await this.secrets.get(SESSIONS_KEY);
    if (!sessionJson) {
      this.cachedSessions = [];
      return [];
    }

    try {
      this.cachedSessions = parseAuthenticationSessions(sessionJson);
    } catch (err) {
      // If storage is corrupted, we return empty to allow the user to re-auth
      // rather than breaking the extension.
      log.error('Failed to parse stored authentication sessions:', err);
      this.cachedSessions = [];
    }
    return this.cachedSessions;
  }

  /**
   * Retrieves a session that satisfies the requested scopes.
   *
   * @param scopes - An array of scopes. The returned session will have all of
   * these scopes included in its permissions.
   * @returns The refreshable authentication session, if it exists. Otherwise,
   * `undefined`.
   */
  async getSession(
    scopes: readonly string[] | string[],
  ): Promise<RefreshableAuthenticationSession | undefined> {
    const sessions = await this.getSessions();
    return sessions.find((session) =>
      scopes.every((scope) => session.scopes.includes(scope)),
    );
  }

  /**
   * Retrieves a specific session by its unique ID.
   *
   * @param sessionId - The session ID.
   * @returns The refreshable authentication session, if it exists. Otherwise,
   * `undefined`.
   */
  async getSessionById(
    sessionId: string,
  ): Promise<RefreshableAuthenticationSession | undefined> {
    const sessions = await this.getSessions();
    return sessions.find((session) => session.id === sessionId);
  }

  /**
   * Stores a session, replacing any existing session with the same ID.
   *
   * @param session - The session to store.
   * @returns A promise that resolves when the session has been stored.
   */
  async storeSession(session: RefreshableAuthenticationSession): Promise<void> {
    const sessions = await this.getSessions();
    const otherSessions = sessions.filter((s) => s.id !== session.id);
    this.cachedSessions = [...otherSessions, session];
    await this.save();
  }

  /**
   * Removes a session by ID and updates persistent storage.
   *
   * @param sessionId - The session ID.
   * @returns The removed session, if it was found and removed. Otherwise,
   * `undefined`.
   */
  async removeSession(
    sessionId: string,
  ): Promise<RefreshableAuthenticationSession | undefined> {
    const sessions = await this.getSessions();
    const sessionToRemove = await this.getSessionById(sessionId);
    if (!sessionToRemove) {
      return undefined;
    }

    this.cachedSessions = sessions.filter((s) => s.id !== sessionId);
    if (this.cachedSessions.length > 0) {
      await this.save();
    } else {
      await this.secrets.delete(SESSIONS_KEY);
    }
    return sessionToRemove;
  }

  /**
   * Internal helper to commit the current cache to the secret store.
   */
  private async save(): Promise<void> {
    if (this.cachedSessions) {
      await this.secrets.store(
        SESSIONS_KEY,
        JSON.stringify(this.cachedSessions),
      );
    }
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

export const TEST_ONLY = {
  SESSIONS_KEY,
};
