/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from 'vscode';
import { ColabClient } from '../colab/client';
import { log } from '../common/logging';

export async function handleDriveFsAuth(
  vs: typeof vscode,
  client: ColabClient,
  endpoint: string,
) {
  const fileId = vs.window.activeNotebookEditor?.notebook.uri.path ?? '';
  log.debug(`Notebook file ID: ${fileId}`);
  log.debug(`Endpoint: ${endpoint}`);
  const { unauthorizedRedirectUri } = await client.propagateDriveCredentials(
    endpoint,
    {
      authType: 'dfs_ephemeral',
      fileId,
      dryRun: true,
    },
  );

  if (unauthorizedRedirectUri) {
    log.debug(`Unauthorized redirect URI: ${unauthorizedRedirectUri}`);
    await vs.env.openExternal(vs.Uri.parse(unauthorizedRedirectUri));

    // This is a hack to continue the process in VS Code
    const result = await vs.window.showInformationMessage('Continue?', 'Yes');
    if (result === 'Yes') {
      const { success } = await client.propagateDriveCredentials(endpoint, {
        authType: 'dfs_ephemeral',
        fileId,
        dryRun: false,
      });
      log.debug(`Credentials propagation success: ${String(success)}`);
    }
  }
}
