/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import vscode from 'vscode';
import { log } from '../../common/logging';
import { DriveClient } from '../drive-client';

/**
 * Prompts the user for a notebook URL and attempts to copy the notebook
 * contents into a local file.
 *
 * @param vs - The VS Code module.
 * @param driveClient - The provider for interacting with Google Drive.
 * @param inputUrl - An optional URL to import the notebook from. If not
 * provided, the user will be prompted to enter one.
 */
export async function importNotebookFromUrl(
  vs: typeof vscode,
  driveClient: DriveClient,
  inputUrl?: string,
): Promise<void> {
  inputUrl ??= await vs.window.showInputBox({
    prompt: 'Link to the Colab Notebook to import',
    placeHolder: 'https://colab.research.google.com/drive/...',
  });

  if (!inputUrl) return;

  try {
    const id = resolveRemoteSource(inputUrl);
    const fileName = await driveClient.getDriveFileName(id);
    const targetUri = await getSaveLocation(vs, fileName);
    if (!targetUri) {
      return; // User cancelled
    }

    const content = await driveClient.getDriveFileContent(id);
    await vs.workspace.fs.writeFile(targetUri, content);

    const doc = await vs.workspace.openNotebookDocument(targetUri);
    await vs.window.showNotebookDocument(doc);

    vs.window.showInformationMessage(
      `Successfully saved to ${targetUri.fsPath}`,
    );
  } catch (e: unknown) {
    log.error('Failed to import notebook:', e);
    if (e instanceof Error) {
      vs.window.showErrorMessage(`Failed to import notebook: ${e.message}`);
    } else {
      vs.window.showErrorMessage(
        `An unknown error occurred while importing notebook: ${String(e)}`,
      );
    }
  }
}

function resolveRemoteSource(url: string): string {
  const supportedFormats = [
    {
      // Format 1: Colab Notebook URL
      regex: /\/drive\/([a-zA-Z0-9_-]+)/,
      description: '"https://colab.research.google.com/drive/..."',
    },
    {
      // Format 2: Drive Notebook URL
      regex: /\/file\/d\/([a-zA-Z0-9_-]+)/,
      description: '"https://drive.google.com/file/d/..."',
    },
  ];

  for (const format of supportedFormats) {
    const match = format.regex.exec(url);
    if (match?.length === 2) {
      return match[1];
    }
  }

  const descriptions = supportedFormats.map((f) => f.description);
  let formattedDescriptions: string;
  if (descriptions.length < 3) {
    formattedDescriptions = descriptions.join(' and ');
  } else {
    formattedDescriptions =
      descriptions.slice(0, -1).join(', ') +
      ', and ' +
      descriptions[descriptions.length - 1];
  }

  throw new Error(
    `Unsupported Colab link format. Supported formats are ${formattedDescriptions}`,
  );
}

async function getSaveLocation(
  vs: typeof vscode,
  defaultName: string,
): Promise<vscode.Uri | undefined> {
  const options: vscode.SaveDialogOptions = {
    defaultUri: vs.workspace.workspaceFolders
      ? vs.Uri.joinPath(vs.workspace.workspaceFolders[0].uri, defaultName)
      : vs.Uri.file(defaultName),
    filters: {
      'Jupyter Notebooks': ['ipynb'],
      'All Files': ['*'],
    },
    saveLabel: 'Import Notebook',
    title: 'Select where to save the notebook',
  };

  return await vs.window.showSaveDialog(options);
}
