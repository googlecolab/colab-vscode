/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { QuickPickItem } from 'vscode';
import { log } from '../../common/logging';
import { AssignmentManager } from '../../jupyter/assignments';
import { ColabAssignedServer } from '../../jupyter/servers';
import { buildColabFileUri } from '../files';
import { UPLOAD_FILE } from './constants';

/**
 * Uploads a file to a Colab server.
 *
 * - With no servers: warns the user no servers are found.
 * - With one server: uploads it directly.
 * - With multiple servers: prompts the user to select one to upload to.
 */
export async function uploadFile(
  vs: typeof vscode,
  assignmentManager: AssignmentManager,
  uri: vscode.Uri,
) {
  const selectedServer = await selectServer(vs, assignmentManager);
  if (!selectedServer) {
    return;
  }
  const fileName = uri.path.split('/').pop();
  if (!fileName) {
    log.error(`Could not determine filename from uri: ${uri.toString()}`);
    return;
  }

  const destinationUri = buildColabFileUri(vs, selectedServer, fileName);

  try {
    await vs.window.withProgress(
      {
        location: vs.ProgressLocation.Notification,
        title: `Importing ${fileName} to ${selectedServer.label}...`,
        cancellable: false,
      },
      async () => {
        const content = await vs.workspace.fs.readFile(uri);
        await vs.workspace.fs.writeFile(destinationUri, content);
      },
    );
    void vs.window.showInformationMessage(
      `Successfully uploaded ${fileName} to ${selectedServer.label}`,
    );
  } catch (err: unknown) {
    log.error('Failed to upload file', err);
    const msg = err instanceof Error ? err.message : String(err);
    void vs.window.showErrorMessage(`Failed to upload file: ${msg}`);
  }
}

async function selectServer(
  vs: typeof vscode,
  assignmentManager: AssignmentManager,
): Promise<ColabAssignedServer | undefined> {
  const servers = await assignmentManager.getServers('extension');
  if (servers.length === 0) {
    void vs.window.showWarningMessage('No Colab servers found.');
    return;
  }

  if (servers.length === 1) {
    return servers[0];
  } else {
    const items: ServerItem[] = servers.map((s) => ({
      label: s.label,
      value: s,
    }));
    const selectedServer = await vs.window.showQuickPick(items, {
      title: UPLOAD_FILE.label,
      placeHolder: 'Select a server to upload to',
    });
    return selectedServer?.value ?? undefined;
  }
}

interface ServerItem extends QuickPickItem {
  value: ColabAssignedServer;
}
