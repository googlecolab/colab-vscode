/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { QuickPickItem } from 'vscode';
import { log } from '../../common/logging';
import { AssignmentManager } from '../../jupyter/assignments';
import { ColabAssignedServer } from '../../jupyter/servers';
import { telemetry } from '../../telemetry';
import { CommandSource, Outcome } from '../../telemetry/api';
import { buildColabFileUri } from '../files';
import { UPLOAD } from './constants';

/**
 * Uploads one or more files or directories to a selected Colab server.
 *
 * Prompts the user to select a target server, calculates the total number of
 * files to be uploaded for progress tracking, and performs the upload
 * recursively. It displays a progress notification during the operation and
 * emits a final summary message upon completion.
 *
 * @param vs - The VS Code module.
 * @param assignmentManager - The manager responsible for handling server
 * assignments.
 * @param source - The source of the upload command invocation.
 * @param uri - The primary URI of the file or folder to upload, e.g. the URI of
 * the file which was right-clicked in the file explorer.
 * @param uris - An optional array of all files and folders which should be
 * uploaded. When provided, the primary URI, provided with `uri`, is assumed to
 * be in this list.
 * @returns A promise that resolves when the upload process is complete.
 */
export async function upload(
  vs: typeof vscode,
  assignmentManager: AssignmentManager,
  source: CommandSource,
  uri: vscode.Uri,
  uris?: vscode.Uri[],
) {
  let cancelled = true;
  let successCount = 0;
  let failCount = 0;
  let fileCount = 0;
  let directoryCount = 0;
  let uploadedBytes = 0;

  try {
    const selectedServer = await selectServer(vs, assignmentManager);
    if (!selectedServer) {
      return;
    }
    cancelled = false;

    const inputs = uris && uris.length > 0 ? uris : [uri];
    const plan = await buildUploadPlan(vs, inputs, selectedServer);
    const { operations } = plan;
    failCount = plan.failCount;
    fileCount = operations.filter((op) => op.type === 'file').length;
    directoryCount = operations.filter((op) => op.type === 'directory').length;

    const incrementPerFile = fileCount > 0 ? 100 / fileCount : 0;

    if (operations.length > 0) {
      await vs.window.withProgress(
        {
          location: vs.ProgressLocation.Notification,
          title: `Uploading to ${selectedServer.label}...`,
          cancellable: false,
        },
        async (progress) => {
          for (const op of operations) {
            try {
              if (op.type === 'directory') {
                await createDirectory(vs, op.dest);
              } else {
                const fileName = op.source.path.split('/').pop() ?? '';
                progress.report({
                  message: `Importing ${fileName}...`,
                  increment: incrementPerFile,
                });
                const content = await vs.workspace.fs.readFile(op.source);
                await vs.workspace.fs.writeFile(op.dest, content);
                successCount++;
                uploadedBytes += content.byteLength;
              }
            } catch (err) {
              log.error(`Failed to process ${op.dest.toString()}`, err);
              failCount++;
            }
          }
        },
      );
    }

    if (successCount > 0) {
      const countPart = successCount > 1 ? 'items' : 'item';
      const msg = `Successfully uploaded ${successCount.toString()} ${countPart} to ${selectedServer.label}`;
      void vs.window.showInformationMessage(msg);
    }

    if (failCount > 0) {
      const countPart = failCount > 1 ? 'items' : 'item';
      const msg = `Failed to upload ${failCount.toString()} ${countPart}. Check logs for details.`;
      void vs.window.showErrorMessage(msg);
    }
  } finally {
    const outcome = deriveUploadOutcome(cancelled, successCount, failCount);
    telemetry.logUpload(source, outcome, {
      successCount,
      failCount,
      fileCount,
      directoryCount,
      uploadedBytes,
    });
  }
}

/**
 * Derives the {@link Outcome} of an upload attempt from the success and
 * failure counts.
 *
 * @param cancelled - Whether the user cancelled before any work was
 * attempted.
 * @param successCount - The number of files that were successfully uploaded.
 * @param failCount - The number of files or directories that failed to
 * upload.
 * @returns The outcome of the upload attempt.
 */
function deriveUploadOutcome(
  cancelled: boolean,
  successCount: number,
  failCount: number,
): Outcome {
  if (cancelled) {
    return Outcome.OUTCOME_CANCELLED;
  }
  if (failCount === 0) {
    return Outcome.OUTCOME_SUCCEEDED;
  }
  if (successCount === 0) {
    return Outcome.OUTCOME_FAILED;
  }
  return Outcome.OUTCOME_PARTIAL_SUCCESS;
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
      title: UPLOAD.label,
      placeHolder: 'Select a server to upload to',
    });
    return selectedServer?.value ?? undefined;
  }
}

interface ServerItem extends QuickPickItem {
  value: ColabAssignedServer;
}

type UploadOperation =
  | { type: 'directory'; dest: vscode.Uri }
  | { type: 'file'; source: vscode.Uri; dest: vscode.Uri };

async function buildUploadPlan(
  vs: typeof vscode,
  inputs: vscode.Uri[],
  selectedServer: ColabAssignedServer,
): Promise<{ operations: UploadOperation[]; failCount: number }> {
  const operations: UploadOperation[] = [];
  let failCount = 0;

  const planUploadsRecursively = async (
    source: vscode.Uri,
    dest: vscode.Uri,
    operations: UploadOperation[],
  ) => {
    const stat = await vs.workspace.fs.stat(source);
    if (stat.type === vs.FileType.File) {
      operations.push({ type: 'file', source, dest });
    } else if (stat.type === vs.FileType.Directory) {
      operations.push({ type: 'directory', dest });
      const entries = await vs.workspace.fs.readDirectory(source);
      for (const [name] of entries) {
        try {
          await planUploadsRecursively(
            vs.Uri.joinPath(source, name),
            vs.Uri.joinPath(dest, name),
            operations,
          );
        } catch (err) {
          log.error(`Failed to plan upload for ${name}`, err);
          failCount++;
        }
      }
    }
  };

  const serverRootUri = buildColabFileUri(vs, selectedServer, 'content');
  for (const inputUri of inputs) {
    const itemName = inputUri.path.split('/').pop();
    if (!itemName) {
      log.error(`Could not determine name from uri: ${inputUri.toString()}`);
      failCount++;
      continue;
    }
    const destUri = vs.Uri.joinPath(serverRootUri, itemName);
    try {
      await planUploadsRecursively(inputUri, destUri, operations);
    } catch (err) {
      log.error(`Failed to plan upload for ${itemName}`, err);
      failCount++;
    }
  }
  return { operations, failCount };
}

async function createDirectory(vs: typeof vscode, uri: vscode.Uri) {
  try {
    await vs.workspace.fs.createDirectory(uri);
  } catch (err) {
    const dirExists =
      err instanceof vs.FileSystemError && err.name === 'FileExists';
    if (!dirExists) {
      throw err;
    }
  }
}
