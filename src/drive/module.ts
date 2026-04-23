/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Disposable } from 'vscode';
import { GoogleAuthProvider } from '../auth/auth-provider';
import { DRIVE_SCOPES } from '../auth/scopes';
import { DriveClient } from './client';
import { registerDriveCommands } from './commands/register';

/** The result of activating the drive module. */
export interface DriveModule {
  /**
   * Command-registration disposables. Push these LAST in
   * `context.subscriptions` so they are disposed earliest, removing command
   * handlers before the underlying services tear down.
   */
  readonly commandDisposables: Disposable[];
}

/**
 * Builds the {@link DriveClient} and registers Drive-related commands.
 *
 * @param vs - The VS Code API instance.
 * @param authProvider - The authentication provider for token retrieval and
 * sign-out on auth failure.
 * @returns The disposables produced by command registration.
 */
export function createDriveModule(
  vs: typeof vscode,
  authProvider: GoogleAuthProvider,
): DriveModule {
  const driveClient = DriveClient.create(
    () =>
      GoogleAuthProvider.getOrCreateSession(vs, DRIVE_SCOPES).then(
        (session) => session.accessToken,
      ),
    () => authProvider.signOut(),
  );
  return {
    commandDisposables: registerDriveCommands(vs, { driveClient }),
  };
}
