/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from 'vscode';
import { log } from '../../common/logging';
import { telemetry } from '../../telemetry';
import { CommandSource } from '../../telemetry/api';
import { DriveClient } from '../client';
import { IMPORT_DRIVE_FILE_PATH, IMPORT_NOTEBOOK_FROM_URL } from './constants';

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
  telemetry.logImportNotebook(
    inputUrl
      ? CommandSource.COMMAND_SOURCE_ON_URI
      : CommandSource.COMMAND_SOURCE_COMMAND_PALETTE,
  );

  inputUrl ??= await vs.window.showInputBox({
    prompt: 'Link to the Colab Notebook to import',
    placeHolder: 'https://colab.research.google.com/drive/...',
    validateInput: validateImportUrl,
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
  } catch (e: unknown) {
    const msg = 'Failed to import notebook:';
    log.error(msg, e);
    if (e instanceof Error) {
      vs.window.showErrorMessage(`${msg} ${e.message}`);
    } else {
      vs.window.showErrorMessage(
        `An unknown error occurred while importing notebook: ${String(e)}`,
      );
    }
  }
}

/**
 * Handles incoming URI events for importing notebooks.
 * Expects URIs in the format: vscode://<publisher>.<extension-id>/import-drive-file?url=...
 *
 * @param vs - The VS Code module.
 * @param uri - The incoming URI to handle.
 */
export function handleImportUriEvents(
  vs: typeof vscode,
  uri: vscode.Uri,
): void {
  if (uri.path !== `/${IMPORT_DRIVE_FILE_PATH}`) {
    return;
  }

  const queryParams = new URLSearchParams(uri.query);
  const notebookUrl = queryParams.get('url');
  if (notebookUrl) {
    vs.commands.executeCommand(IMPORT_NOTEBOOK_FROM_URL.id, notebookUrl);
  }
}

function validateImportUrl(url: string): string | undefined {
  if (!url) return undefined;
  try {
    resolveRemoteSource(url);
    return undefined;
  } catch (e: unknown) {
    return e instanceof Error ? e.message : String(e);
  }
}

function resolveRemoteSource(urlString: string): string {
  let url: URL;
  try {
    //If it doesn't start with http:// or https://, prepend https://
    let formattedString = urlString.trim();
    if (!/^https?:\/\//i.test(formattedString)) {
      formattedString = 'https://' + formattedString;
    }
    url = new URL(formattedString);
  } catch (_e: unknown) {
    // Instantly reject malformed strings that aren't valid URLs
    throw new Error('Invalid URL string provided.');
  }

  const supportedFormats = [
    {
      // Format 1: Colab Notebook URL
      check: (u: URL) =>
        ['colab.research.google.com', 'colab.sandbox.google.com'].includes(
          u.hostname,
        )
          ? /^\/drive\/([a-zA-Z0-9_-]+)/.exec(u.pathname)?.[1]
          : null,
      description: '"https://colab.research.google.com/drive/..."',
    },
    {
      // Format 2: Drive Notebook URL
      check: (u: URL) =>
        u.hostname === 'drive.google.com'
          ? /^\/file\/d\/([a-zA-Z0-9_-]+)/.exec(u.pathname)?.[1]
          : null,
      description: '"https://drive.google.com/file/d/..."',
    },
    {
      // Format 3: Older Drive URL
      check: (u: URL) => {
        if (u.hostname === 'drive.google.com' && u.pathname === '/open') {
          const id = u.searchParams.get('id');
          return id && /^[a-zA-Z0-9_-]+$/.test(id) ? id : null;
        }
        return null;
      },
      description: '"https://drive.google.com/open?id=..."',
    },
  ];

  for (const format of supportedFormats) {
    const id = format.check(url);
    if (id) {
      return id;
    }
  }

  const descriptions = supportedFormats.map((f) => f.description);
  const formattedDescriptions = new Intl.ListFormat('en-US', {
    style: 'long',
    type: 'conjunction',
  }).format(descriptions);

  throw new Error(
    `Unsupported Colab link format. Supported formats are ${formattedDescriptions}`,
  );
}

async function getSaveLocation(
  vs: typeof vscode,
  defaultName: string,
): Promise<vscode.Uri | undefined> {
  const options: vscode.SaveDialogOptions = {
    defaultUri: vs.workspace.workspaceFolders?.length
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

// Needed to test the validation on the input box
export const TEST_ONLY = {
  validateImportUrl,
};
