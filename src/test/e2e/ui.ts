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
  Workbench,
  error as extestError,
} from 'vscode-extension-tester';

const ELEMENT_WAIT_MS = 10000;
const CELL_EXECUTION_WAIT_MS = 30000;

/**
 * Creates a new Jupyter notebook and waits for it to be fully loaded.
 *
 * @param workbench - The workbench instance.
 */
export async function createNotebook(workbench: Workbench): Promise<void> {
  await workbench.executeCommand('Create: New Jupyter Notebook');
  await notebookLoaded(workbench.getDriver());
}

/**
 * Selects the QuickPick option.
 *
 * @param driver - The driver instance.
 * @param item - The UI item.
 * @returns A promise that resolves when the QuickPick item is selected.
 */
export function selectQuickPickItem(driver: WebDriver, item: string) {
  return driver.wait(
    async () => {
      try {
        const inputBox = await InputBox.create();
        // Some hover events can interfere with clicking the quick pick item.
        // Filtering the text first to ensure we click the right item.
        await inputBox.setText(item);
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
    `Could not select "${item}" from QuickPick`,
  );
}

/**
 * Checks whether a QuickPick item is present in the current QuickPick options.
 *
 * @param driver - The driver instance.
 * @param item - The UI item.
 * @returns A promise that resolves to true if the item is found, and false
 * otherwise.
 */
export async function hasQuickPickItem(
  driver: WebDriver,
  item: string,
): Promise<boolean> {
  const containsOrOthers = await driver.wait(
    async () => {
      try {
        const inputBox = await InputBox.create();
        const quickPickItem = await inputBox.findQuickPick(item);
        if (quickPickItem) {
          return true;
        }
        const items = await inputBox.getQuickPicks();
        // A QuickPick was rendered with options other than the one we're
        // looking for.
        if (items.length !== 0) {
          return await Promise.all(items.map(async (i) => await i.getLabel()));
        }
        // No QuickPick items were shown, which likely means the QuickPick is
        // still loading. Keep waiting.
        return false;
      } catch (_) {
        // Swallow errors since we want to fail when our timeout's reached.
        return false;
      }
    },
    ELEMENT_WAIT_MS,
    `Could not find "${item}" in QuickPick`,
  );
  if (typeof containsOrOthers === 'boolean') {
    return containsOrOthers;
  }
  const others = containsOrOthers;
  console.log(
    `Could not find "${item}" in QuickPick, available items: ${others.join(', ')}`,
  );
  return false;
}

/**
 * Selects the QuickPick options in order.
 *
 * Useful for selecting through multiple QuickPick prompts in a row.
 *
 * @param driver - The driver instance.
 * @param items - The UI items collection.
 */
export async function selectQuickPicksInOrder(
  driver: WebDriver,
  items: string[],
) {
  for (const item of items) {
    await selectQuickPickItem(driver, item);
  }
}

/**
 * Attempts to push a button in a modal dialog, if one is present.
 *
 * Polls for up to {@link waitMs} for the dialog to appear. If no dialog is
 * shown within that window, returns silently. Unlike {@link pushDialogButton},
 * this does not fail on timeout.
 *
 * @param driver - The driver instance.
 * @param button - The button to push if the dialog is present.
 * @param waitMs - How long to wait for the dialog to appear.
 */
export async function tryPushDialogButton(
  driver: WebDriver,
  button: string,
  waitMs: number = ELEMENT_WAIT_MS,
): Promise<void> {
  try {
    await pushDialogButton(driver, button, waitMs);
  } catch {
    // Dialog never appeared within the wait window -- nothing to dismiss.
  }
}

/**
 * Pushes a button in a modal dialog and waits for the action to complete.
 *
 * @param driver - The driver instance.
 * @param button - The button element.
 * @param waitMs - How long to wait for the dialog to appear.
 * @returns A promise that resolves when the button is successfully pushed.
 */
export function pushDialogButton(
  driver: WebDriver,
  button: string,
  waitMs: number = ELEMENT_WAIT_MS,
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
    waitMs,
    `Could not select "${button}" from dialog`,
  );
}

/**
 * Waits for an element to be displayed and enabled, then clicks it.
 *
 * @param driver - The driver instance.
 * @param locator - The UI locator string.
 * @param errorMsg - The error message.
 * @returns A promise that resolves when the element is successfully clicked.
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

/**
 * Asserts that all cells in the active notebook have executed successfully.
 *
 * This is done by checking for the success indicator in the cell status bar.
 *
 * @param driver - The driver instance.
 * @param workbench - The workbench instance.
 * @param waitMs - The wait duration in milliseconds.
 */
export async function assertAllCellsExecutedSuccessfully(
  driver: WebDriver,
  workbench: Workbench,
  waitMs: number = CELL_EXECUTION_WAIT_MS,
): Promise<void> {
  // Poll for the success indicator (green check).
  // Why not the cell output? Because the output is rendered in a webview.
  await driver.wait(
    async () => {
      const container = workbench.getEnclosingElement();
      const cells = await container.findElements(
        By.className('cell-statusbar-container'),
      );
      const successElements = await container.findElements(
        By.className('codicon-notebook-state-success'),
      );
      const errorElements = await container.findElements(
        By.className('codicon-notebook-state-error'),
      );
      return (
        successElements.length === cells.length && errorElements.length === 0
      );
    },
    waitMs,
    'Not all cells executed successfully',
  );
}

async function notebookLoaded(driver: WebDriver): Promise<void> {
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
