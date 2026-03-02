/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import vscode from 'vscode';
import { ColabClient } from '../client';

/**
 * Prompts the user for a notebook URL and attempts to copy the notebook
 * contents into a local file
 */
export async function importNotebookFromUrl(
  vs: typeof vscode,
  client: ColabClient,
): Promise<void> {
  const inputUrl = await vs.window.showInputBox({
    prompt: 'Paste a Colab link (Drive or Notebooks)',
    placeHolder: 'https://colab.research.google.com/drive/...',
  });

  if (!inputUrl) return;

  try {
    const id = resolveRemoteSource(inputUrl);
    const metadata = await client.getDriveFileMetadata(id);
    const fileName = metadata.name;
    const targetUri = await getSaveLocation(vs, fileName);
    if (!targetUri) {
      return; // User cancelled
    }

    const content = await client.fetchDriveFileContent(id);

    await vs.workspace.fs.writeFile(targetUri, content);

    const doc = await vs.workspace.openNotebookDocument(targetUri);
    await vs.window.showNotebookDocument(doc);

    vs.window.showInformationMessage(
      `Successfully saved to ${targetUri.fsPath}`,
    );
  } catch (e) {
    vs.window.showErrorMessage(`${e.message}`);
  }
}

function resolveRemoteSource(url: string): string {
  // Check for Format 1: Colab Notebook URL (https://colab.researcg.google.com/drive/1n63kpahuH-sxBQ1lJ9zh0cf6-uI7vSuk)
  const colabMatch = url.match(/\/drive\/([a-zA-Z0-9_-]+)/);
  if (colabMatch && colabMatch.length == 2) {
    return colabMatch[1];
  }

  // Check for Format 2: Drive Notebook URL (https://drive.google.com/file/d/1hqzZq-7933qCLMAk1I1Md1QK02akdOsF/view?usp=drive_link)
  const driveMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (driveMatch && driveMatch.length == 2) {
    return driveMatch[1];
  }

  throw new Error('Unsupported Colab link format.');
}

async function getSaveLocation(
  vs: typeof vscode,
  defaultName: string,
): Promise<vscode.Uri | undefined> {
  const options: vscode.SaveDialogOptions = {
    defaultUri: vs.workspace.workspaceFolders
      ? vscode.Uri.joinPath(vs.workspace.workspaceFolders[0].uri, defaultName)
      : vscode.Uri.file(defaultName),
    filters: {
      'Jupyter Notebooks': ['ipynb'],
      'All Files': ['*'],
    },
    saveLabel: 'Download Notebook',
    title: 'Select where to save the notebook',
  };

  return await vscode.window.showSaveDialog(options);
}
