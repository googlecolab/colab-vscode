/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { QuickPickItem } from 'vscode';
import { isCancellation, UserCancelledError } from '../../common/cancellation';
import { log } from '../../common/logging';
import { AssignmentManager } from '../../jupyter/assignments';
import { ContentsFileSystemProvider } from '../../jupyter/contents/file-system';
import { ColabAssignedServer } from '../../jupyter/servers';
import { telemetry } from '../../telemetry';
import { CommandSource, Outcome } from '../../telemetry/api';
import { buildColabFileUri } from '../files';
import { UPLOAD } from './constants';

/**
 * Maximum number of files read and written at once. Caps request fan-out to
 * the Colab server while still hiding per-file round-trip latency.
 */
const MAX_CONCURRENT_FILES_UPLOAD = 16;

/**
 * Maximum combined size of the files being uploaded at once. Each file is read
 * fully into memory before it is written, so this bounds the memory held by
 * in-flight uploads. A single larger file is still uploaded on its own.
 */
const MAX_IN_FLIGHT_UPLOAD_BYTES = 64 * 1024 * 1024;

/**
 * Uploads one or more files or directories to a selected Colab server.
 *
 * Prompts the user to select a target server, calculates the total number of
 * files to be uploaded for progress tracking, and performs the upload
 * recursively. It displays a cancellable progress notification during the
 * operation and emits a final summary message upon completion.
 *
 * Cancelling stops any new files from starting and aborts the ones in flight;
 * files that finished uploading before the cancellation are kept.
 *
 * @param vs - The VS Code module.
 * @param assignmentManager - The manager responsible for handling server
 * assignments.
 * @param fs - The Colab file system provider to upload through.
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
  fs: ContentsFileSystemProvider,
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
  // Files not attempted, or aborted part-way, because the user cancelled.
  let skippedCount = 0;

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
      cancelled = await vs.window.withProgress(
        {
          location: vs.ProgressLocation.Notification,
          title: `Uploading to ${selectedServer.label}...`,
          cancellable: true,
        },
        async (progress, token): Promise<boolean> => {
          const abort = new AbortController();
          const onCancel = token.onCancellationRequested(() => {
            log.info(`Upload to ${selectedServer.label} cancelled by the user`);
            abort.abort(new UserCancelledError('Upload cancelled'));
          });
          const { signal } = abort;
          try {
            // Uploads create missing parent directories, so only empty
            // directories need to be created explicitly.
            const emptyDirOps = operations.filter(
              (op) => op.type === 'directory' && op.empty,
            );
            const fileOps = operations.filter((op) => op.type === 'file');

            for (const op of emptyDirOps) {
              if (signal.aborted) {
                break;
              }
              try {
                await createDirectory(vs, op.dest);
              } catch (err) {
                log.error(
                  `Failed to create directory ${op.dest.toString()}`,
                  err,
                );
                failCount++;
              }
            }
            let done = 0;
            const budget = new ByteBudget(MAX_IN_FLIGHT_UPLOAD_BYTES);
            const queue = fileOps.values();
            await Promise.all(
              Array.from({ length: MAX_CONCURRENT_FILES_UPLOAD }, async () => {
                for (const op of queue) {
                  if (!(await budget.acquire(op.size, signal))) {
                    return;
                  }
                  let result: UploadResult;
                  try {
                    result = await uploadFile(vs, fs, op, signal);
                  } finally {
                    budget.release(op.size);
                  }
                  if (result === 'cancelled') {
                    return;
                  }
                  if (result === undefined) {
                    failCount++;
                  } else {
                    successCount++;
                    uploadedBytes += result;
                  }
                  done++;
                  progress.report({
                    message: `Importing ${done.toString()} of ${fileOps.length.toString()} files`,
                    increment: incrementPerFile,
                  });
                }
              }),
            );
            skippedCount = fileOps.length - done;
            // A cancellation that arrives after the last file finished
            // didn't stop anything.
            return signal.aborted && skippedCount > 0;
          } finally {
            onCancel.dispose();
          }
        },
      );
    }

    if (cancelled) {
      const files = fileCount === 1 ? 'file' : 'files';
      const msg = `Upload to ${selectedServer.label} cancelled. ${successCount.toString()} of ${fileCount.toString()} ${files} uploaded, ${skippedCount.toString()} not uploaded.`;
      void vs.window.showWarningMessage(msg);
    } else if (successCount > 0) {
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
 * @param cancelled - Whether the user cancelled, either before any work was
 * attempted or part-way through the upload.
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
  | { type: 'directory'; dest: vscode.Uri; empty: boolean }
  | { type: 'file'; source: vscode.Uri; dest: vscode.Uri; size: number };

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
      operations.push({ type: 'file', source, dest, size: stat.size });
    } else if (stat.type === vs.FileType.Directory) {
      const entries = await vs.workspace.fs.readDirectory(source);
      operations.push({ type: 'directory', dest, empty: entries.length === 0 });
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

/** Bytes uploaded, `undefined` on failure, or `'cancelled'` when aborted. */
type UploadResult = number | undefined | 'cancelled';

async function uploadFile(
  vs: typeof vscode,
  fs: ContentsFileSystemProvider,
  op: { source: vscode.Uri; dest: vscode.Uri },
  signal: AbortSignal,
): Promise<UploadResult> {
  try {
    const content = await vs.workspace.fs.readFile(op.source);
    signal.throwIfAborted();
    await fs.upload(op.dest, content, signal);
    return content.byteLength;
  } catch (err) {
    if (signal.aborted && isCancellation(err)) {
      log.debug(`Cancelled upload of ${op.dest.toString()}`);
      return 'cancelled';
    }
    log.error(`Failed to process ${op.dest.toString()}`, err);
    return undefined;
  }
}

/**
 * Admits work while the combined size of admitted items stays within `limit`.
 * An item larger than `limit` is admitted once nothing else is in flight.
 */
class ByteBudget {
  private used = 0;
  private waiters: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  /**
   * Waits until `bytes` fit within the budget, then reserves them.
   *
   * @param bytes - The number of bytes to reserve.
   * @param signal - Stops the wait when aborted.
   * @returns True once the bytes are reserved, or false if `signal` was aborted
   * first, in which case nothing is reserved.
   */
  async acquire(bytes: number, signal: AbortSignal): Promise<boolean> {
    while (this.used > 0 && this.used + bytes > this.limit) {
      if (signal.aborted) {
        return false;
      }
      await new Promise<void>((resolve) => {
        const wake = () => {
          signal.removeEventListener('abort', wake);
          resolve();
        };
        this.waiters.push(wake);
        signal.addEventListener('abort', wake);
      });
    }
    if (signal.aborted) {
      return false;
    }
    this.used += bytes;
    return true;
  }

  release(bytes: number): void {
    this.used -= bytes;
    for (const wake of this.waiters.splice(0)) {
      wake();
    }
  }
}
