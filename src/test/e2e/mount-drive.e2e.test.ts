/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { writeFileSync } from 'fs';
import clipboard from 'clipboardy';
import { Workbench, VSBrowser } from 'vscode-extension-tester';
import { doOAuthSignIn, getOAuthDriver } from './auth';
import {
  assertAllCellsExecutedSuccessfully,
  createNotebook,
  hasQuickPickItem,
  pushDialogButton,
  selectQuickPickItem,
  selectQuickPicksInOrder,
} from './ui';

const CONNECT_DRIVE_DIALOG_WAIT_MS = 30000;

it('mounts Google Drive', async () => {
  const workbench = new Workbench();
  const driver = workbench.getDriver();

  await createNotebook(workbench);
  // Delete the initial empty cell first because Mount Drive command will
  // insert code snippet in a new cell.
  await workbench.executeCommand('Notebook: Delete Cell');

  // Connect to Colab.
  await workbench.executeCommand('Notebook: Select Notebook Kernel');
  // If the test is running on a machine with a configured Python environment,
  // the "Select Another Kernel" option may appear instead of "Colab". If so, we
  // need to click it first before selecting "Colab".
  if (await hasQuickPickItem(driver, 'Select Another Kernel')) {
    await selectQuickPickItem(driver, 'Select Another Kernel');
  }
  await selectQuickPicksInOrder(driver, ['Colab', 'Auto Connect']);
  await selectQuickPickItem(driver, 'Python');

  // Kick-off Drive mounting.
  await workbench.executeCommand('Colab: Mount Google Drive to Server...');
  await workbench.executeCommand('Notebook: Run All');
  await pushDialogButton(
    driver,
    'Connect to Google Drive',
    CONNECT_DRIVE_DIALOG_WAIT_MS,
  );
  // Begin the sign-in process by copying the OAuth URL to the clipboard and
  // opening it in a browser window. Why do this instead of triggering the
  // "Open" button in the dialog? We copy the URL so that we can use a new
  // driver instance for the OAuth flow, since the original driver instance
  // does not have a handle to the window that would be spawned with "Open".
  await pushDialogButton(driver, 'Copy');

  // Authorize the extension to access Drive in the browser.
  await authorizeDrive();

  // In VS Code, click "Continue" and verify success.
  await pushDialogButton(driver, 'Continue');
  await assertAllCellsExecutedSuccessfully(driver, workbench);
});

async function authorizeDrive() {
  const chromeDriver = await getOAuthDriver();
  try {
    await doOAuthSignIn(
      chromeDriver,
      /* oauthUrl= */ clipboard.readSync(),
      /* expectedRedirectUrl= */ 'tun/m/authorize-for-drive-credentials-ephem',
    );
  } catch (err: unknown) {
    const screenshotsDir = VSBrowser.instance.getScreenshotsDir();
    writeFileSync(
      `${screenshotsDir}/authorize-drive-ephem-chrome.png`,
      await chromeDriver.takeScreenshot(),
      'base64',
    );
    throw err;
  }
}
