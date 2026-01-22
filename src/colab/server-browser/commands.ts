/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Uri } from 'vscode';
import type { ServerItem } from './server-item';

/**
 * Creates a new file on the Colab server.
 *
 * Prompts the user for a name, validates it, and creates an empty file.
 * If the name ends with a forward slash, a directory is created instead.
 * Automatically opens the new file after creation.
 */
export async function newFile(vs: typeof vscode, contextItem: ServerItem) {
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
  const isFolder = name.endsWith('/');
  try {
    if (isFolder) {
      await vs.workspace.fs.createDirectory(uri);
      return;
    }
    await vs.workspace.fs.writeFile(uri, new Uint8Array());
    await vs.commands.executeCommand('vscode.open', uri);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    const type = isFolder ? 'folder' : 'file';
    void vs.window.showErrorMessage(
      `Failed to create ${type} "${name}": ${msg}`,
    );
  }
}

/**
 * Creates a new folder on the Colab server.
 *
 * Prompts the user for a name, validates it, and creates a directory.
 */
export async function newFolder(vs: typeof vscode, contextItem: ServerItem) {
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    void vs.window.showErrorMessage(
      `Failed to create folder "${name}": ${msg}`,
    );
  }
}

/**
 * Downloads a file from the Colab server to the local filesystem.
 */
export async function download(vs: typeof vscode, contextItem: ServerItem) {
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

function folderOrParent(vs: typeof vscode, item: ServerItem): Uri {
  return item.contextValue === 'file'
    ? vs.Uri.joinPath(item.uri, '..')
    : item.uri;
}
