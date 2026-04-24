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
// Cell execution can be slow on a freshly assigned Colab server: the server
// has to finish booting, the kernel has to start, the websocket has to
// connect, and only then can the cells execute. 30s was occasionally too
// tight for cold-start cases (kernel still showing "Connecting to kernel..."
// when the wait expired). 60s gives a comfortable margin without slowing
// the happy path (the wait returns as soon as all cells succeed).
const CELL_EXECUTION_WAIT_MS = 60000;

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
      } catch {
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
 * This is a non-throwing presence check: it returns `false` (rather than
 * throwing) if no QuickPick is shown within {@link ELEMENT_WAIT_MS}, or if
 * a QuickPick is shown but does not contain `item`. Callers that need a
 * hard requirement should use {@link selectQuickPickItem} instead.
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
  let containsOrOthers: boolean | string[];
  try {
    containsOrOthers = await driver.wait(async () => {
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
      } catch {
        // Swallow errors so we keep polling until the timeout fires.
        return false;
      }
    }, ELEMENT_WAIT_MS);
  } catch {
    // No QuickPick (or no items) appeared within the wait window. Treat as
    // "item not present" rather than failing the caller.
    return false;
  }
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
 * Confirms an InputBox identified by a substring of its title, accepting its
 * current (default) value.
 *
 * Why not `InputBox.create()` + `sendKeys(Key.ENTER)` directly? Because of a
 * subtle race during QuickPick → InputBox transitions: the previous QuickPick
 * input may still be focused when `InputBox.create()` returns, and the ENTER
 * keystroke can be lost or delivered to the wrong element. Subsequent calls
 * then end up typing kernel-selection filter text into the still-open alias
 * input.
 *
 * This helper polls until an InputBox with the expected title is shown,
 * confirms it, and then waits for that input to transition away (i.e., either
 * close or be replaced by an unrelated input). Only then does it return,
 * guaranteeing follow-up `selectQuickPickItem` calls operate on the next UI
 * surface.
 *
 * @param driver - The driver instance.
 * @param expectedTitleSubstring - A substring expected to appear in the
 * InputBox title (e.g. `"Alias your server"`).
 */
export async function confirmInputBoxWithDefault(
  driver: WebDriver,
  expectedTitleSubstring: string,
): Promise<void> {
  // Phase 1: wait for the expected InputBox to be shown, then confirm it.
  await driver.wait(
    async () => {
      try {
        const inputBox = await InputBox.create();
        const title = await inputBox.getTitle();
        if (!title?.includes(expectedTitleSubstring)) {
          return false;
        }
        await inputBox.confirm();
        return true;
      } catch {
        // Swallow errors so we keep polling until the timeout fires.
        return false;
      }
    },
    ELEMENT_WAIT_MS,
    `Could not confirm InputBox with title containing "${expectedTitleSubstring}"`,
  );

  // Phase 2: wait for the InputBox to transition away. It either closes
  // entirely or is replaced by an unrelated InputBox/QuickPick whose title
  // does not contain the expected substring.
  await driver.wait(
    async () => {
      try {
        const inputBox = await InputBox.create();
        const title = await inputBox.getTitle();
        return !title?.includes(expectedTitleSubstring);
      } catch {
        // No InputBox present at all, transition complete.
        return true;
      }
    },
    ELEMENT_WAIT_MS,
    `InputBox "${expectedTitleSubstring}" did not close after confirm`,
  );
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
export async function pushDialogButtonIfShown(
  driver: WebDriver,
  button: string,
  waitMs: number = ELEMENT_WAIT_MS,
): Promise<void> {
  try {
    await pushDialogButton(driver, button, waitMs);
  } catch {
    // Dialog never appeared within the wait window, nothing to dismiss.
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
      } catch {
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
