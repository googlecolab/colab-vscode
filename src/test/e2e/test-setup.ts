/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { assert } from 'chai';
import clipboard from 'clipboardy';
import dotenv from 'dotenv';
import { VSBrowser, WebDriver, Workbench } from 'vscode-extension-tester';
import { CONFIG } from '../../colab-config';
import { doOAuthSignIn, getOAuthDriver } from './auth';
import {
  createNotebook,
  hasQuickPickItem,
  pushDialogButton,
  selectQuickPickItem,
} from './ui';

console.log('Running global E2E test setup...');
dotenv.config();
assert.equal(
  CONFIG.Environment,
  'production',
  'Unexpected extension environment. Run `npm run generate:config` with COLAB_EXTENSION_ENVIRONMENT="production".',
);

before(async function () {
  console.log('Starting global E2E test setup...');
  const workbench = new Workbench();
  const vsCodeDriver = workbench.getDriver();
  const chromeDriver = await getOAuthDriver();
  await vsCodeDriver.sleep(8000);

  try {
    await signIn(workbench, vsCodeDriver, chromeDriver);

    // Wait for the auth state to fully propagate in VS Code.
    await vsCodeDriver.sleep(5000);
  } catch (err: unknown) {
    console.error('Error during test setup:', err);
    try {
      await captureScreenshots(vsCodeDriver, chromeDriver);
    } catch (screenshotErr) {
      console.error(
        'Error capturing screenshots during test setup failure',
        screenshotErr,
      );
    }
    throw err;
  }
  console.log('Finished global E2E test setup.');
});

async function signIn(
  workbench: Workbench,
  vsCodeDriver: WebDriver,
  chromeDriver: WebDriver,
) {
  await createNotebook(workbench);

  // Trigger Colab connection which will prompt for sign-in.
  await workbench.executeCommand('Notebook: Select Notebook Kernel');
  // If the test is running on a machine with a configured Python environment,
  // the "Select Another Kernel" option may appear instead of "Colab". If so, we
  // need to click it first before selecting "Colab".
  if (await hasQuickPickItem(vsCodeDriver, 'Select Another Kernel')) {
    await selectQuickPickItem(vsCodeDriver, 'Select Another Kernel');
  }
  await selectQuickPickItem(vsCodeDriver, 'Colab');
  await selectQuickPickItem(vsCodeDriver, 'Auto Connect');

  // Sign in.
  await pushDialogButton(vsCodeDriver, 'Allow');
  await pushDialogButton(vsCodeDriver, 'Copy');
  await doOAuthSignIn(
    chromeDriver,
    /* oauthUrl= */ clipboard.readSync(),
    /* expectedRedirectUrl= */ 'vscode/auth-success',
  );

  // Cleanup so tests start from a clean slate.
  await selectQuickPickItem(vsCodeDriver, 'Python');
  await workbench.executeCommand('Colab: Remove Server');
  await selectQuickPickItem(vsCodeDriver, 'Colab CPU');
  await workbench.executeCommand('View: Close All Editors');
  await pushDialogButton(vsCodeDriver, "Don't Save");
}

async function captureScreenshots(
  vsCodeDriver: WebDriver,
  chromeDriver: WebDriver,
) {
  const screenshotsDir = VSBrowser.instance.getScreenshotsDir();
  if (!existsSync(screenshotsDir)) {
    mkdirSync(screenshotsDir, { recursive: true });
  }
  await writeScreenshot(vsCodeDriver, 'e2e-setup-vscode');
  await writeScreenshot(chromeDriver, 'e2e-setup-oauth-chrome');
}

async function writeScreenshot(driver: WebDriver, name: string) {
  const screenshotsDir = VSBrowser.instance.getScreenshotsDir();
  const filePath = path.join(screenshotsDir, `${name}.png`);
  console.log(`Writing screenshot to ${filePath}`);
  writeFileSync(filePath, await driver.takeScreenshot(), 'base64');
}
