/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  By,
  InputBox,
  Locator,
  ModalDialog,
  WebDriver,
  error as extestError,
} from 'vscode-extension-tester';

const ELEMENT_WAIT_MS = 10000;

/**
 * Selects the QuickPick option.
 */
export function selectQuickPickItem(
  driver: WebDriver,
  {
    item,
    quickPick,
  }: {
    item: string;
    quickPick: string;
  },
) {
  return driver.wait(
    async () => {
      try {
        const inputBox = await InputBox.create();
        // We check for the item's presence before selecting it, since
        // InputBox.selectQuickPick will not throw if the item is not found.
        const quickPickItem = await inputBox.findQuickPick(item);
        if (!quickPickItem) {
          return false;
        }
        await quickPickItem.select();
        return true;
      } catch (_) {
        // Swallow errors since we want to fail when our timeout's reached.
        return false;
      }
    },
    ELEMENT_WAIT_MS,
    `Select "${item}" item for QuickPick "${quickPick}" failed`,
  );
}

/**
 * Pushes a button in a modal dialog and waits for the action to complete.
 */
export function pushDialogButton(
  driver: WebDriver,
  {
    button,
    dialog,
  }: {
    button: string;
    dialog: string;
  },
) {
  // ModalDialog.pushButton will throw if the dialog is not found; to reduce
  // flakes we attempt this until it succeeds or times out.
  return driver.wait(
    async () => {
      try {
        const dialog = new ModalDialog();
        await dialog.pushButton(button);
        return true;
      } catch (_) {
        // Swallow the error since we want to fail when the timeout's reached.
        return false;
      }
    },
    ELEMENT_WAIT_MS,
    `Push "${button}" button for dialog "${dialog}" failed`,
  );
}

export async function notebookLoaded(driver: WebDriver): Promise<void> {
  await driver.wait(
    async () => {
      const editors = await driver.findElements(
        By.className('notebook-editor'),
      );
      return editors.length > 0;
    },
    ELEMENT_WAIT_MS,
    'Notebook editor did not load in time',
  );
}

/**
 * Waits for an element to be displayed and enabled, then clicks it.
 */
export async function safeClick(
  driver: WebDriver,
  locator: Locator,
  errorMsg: string,
): Promise<boolean> {
  return driver.wait(
    async () => {
      try {
        const element = await driver.findElement(locator);
        if ((await element.isDisplayed()) && (await element.isEnabled())) {
          await element.click();
          return true;
        }
        return false;
      } catch (e) {
        if (e instanceof extestError.StaleElementReferenceError) {
          return false;
        }
        throw e;
      }
    },
    ELEMENT_WAIT_MS,
    errorMsg,
  );
}
