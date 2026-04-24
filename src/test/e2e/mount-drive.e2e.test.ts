/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, writeFileSync } from 'fs';
import clipboard from 'clipboardy';
import { Workbench, VSBrowser } from 'vscode-extension-tester';
import { doOAuthSignIn, getOAuthDriver } from './auth';
import {
  assertAllCellsExecutedSuccessfully,
  createNotebook,
  hasQuickPickItem,
  KERNEL_SELECT_WAIT_MS,
  pushDialogButton,
  selectQuickPickItem,
  selectQuickPickItemIfShown,
  selectQuickPicksInOrder,
} from './ui';

// The "Connect to Google Drive" dialog only appears once the kernel actually
// starts executing the mount cell. On a freshly assigned Colab server the
// kernel cold start and OAuth flow can be slow.
const CONNECT_DRIVE_DIALOG_WAIT_MS = 120000;

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
  await selectQuickPickItemIfShown(driver, 'Python', KERNEL_SELECT_WAIT_MS);

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
  const oauthUrl = clipboard.readSync();
  const expectedRedirectUrl = 'tun/m/authorize-for-drive-credentials-ephem';
  // Retry the OAuth flow once on transient errors. Chrome occasionally
  // returns ERR_FAILED loading accounts.google.com from the CI runner; a
  // single retry typically resolves the network blip.
  try {
    await doOAuthSignIn(chromeDriver, oauthUrl, expectedRedirectUrl);
  } catch (firstErr: unknown) {
    console.warn(
      'OAuth Drive sign-in failed once; retrying after a brief delay.',
      firstErr,
    );
    try {
      await chromeDriver.sleep(2000);
      await doOAuthSignIn(chromeDriver, oauthUrl, expectedRedirectUrl);
    } catch (retryErr: unknown) {
      // Best-effort capture of the chrome OAuth window state on failure.
      // The screenshots directory is created lazily by the test runner;
      // ensure it exists before writing so a missing directory doesn't mask
      // the real OAuth error with an unrelated ENOENT.
      try {
        const screenshotsDir = VSBrowser.instance.getScreenshotsDir();
        mkdirSync(screenshotsDir, { recursive: true });
        writeFileSync(
          `${screenshotsDir}/authorize-drive-ephem-chrome.png`,
          await chromeDriver.takeScreenshot(),
          'base64',
        );
      } catch (screenshotErr) {
        console.error(
          'Could not capture chrome OAuth screenshot on failure',
          screenshotErr,
        );
      }
      throw retryErr;
    }
  }
}
