/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Uri } from 'vscode';
import { telemetry } from '../../telemetry';
import {
  ContentBrowserOperation,
  ContentBrowserTarget,
  Outcome,
} from '../../telemetry/api';
import type { ContentItem } from './content-item';

/**
 * Creates a new file on the Colab server.
 *
 * Prompts the user for a name, validates it, and creates an empty file.
 * If the name ends with a forward slash, a directory is created instead.
 * Automatically opens the new file after creation.
 *
 * @param vs - The VS Code API instance.
 * @param contextItem - The tree view context item.
 */
export async function newFile(vs: typeof vscode, contextItem: ContentItem) {
  let outcome = Outcome.OUTCOME_CANCELLED;
  let target = ContentBrowserTarget.TARGET_FILE;
  try {
    const destination = folderOrParent(vs, contextItem);
    const name = await vs.window.showInputBox({
      title: 'New File',
      prompt: 'Enter the file name',
      validateInput: (value) => validateFileOrFolder(vs, destination, value),
    });
    if (!name) {
      return;
    }
    const uri = vs.Uri.joinPath(destination, name);
    const isDirectory = name.endsWith('/');
    target = isDirectory
      ? ContentBrowserTarget.TARGET_DIRECTORY
      : ContentBrowserTarget.TARGET_FILE;
    try {
      if (isDirectory) {
        await vs.workspace.fs.createDirectory(uri);
        outcome = Outcome.OUTCOME_SUCCEEDED;
        return;
      }
      await vs.workspace.fs.writeFile(uri, new Uint8Array());
      await vs.commands.executeCommand('vscode.open', uri);
      outcome = Outcome.OUTCOME_SUCCEEDED;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      const type = isDirectory ? 'folder' : 'file';
      void vs.window.showErrorMessage(
        `Failed to create ${type} "${name}": ${msg}`,
      );
      outcome = Outcome.OUTCOME_FAILED;
    }
  } finally {
    telemetry.logContentBrowserFileOperation(
      ContentBrowserOperation.OPERATION_NEW_FILE,
      outcome,
      target,
    );
  }
}

/**
 * Creates a new folder on the Colab server.
 *
 * Prompts the user for a name, validates it, and creates a directory.
 *
 * @param vs - The VS Code API instance.
 * @param contextItem - The tree view context item.
 */
export async function newFolder(vs: typeof vscode, contextItem: ContentItem) {
  let outcome = Outcome.OUTCOME_CANCELLED;
  try {
    const destination = folderOrParent(vs, contextItem);
    const name = await vs.window.showInputBox({
      title: 'New Folder',
      prompt: 'Enter the folder name',
      validateInput: (value) => validateFileOrFolder(vs, destination, value),
    });
    if (!name) {
      return;
    }
    const uri = vs.Uri.joinPath(destination, name);
    try {
      await vs.workspace.fs.createDirectory(uri);
      outcome = Outcome.OUTCOME_SUCCEEDED;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      void vs.window.showErrorMessage(
        `Failed to create folder "${name}": ${msg}`,
      );
      outcome = Outcome.OUTCOME_FAILED;
    }
  } finally {
    telemetry.logContentBrowserFileOperation(
      ContentBrowserOperation.OPERATION_NEW_FOLDER,
      outcome,
      ContentBrowserTarget.TARGET_DIRECTORY,
    );
  }
}

/**
 * Downloads a file from the Colab server to the local filesystem.
 *
 * @param vs - The VS Code API instance.
 * @param contextItem - The tree view context item.
 */
export async function download(vs: typeof vscode, contextItem: ContentItem) {
  if (contextItem.type !== vs.FileType.File) {
    return;
  }

  const fileName = contextItem.uri.path.split('/').pop() ?? 'file';
  const targetUri = await vs.window.showSaveDialog({
    defaultUri: vs.Uri.file(fileName),
    title: 'Download File',
  });

  if (!targetUri) {
    return;
  }

  await vs.window.withProgress(
    {
      location: vs.ProgressLocation.Notification,
      title: `Downloading ${fileName}...`,
      cancellable: false,
    },
    async () => {
      try {
        const content = await vs.workspace.fs.readFile(contextItem.uri);
        await vs.workspace.fs.writeFile(targetUri, content);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        void vs.window.showErrorMessage(
          `Failed to download ${fileName}: ${msg}`,
        );
      }
    },
  );
}

