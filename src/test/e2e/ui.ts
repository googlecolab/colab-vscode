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

/**
 * The Jupyter "Detecting Kernels" phase can take a while on a fresh CI runner
 * before the kernel-source QuickPick is populated with "Colab". Give the kernel
 * picker a generous budget.
 */
export const KERNEL_SELECT_WAIT_MS = 30000;

/**
 * A general wait duration for UI elements to appear, in milliseconds.
 */
const ELEMENT_WAIT_MS = 10000;

/**
 * Short timeout for "is anything open?" probes. Long enough to absorb the
 * normal driver round-trip latency, short enough that the absence case
 * (nothing open) is cheap.
 */
const DIALOG_CHECK_WAIT_MS = 500;

/**
 * The wait duration for all notebook cells to execute, in milliseconds.
 *
 * Cell execution can be slow on a freshly assigned Colab server.
 */
const CELL_EXECUTION_WAIT_MS = 120000;

/**
 * Reads identity hints from the picker currently on screen, in priority
 * order: title bar text, the input element's `aria-label`, and finally the
 * `placeholder`. Returns whatever it could observe (any field may be
 * `undefined`); does not throw.
 *
 * VS Code uses a single shared `<input>` element for all QuickPick/InputBox
 * surfaces and just swaps these attributes when the active picker changes,
 * so reading them is how you tell which picker is up.
 *
 * @param inputBox - An open InputBox handle.
 * @returns The picker identity hints; each field may be `undefined` when
 * the corresponding attribute is missing or unreadable.
 */
export async function pickerIdentity(inputBox: InputBox): Promise<{
  title?: string;
  ariaLabel?: string;
  placeholder?: string;
}> {
  // Each read is best-effort; if any selector mismatches the current DOM we
  // still want to return what we got.
  let title: string | undefined;
  try {
    title = await inputBox.getTitle();
  } catch {
    /* leave undefined */
  }
  let placeholder: string | undefined;
  try {
    placeholder = await inputBox.getPlaceHolder();
  } catch {
    /* leave undefined */
  }
  let ariaLabel: string | undefined;
  try {
    // Reach for the underlying <input> element. The redhat page-objects
    // package doesn't expose this directly so we re-derive it from the
    // same locator chain `getPlaceHolder()` uses internally.
    const input = await inputBox
      .findElement(By.className('monaco-inputbox'))
      .findElement(By.className('input'));
    const attr = await input.getAttribute('aria-label');
    ariaLabel = attr || undefined;
  } catch {
    /* leave undefined */
  }
  return { title, ariaLabel, placeholder };
}

/**
 * Dismisses any currently-open InputBox / QuickPick by pressing ESCAPE and
 * waits for it to actually disappear before returning. Safe to call when no
 * picker is open (returns immediately).
 *
 * Why this exists: VS Code reuses a single `<input>` element for the command
 * palette, the kernel picker, `Colab: Remove Server`, etc. If a prior step
 * leaves a picker open (e.g. a cleanup `selectQuickPickItem` times out),
 * every subsequent `executeCommand` call sends Ctrl+Shift+P that gets
 * absorbed by the still-focused orphan picker and the `>command` text is
 * typed into its filter instead of being executed.
 *
 * @param driver - The driver instance.
 * @param waitMs - How long to wait for the input to disappear after ESCAPE.
 */
export async function dismissAnyOpenInput(
  driver: WebDriver,
  waitMs: number = ELEMENT_WAIT_MS,
): Promise<void> {
  let inputBox: InputBox;
  try {
    inputBox = await InputBox.create(DIALOG_CHECK_WAIT_MS);
  } catch {
    return; // Nothing is open.
  }
  try {
    await inputBox.cancel();
  } catch {
    // Element may have gone stale between probe and cancel; fall through to
    // the disappear wait below.
  }
  // Confirm the input is actually gone. If a new picker pops up immediately
  // (rare, but possible if an extension reacts to dismissal) we accept that
  // and let the next step handle it.
  await driver
    .wait(async () => {
      try {
        await InputBox.create(DIALOG_CHECK_WAIT_MS);
        return false;
      } catch {
        return true;
      }
    }, waitMs)
    .catch(() => {
      // Best-effort: a picker is still on screen but it's no longer ours to
      // clean up; let the caller proceed.
    });
}

