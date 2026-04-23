/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Disposable } from 'vscode';
import { registerCommand } from '../../common/commands';
import { DriveClient } from '../client';
import { IMPORT_NOTEBOOK_FROM_URL } from './constants';
import { importNotebookFromUrl } from './import';

/** Dependencies required to register drive commands. */
export interface DriveCommandDeps {
  /** Used by the import-notebook-from-url command. */
  readonly driveClient: DriveClient;
}

/**
 * Registers Drive-related commands.
 *
 * @param vs - The VS Code API instance.
 * @param deps - The drive client used by the commands.
 * @returns The disposables for each registered command.
 */
export function registerDriveCommands(
  vs: typeof vscode,
  deps: DriveCommandDeps,
): Disposable[] {
  const { driveClient } = deps;
  return [
    registerCommand(vs, IMPORT_NOTEBOOK_FROM_URL.id, async (url?: string) => {
      await importNotebookFromUrl(vs, driveClient, url);
    }),
  ];
}