/**
 * Renames a file or folder on the Colab server.
 *
 * @param vs - The VS Code API instance.
 * @param contextItem - The tree view context item.
 */
// TODO: Look into preserving expanded state of renamed folders.
export async function renameFile(vs: typeof vscode, contextItem: ContentItem) {
  let outcome = Outcome.OUTCOME_CANCELLED;
  try {
    const oldName = contextItem.uri.path.split('/').pop() ?? '';
    const destination = vs.Uri.joinPath(contextItem.uri, '..');

    const newName = await vs.window.showInputBox({
      title: 'Rename',
      prompt: 'Enter the new name',
      value: oldName,
      validateInput: async (value) => {
        if (value === oldName) {
          return undefined;
        }
        return validateFileOrFolder(vs, destination, value);
      },
    });

    if (!newName || newName === oldName) {
      return;
    }

    const newUri = vs.Uri.joinPath(destination, newName);
    try {
      await vs.workspace.fs.rename(contextItem.uri, newUri, {
        overwrite: false,
      });
      outcome = Outcome.OUTCOME_SUCCEEDED;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      void vs.window.showErrorMessage(
        `Failed to rename "${oldName}" to "${newName}": ${msg}`,
      );
      outcome = Outcome.OUTCOME_FAILED;
    }
  } finally {
    telemetry.logContentBrowserFileOperation(
      ContentBrowserOperation.OPERATION_RENAME,
      outcome,
      contentItemTarget(vs, contextItem),
    );
  }
}

/**
 * Deletes a file or folder on the Colab server.
 *
 * @param vs - The VS Code API instance.
 * @param contextItem - The tree view context item.
 */
export async function deleteFile(vs: typeof vscode, contextItem: ContentItem) {
  let outcome = Outcome.OUTCOME_CANCELLED;
  try {
    const name = contextItem.uri.path.split('/').pop() ?? '';
    const confirmation = await vs.window.showWarningMessage(
      `Are you sure you want to delete "${name}"?`,
      { modal: true },
      'Delete',
    );

    if (confirmation !== 'Delete') {
      return;
    }

    try {
      await vs.workspace.fs.delete(contextItem.uri, { recursive: true });
      outcome = Outcome.OUTCOME_SUCCEEDED;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      void vs.window.showErrorMessage(`Failed to delete "${name}": ${msg}`);
      outcome = Outcome.OUTCOME_FAILED;
    }
  } finally {
    telemetry.logContentBrowserFileOperation(
      ContentBrowserOperation.OPERATION_DELETE,
      outcome,
      contentItemTarget(vs, contextItem),
    );
  }
}

async function validateFileOrFolder(
  vs: typeof vscode,
  destination: Uri,
  name: string,
): Promise<string | undefined> {
  const error = validateName(name);
  if (error) {
    return error;
  }
  try {
    await vs.workspace.fs.stat(vs.Uri.joinPath(destination, name));
    return 'A file or folder with this name already exists';
  } catch {
    return undefined;
  }
}

function validateName(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === '/') {
    return 'A name must be provided';
  }
  if (value.includes('\\')) {
    return 'Name cannot contain \\';
  }
  return undefined;
}

function folderOrParent(vs: typeof vscode, item: ContentItem): Uri {
  return item.contextValue === 'file'
    ? vs.Uri.joinPath(item.uri, '..')
    : item.uri;
}

function contentItemTarget(
  vs: typeof vscode,
  item: ContentItem,
): ContentBrowserTarget {
  return item.type === vs.FileType.Directory
    ? ContentBrowserTarget.TARGET_DIRECTORY
    : ContentBrowserTarget.TARGET_FILE;
}