/**
 * Creates a new Jupyter notebook and waits for it to be fully loaded.
 *
 * @param workbench - The workbench instance.
 */
export async function createNotebook(workbench: Workbench): Promise<void> {
  await safeExecuteCommand(workbench, 'Create: New Jupyter Notebook');
  await notebookLoaded(workbench.getDriver());
}

/**
 * Like {@link Workbench.executeCommand} but guarantees no orphan
 * QuickPick/InputBox is open beforehand. See {@link dismissAnyOpenInput}
 * for the motivation.
 *
 * Prefer this over `workbench.executeCommand(...)` for every e2e step.
 *
 * @param workbench - The workbench instance.
 * @param command - The command to execute (no leading `>`).
 */
export async function safeExecuteCommand(
  workbench: Workbench,
  command: string,
): Promise<void> {
  await dismissAnyOpenInput(workbench.getDriver());
  await workbench.executeCommand(command);
}

/**
 * Selects an item from the QuickPick currently on screen, asserting first
 * that the open picker is the one the caller expects.
 *
 * The picker-identity guard is the load-bearing part of this helper.
 * Without it, the bare `InputBox.create()` + `setText(item)` sequence will
 * happily type `item` into whatever picker is open — including pickers that
 * a previous test step opened and didn't dismiss (e.g. an orphan
 * `Colab: Remove Server` picker). When that happens the test "succeeds" at
 * filtering the wrong picker's list, then fails with a misleading
 * timeout/no-such-element later. The guard converts those silent failures
 * into a poll-and-wait for the *correct* picker.
 *
 * Note: this still uses `setText`, which clears and refills the input. If
 * the picker on screen flips between the guard check and the setText call,
 * the worst case is that the iteration's `findQuickPick` returns nothing and
 * we retry. We never type into a picker we didn't assert on.
 *
 * @param driver - The driver instance.
 * @param expectedPickerSubstring - A substring uniquely identifying the
 * picker the caller expects on screen. {@link pickerIdentity} checks this
 * against the input's title bar text, `aria-label`, and `placeholder`, so
 * any reliable substring of one of those works (e.g. `"Remove Server"` for
 * the title bar, `"kernel source"` for the placeholder). Use `undefined`
 * only when you genuinely don't care which picker is open (rare; almost
 * always wrong for e2e tests).
 * @param item - The QuickPick item label substring to select.
 * @param waitMs - Total wait budget for both the picker to appear and the
 * item to be matched.
 * @returns A promise that resolves when the QuickPick item is selected, or
 * rejects on timeout. On timeout the rejection message includes the
 * identity of whatever picker was on screen and the items it offered, to
 * make debugging cheaper.
 */
export function selectQuickPickItem(
  driver: WebDriver,
  expectedPickerSubstring: string | undefined,
  item: string,
  waitMs: number = ELEMENT_WAIT_MS,
): Promise<void> {
  // Track the most recent observation so the timeout message has something
  // actionable to report — without this the failure looks identical whether
  // the wrong picker was open, the right picker was empty, or no picker
  // ever appeared.
  const lastSeen: {
    identity?: { title?: string; ariaLabel?: string; placeholder?: string };
    items?: string[];
  } = {};

  return driver
    .wait(
      async () => {
        try {
          const inputBox = await InputBox.create(DIALOG_CHECK_WAIT_MS);
          const identity = await pickerIdentity(inputBox);
          lastSeen.identity = identity;
          if (expectedPickerSubstring !== undefined) {
            const candidates = [
              identity.title,
              identity.ariaLabel,
              identity.placeholder,
            ];
            if (!pickerIdentityMatches(candidates, expectedPickerSubstring)) {
              return false;
            }
          }
          // Some hover events can interfere with clicking the quick pick
          // item. Filtering the text first to ensure we click the right
          // item.
          await inputBox.setText(item);
          // Check for the item's presence before selecting it, since
          // `InputBox.selectQuickPick` does not throw if the item is missing.
          const quickPickItem = await inputBox.findQuickPick(item);
          if (!quickPickItem) {
            // Snapshot what items the picker offered so we can include them
            // in the timeout message; best-effort.
            try {
              const picks = await inputBox.getQuickPicks();
              lastSeen.items = await Promise.all(
                picks.map((p) => p.getLabel()),
              );
            } catch {
              // Ignore; we'll just print whatever we have.
            }
            return false;
          }
          await quickPickItem.select();
          return true;
        } catch {
          // Swallow errors since we want to fail when our timeout's reached.
          return false;
        }
      },
      waitMs,
      formatSelectTimeoutMessage(expectedPickerSubstring, item, lastSeen),
    )
    .then(() => undefined);
}

