/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Disposable } from 'vscode';
import { GoogleAuthProvider } from '../../auth/auth-provider';
import { registerCommand } from '../../common/commands';
import { AssignmentManager } from '../../jupyter/assignments';
import { ContentsFileSystemProvider } from '../../jupyter/contents/file-system';
import { telemetry } from '../../telemetry';
import { CommandSource } from '../../telemetry/api';
import {
  COLAB_TOOLBAR,
  MOUNT_DRIVE,
  MOUNT_SERVER,
  OPEN_TERMINAL,
  REMOVE_SERVER,
  SIGN_OUT,
  UPLOAD,
} from './constants';
import { upload } from './files';
import { appendCodeCell, notebookToolbar } from './notebook';
import { mountServer, removeServer } from './server';
import { openTerminal } from './terminal';

/** Dependencies required to register the core Colab commands. */
export interface ColabCommandDeps {
  /** Used by the sign-out command. */
  readonly authProvider: GoogleAuthProvider;
  /** Used by mount/remove/upload/toolbar/terminal commands. */
  readonly assignmentManager: AssignmentManager;
  /** Used by the mount-server command to access remote files. */
  readonly fs: ContentsFileSystemProvider;
}

/**
 * Registers the core Colab commands (sign-out, mount, remove, upload, etc.).
 *
 * @param vs - The VS Code API instance.
 * @param deps - The services the command handlers need.
 * @returns The disposables for each registered command.
 */
export function registerColabCommands(
  vs: typeof vscode,
  deps: ColabCommandDeps,
): Disposable[] {
  const { authProvider, assignmentManager, fs } = deps;
  return [
    registerCommand(vs, SIGN_OUT.id, async () => {
      await authProvider.signOut();
    }),
    // TODO: Register the rename server alias command once rename is reflected
    // in the recent kernels list. See
    // https://github.com/microsoft/vscode-jupyter/issues/17107.
    registerCommand(
      vs,
      MOUNT_SERVER.id,
      async (source?: CommandSource, withBackButton?: boolean) => {
        await mountServer(
          vs,
          assignmentManager,
          fs,
          source ?? CommandSource.COMMAND_SOURCE_COMMAND_PALETTE,
          withBackButton,
        );
      },
    ),
    registerCommand(vs, MOUNT_DRIVE.id, async (source?: CommandSource) => {
      telemetry.logMountDriveSnippet(
        source ?? CommandSource.COMMAND_SOURCE_COMMAND_PALETTE,
      );
      await appendCodeCell(
        vs,
        [
          'from google.colab import drive',
          `drive.mount('/content/drive')`,
        ].join('\n'),
        'python',
      );
    }),
    registerCommand(
      vs,
      REMOVE_SERVER.id,
      async (source?: CommandSource, withBackButton?: boolean) => {
        await removeServer(vs, assignmentManager, withBackButton, source);
      },
    ),
    registerCommand(
      vs,
      UPLOAD.id,
      async (uri: vscode.Uri, uris?: vscode.Uri[]) => {
        await upload(vs, assignmentManager, uri, uris);
      },
    ),
    registerCommand(vs, COLAB_TOOLBAR.id, async () => {
      await notebookToolbar(vs, assignmentManager);
    }),
    registerCommand(vs, OPEN_TERMINAL.id, async (withBackButton?: boolean) => {
      await openTerminal(vs, assignmentManager, withBackButton);
    }),
  ];
}
