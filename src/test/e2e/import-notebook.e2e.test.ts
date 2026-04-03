/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import clipboard from 'clipboardy';
import {
  Workbench,
  InputBox,
  TextEditor,
  VSBrowser,
} from 'vscode-extension-tester';
import { doIncrementalOAuthSignIn, getOAuthDriver } from './auth';
import { pushDialogButton } from './ui';

// Owned by the colab test account, anyone with a link should have read access
const NOTEBOOK_URL =
  'https://colab.research.google.com/drive/1wkAcggP4rr0zkEXupVfOSwNE62jciQ_J';

it('imports a notebook from a URL', async () => {
  const workbench = new Workbench();
  const driver = workbench.getDriver();

  await workbench.executeCommand('Colab: Import notebook file from URL');

  // Get URL
  const urlInputBox = await InputBox.create();
  await urlInputBox.setText(NOTEBOOK_URL);
  await urlInputBox.confirm();

  // Sign in.
  await pushDialogButton(driver, 'Allow');
  await pushDialogButton(driver, 'Copy');
  await authorizeDrive();

  // Pick save location
  const saveInputBox = await InputBox.create();
  const existingFileName = await saveInputBox.getText();
  const targetDirectory = path.resolve(__dirname, '..', 'test-output-folder');
  const finalSavePath = path.join(targetDirectory, existingFileName);
  // Clean up the file if it already exists from a previous run
  if (fs.existsSync(finalSavePath)) {
    fs.unlinkSync(finalSavePath);
  }
  await saveInputBox.setText(finalSavePath);
  await saveInputBox.confirm();

  // Wait some time to allow the file to be opened
  await driver.sleep(5000);

  // Grab the currently active text editor
  const editor = new TextEditor();
  // Verify the file name by checking the tab title
  const activeTabTitle = await editor.getTitle();
  assert.strictEqual(
    activeTabTitle,
    existingFileName.slice(1),
    `Verification failed: Expected active tab to be '${existingFileName}', but found '${activeTabTitle}'`,
  );
});

async function authorizeDrive() {
  const chromeDriver = await getOAuthDriver();
  try {
    await doIncrementalOAuthSignIn(
      chromeDriver,
      /* oauthUrl= */ clipboard.readSync(),
      /* expectedRedirectUrl= */ 'vscode/auth-success',
    );
  } catch (err: unknown) {
    const screenshotsDir = VSBrowser.instance.getScreenshotsDir();
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(screenshotsDir, 'import-drive-notebook-chrome.png'),
      await chromeDriver.takeScreenshot(),
      'base64',
    );
    throw err;
  }
}
