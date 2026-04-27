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
import { CodeUtil } from 'vscode-extension-tester/out/util/codeUtil';
import { CONFIG } from '../../colab-config';
import { doOAuthSignIn, getOAuthDriver } from './auth';
import {
  createNotebook,
  pushDialogButtonIfShown,
  hasQuickPickItem,
  pushDialogButton,
  selectQuickPickItem,
  selectQuickPickItemIfShown,
  KERNEL_SELECT_WAIT_MS,
} from './ui';

console.log('Running global E2E test setup...');

// Patch `CodeUtil.open` to pass `--no-sandbox` to the VS Code CLI it spawns
// to issue a folder-open IPC request to the running window. Without this
// flag, the spawned Electron process exits silently on CI runners (e.g.
// Ubuntu in GitHub Actions) where the chrome-sandbox binary lacks setuid
// root, and `extest`'s `-r/--open_resource` flag becomes a no-op. The
// matching `browser.start` flow already passes `--no-sandbox`; this aligns
// the two. See https://github.com/redhat-developer/vscode-extension-tester/issues/2050.
//
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalOpen = CodeUtil.prototype.open;
CodeUtil.prototype.open = function (this: CodeUtil, ...paths: string[]) {
  // Inject `--no-sandbox` as the first "path"; it's parsed as a flag because
  // it starts with `--`, regardless of position in the argv.
  originalOpen.call(this, '--no-sandbox', ...paths);
};

dotenv.config();
assert.equal(
  CONFIG.Environment,
  'production',
  'Unexpected extension environment. Run `npm run generate:config` with COLAB_EXTENSION_ENVIRONMENT="production".',
);

const DIALOG_WAIT_MS = 3000;

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

afterEach(async function () {
  // Close any editors opened by this test so the next test starts with a
  // clean workbench. Without this, leftover notebooks/cells from a failing
  // test bleed into the next test (e.g. cell-count assertions count cells
  // from the prior notebook).
  const workbench = new Workbench();
  const vsCodeDriver = workbench.getDriver();
  try {
    // Dismiss any leftover error/info modal first (e.g. a 504 surfaced by a
    // previous best-effort 'Colab: Remove Server' that arrived after the
    // earlier dismissal window closed). A modal blocks subsequent
    // executeCommand() calls so we must clear it before doing anything else.
    await pushDialogButtonIfShown(vsCodeDriver, 'OK', DIALOG_WAIT_MS);
    await workbench.executeCommand('View: Close All Editors');
    // Close-all may surface a "Don't Save" prompt if any notebook is dirty.
    await pushDialogButtonIfShown(vsCodeDriver, "Don't Save", DIALOG_WAIT_MS);
  } catch (err) {
    // Best-effort cleanup; never fail the test from afterEach.
    console.warn('Best-effort editor cleanup failed in afterEach:', err);
  }
});

async function signIn(
  workbench: Workbench,
  vsCodeDriver: WebDriver,
  chromeDriver: WebDriver,
) {
  await createNotebook(workbench);

  // Dismiss the telemetry notice modal if it appears. The extension activates
  // asynchronously after notebook creation, so we poll for the dialog. This is
  // a no-op when the notice was already acknowledged (e.g. developer machine).
  await pushDialogButtonIfShown(vsCodeDriver, 'Acknowledge', DIALOG_WAIT_MS);

  // Trigger Colab connection which will prompt for sign-in.
  await workbench.executeCommand('Notebook: Select Notebook Kernel');
  // If the test is running on a machine with a configured Python environment,
  // the "Select Another Kernel" option may appear instead of "Colab". If so,
  // we need to click it first before selecting "Colab". The kernel picker
  // can take a while to populate while Jupyter is "Detecting Kernels", so
  // these steps are given a longer-than-default budget.
  if (
    await hasQuickPickItem(
      vsCodeDriver,
      'Select Another Kernel',
      KERNEL_SELECT_WAIT_MS,
    )
  ) {
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

  // Cleanup so tests start from a clean slate. This is best-effort: we
  // intentionally swallow errors from cleanup steps so a transient backend
  // hiccup or stale UI state doesn't fail the entire suite. Tests that
  // follow recreate their own state.
  try {
    // Tolerant: with a single Python kernel the picker often auto-resolves
    // and closes before we can click.
    await selectQuickPickItemIfShown(
      vsCodeDriver,
      'Python',
      KERNEL_SELECT_WAIT_MS,
    );
    await workbench.executeCommand('Colab: Remove Server');
    try {
      await selectQuickPickItem(vsCodeDriver, 'Colab CPU');
    } catch (err: unknown) {
      console.warn('Could not select "Colab CPU" for cleanup.', err);
    }
    await workbench.executeCommand('View: Close All Editors');
    await pushDialogButtonIfShown(vsCodeDriver, "Don't Save", DIALOG_WAIT_MS);
  } catch (err: unknown) {
    console.warn(
      'Best-effort post-signin cleanup failed; continuing with tests.',
      err,
    );
  }
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