/**
 * Like {@link selectQuickPickItem} but tolerant of the picker never
 * appearing (or appearing without the requested item). Resolves to `true`
 * if the item was selected, `false` otherwise; never throws on absence.
 *
 * Useful for steps where the picker may auto-select the only option (e.g.
 * when there is just one Python kernel available) and close before the
 * test gets a chance to click it. The picker-identity guard still applies:
 * an open picker that isn't the expected one is treated the same as no
 * picker at all (returns `false` after the wait window).
 *
 * @param driver - The driver instance.
 * @param expectedPickerSubstring - A substring uniquely identifying the
 * picker the caller expects on screen. See {@link selectQuickPickItem} for
 * how this is matched.
 * @param item - The QuickPick item label substring to select.
 * @param waitMs - The wait duration in milliseconds.
 * @returns `true` if the item was selected, `false` otherwise.
 */
export async function selectQuickPickItemIfShown(
  driver: WebDriver,
  expectedPickerSubstring: string | undefined,
  item: string,
  waitMs: number = ELEMENT_WAIT_MS,
): Promise<boolean> {
  try {
    await selectQuickPickItem(driver, expectedPickerSubstring, item, waitMs);
    return true;
  } catch {
    return false;
  }
}

function formatSelectTimeoutMessage(
  expectedPickerSubstring: string | undefined,
  item: string,
  lastSeen: {
    identity?: { title?: string; ariaLabel?: string; placeholder?: string };
    items?: string[];
  },
): string {
  const parts: string[] = [`Could not select "${item}" from QuickPick`];
  if (expectedPickerSubstring !== undefined) {
    parts.push(`(expected picker matching "${expectedPickerSubstring}")`);
  }
  const id = lastSeen.identity;
  if (id) {
    const observed = [
      id.title && `title="${id.title}"`,
      id.ariaLabel && `aria-label="${id.ariaLabel}"`,
      id.placeholder && `placeholder="${id.placeholder}"`,
    ].filter(Boolean);
    if (observed.length > 0) {
      parts.push(`last observed picker: ${observed.join(', ')}`);
    }
  }
  if (lastSeen.items) {
    parts.push(`available items: [${lastSeen.items.join(', ')}]`);
  }
  return parts.join('; ');
}

/**
 * Checks whether a QuickPick item is present in the current QuickPick options.
 *
 * This is a non-throwing presence check: it returns `false` (rather than
 * throwing) if no QuickPick is shown within {@link waitMs}, or if a
 * QuickPick is shown but does not contain `item`. Callers that need a hard
 * requirement should use {@link selectQuickPickItem} instead.
 *
 * @param driver - The driver instance.
 * @param expectedPickerSubstring - A substring uniquely identifying the
 * picker the caller expects on screen, or `undefined` to skip the
 * picker-identity check. See {@link selectQuickPickItem} for how this is
 * matched.
 * @param item - The UI item.
 * @param waitMs - The wait duration in milliseconds.
 * @returns A promise that resolves to true if the item is found, and false
 * otherwise.
 */
