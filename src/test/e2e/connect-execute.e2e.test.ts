/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Workbench, WebElement } from 'vscode-extension-tester';
import {
  assertAllCellsExecutedSuccessfully,
  confirmInputBoxWithDefault,
  createNotebook,
  hasQuickPickItem,
  KERNEL_SELECT_WAIT_MS,
  safeExecuteCommand,
  selectQuickPickItem,
  selectQuickPicksInOrder,
} from './ui';

it('executes basic code cells', async () => {
  const workbench = new Workbench();
  const driver = workbench.getDriver();

  await createNotebook(workbench);

  // Connect to Colab.
  await safeExecuteCommand(workbench, 'Notebook: Select Notebook Kernel');
  // If the test is running on a machine with a configured Python environment,
  // the "Select Another Kernel" option may appear instead of "Colab". If so, we
  // need to click it first before selecting "Colab".
  if (
    await hasQuickPickItem(driver, 'Change kernel', 'Select Another Kernel')
  ) {
    await selectQuickPickItem(driver, 'Change kernel', 'Select Another Kernel');
  }
  await selectQuickPicksInOrder(driver, [
    { picker: 'kernel source', item: 'Colab' },
    { picker: 'Select a remote server', item: 'New Colab Server' },
    { picker: 'Select a variant', item: 'CPU' },
    { picker: 'Select a runtime version', item: 'Latest' },
  ]);
  // Alias the server with the default name. We poll until the alias InputBox
  // is actually shown before confirming, otherwise the ENTER keystroke can be
  // delivered to the still-focused QuickPick from the previous step and lost.
  await confirmInputBoxWithDefault(driver, 'Alias your server');
  await selectQuickPickItem(
    driver,
    'Select a Kernel',
    'Python',
    KERNEL_SELECT_WAIT_MS,
  );

  // Input code into the first cell.
  let focusedCell: WebElement;
  await safeExecuteCommand(workbench, 'Notebook: Edit Cell');
  focusedCell = await driver.switchTo().activeElement();
  await focusedCell.sendKeys('1 + 1');

  // Add a second cell to display a data frame.
  await safeExecuteCommand(workbench, 'Notebook: Insert Code Cell Below');
  focusedCell = await driver.switchTo().activeElement();
  await focusedCell.sendKeys(`import pandas as pd
df = pd.DataFrame({
'col1': [i for i in range(5)],
'col2': [f'text_{i}' for i in range(5)]
})
df`);

  // Add a third cell to plot the data frame.
  await safeExecuteCommand(workbench, 'Notebook: Insert Code Cell Below');
  focusedCell = await driver.switchTo().activeElement();
  await focusedCell.sendKeys('df.plot()');

  await safeExecuteCommand(workbench, 'Notebook: Run All');
  // Collapsing all cell outputs so execution status of all 3 cells are in
  // the viewport.
  await safeExecuteCommand(workbench, 'Notebook: Collapse All Cell Outputs');

  await assertAllCellsExecutedSuccessfully(driver, workbench);
});