export async function hasQuickPickItem(
  driver: WebDriver,
  expectedPickerSubstring: string | undefined,
  item: string,
  waitMs: number = ELEMENT_WAIT_MS,
): Promise<boolean> {
  let containsOrOthers: boolean | string[];
  try {
    containsOrOthers = await driver.wait(async () => {
      try {
        const inputBox = await InputBox.create(DIALOG_CHECK_WAIT_MS);
        if (expectedPickerSubstring !== undefined) {
          const identity = await pickerIdentity(inputBox);
          if (
            !pickerIdentityMatches(
              [identity.title, identity.ariaLabel, identity.placeholder],
              expectedPickerSubstring,
            )
          ) {
            // Wrong picker on screen; keep polling for the right one.
            return false;
          }
        }
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
    }, waitMs);
  } catch {
    // No QuickPick (or no items) appeared within the wait window. Treat as
    // "item not present" rather than failing the caller.
    return false;
  }
  if (typeof containsOrOthers === 'boolean') {
    return containsOrOthers;
  }
  const others = containsOrOthers;
  console.info(
    `(Not an error) Presence check for "${item}" in QuickPick came up dry, available items: ${others.join(', ')}`,
  );
  return false;
}

/**
 * A single step in a {@link selectQuickPicksInOrder} call: the picker
 * expected to be on screen, and the item to pick from it.
 */
export interface QuickPickStep {
  /**
   * Substring uniquely identifying the picker. See
   * {@link selectQuickPickItem} for how this is matched.
   */
  picker: string;
  /** QuickPick item label substring to select. */
  item: string;
  /** Optional override for the default per-step wait budget. */
  waitMs?: number;
}

/**
 * Selects the QuickPick options in order.
 *
 * Useful for selecting through multiple QuickPick prompts in a row. Each
 * step asserts the expected picker is on screen before typing into it.
 *
 * @param driver - The driver instance.
 * @param steps - The picker + item pairs to step through.
 */
export async function selectQuickPicksInOrder(
  driver: WebDriver,
  steps: readonly QuickPickStep[],
): Promise<void> {
  for (const step of steps) {
    await selectQuickPickItem(driver, step.picker, step.item, step.waitMs);
  }
}

/**
 * Confirms an InputBox identified by a substring of its title (or
 * aria-label / placeholder), accepting its current (default) value.
 *
 * Why not `InputBox.create()` + `sendKeys(Key.ENTER)` directly? Because of a
 * subtle race during QuickPick → InputBox transitions: the previous QuickPick
 * input may still be focused when `InputBox.create()` returns, and the ENTER
 * keystroke can be lost or delivered to the wrong element. Subsequent calls
 * then end up typing kernel-selection filter text into the still-open alias
 * input.
 *
 * This helper polls until an InputBox matching {@link expectedPickerSubstring}
 * is shown, confirms it, and then waits for that input to transition away
 * (i.e., either close or be replaced by an unrelated input). Only then does
 * it return, guaranteeing follow-up `selectQuickPickItem` calls operate on
 * the next UI surface.
 *
 * @param driver - The driver instance.
 * @param expectedPickerSubstring - A substring uniquely identifying the
 * picker the caller expects on screen. See {@link selectQuickPickItem} for
 * how this is matched.
 */
export async function confirmInputBoxWithDefault(
  driver: WebDriver,
  expectedPickerSubstring: string,
): Promise<void> {
  const matchesExpected = async (inputBox: InputBox) => {
    const identity = await pickerIdentity(inputBox);
    return pickerIdentityMatches(
      [identity.title, identity.ariaLabel, identity.placeholder],
      expectedPickerSubstring,
    );
  };

  // Phase 1: wait for the expected InputBox to be shown, then confirm it.
  await driver.wait(
    async () => {
      try {
        const inputBox = await InputBox.create(DIALOG_CHECK_WAIT_MS);
        if (!(await matchesExpected(inputBox))) {
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
    `Could not confirm InputBox matching "${expectedPickerSubstring}"`,
  );

  // Phase 2: wait for the InputBox to transition away. It either closes
  // entirely or is replaced by an unrelated InputBox/QuickPick that does
  // not match the expected substring.
  await driver.wait(
    async () => {
      try {
        const inputBox = await InputBox.create(DIALOG_CHECK_WAIT_MS);
        return !(await matchesExpected(inputBox));
      } catch {
        // No InputBox present at all, transition complete.
        return true;
      }
    },
    ELEMENT_WAIT_MS,
    `InputBox "${expectedPickerSubstring}" did not close after confirm`,
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

/**
 * Returns true if any of the candidate identity strings observed from the
 * picker on screen contains the expected substring.
 *
 * @param candidates - Identity strings observed from the picker on screen
 * (title, aria-label, placeholder). Falsy entries are ignored.
 * @param expectedSubstring - The substring that uniquely identifies the
 * picker the caller expects (e.g. `"Remove Server"`).
 * @returns `true` when at least one candidate contains `expectedSubstring`.
 */
function pickerIdentityMatches(
  candidates: readonly (string | undefined | null)[],
  expectedSubstring: string,
): boolean {
  return candidates.some((c) => !!c && c.includes(expectedSubstring));
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
