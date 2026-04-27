/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { assert } from 'chai';
import {
  ContextMenu,
  CustomTreeSection,
  DefaultTreeSection,
  SideBarView,
  Workbench,
} from 'vscode-extension-tester';
import {
  assertAllCellsExecutedSuccessfully,
  createNotebook,
  hasQuickPickItem,
  KERNEL_SELECT_WAIT_MS,
  selectQuickPickItem,
  selectQuickPickItemIfShown,
  selectQuickPicksInOrder,
} from './ui';

const TREE_ITEM_WAIT_MS = 10000;
const CONTENTS_VIEW_WAIT_MS = 20000;

it('uploads a file from the explorer context menu', async () => {
  const workbench = new Workbench();
  const driver = workbench.getDriver();

  await createNotebook(workbench);
  await workbench.executeCommand('Notebook: Select Notebook Kernel');
  if (await hasQuickPickItem(driver, 'Select Another Kernel')) {
    await selectQuickPickItem(driver, 'Select Another Kernel');
  }
  await selectQuickPicksInOrder(driver, ['Colab', 'Auto Connect']);
  await selectQuickPickItemIfShown(driver, 'Python', KERNEL_SELECT_WAIT_MS);

  await workbench.executeCommand('View: Show Explorer');
  const explorerSection = await driver.wait(
    async () => {
      try {
        const sidebar = new SideBarView();
        const section = await sidebar
          .getContent()
          .getSection('workspace', DefaultTreeSection);
        return section;
      } catch {
        return undefined;
      }
    },
    TREE_ITEM_WAIT_MS,
    'Explorer "workspace" section did not render in time',
  );
  if (!explorerSection) {
    throw new Error('Explorer "workspace" section was not found');
  }
  const fileItem = await driver.wait(
    async () => {
      try {
        return await explorerSection.findItem('hello-world.txt');
      } catch {
        return undefined;
      }
    },
    TREE_ITEM_WAIT_MS,
    'hello-world.txt not found in Explorer',
  );
  assert(fileItem, 'hello-world.txt should be present in the Explorer');

  const contextMenu: ContextMenu = await fileItem.openContextMenu();
  const uploadItem = await contextMenu.getItem('Upload to Colab');
  assert(uploadItem, '"Upload to Colab" should appear in the context menu');
  await uploadItem.select();

  // The Contents tree is rooted on a collapsed server node ("Colab CPU");
  // `findItem` scrolls but does not auto-expand parents, so expand first.
  await workbench.executeCommand('Colab: Focus on Contents View');
  await driver.wait(
    async () => {
      try {
        const sidebar = new SideBarView();
        const contentsSection = await sidebar
          .getContent()
          .getSection('Contents', CustomTreeSection);
        const serverItem = await contentsSection.findItem('Colab CPU');
        if (!serverItem) {
          return false;
        }
        if (!(await serverItem.isExpanded())) {
          await serverItem.expand();
        }
        const child = await serverItem.findChildItem('hello-world.txt');
        return !!child;
      } catch {
        return false;
      }
    },
    CONTENTS_VIEW_WAIT_MS,
    'hello-world.txt did not appear in the Colab Contents view',
  );

  // Verify the uploaded file content via a Python cell that raises on
  // mismatch. If the upload landed the wrong bytes, the cell errors and
  // `assertAllCellsExecutedSuccessfully` fails.
  await workbench.executeCommand('Notebook: Edit Cell');
  const cell = await driver.switchTo().activeElement();
  await cell.sendKeys(
    `expected = 'Hello world!\\n'
actual = open('/content/hello-world.txt').read()
assert actual == expected, f'expected {expected!r}, got {actual!r}'`,
  );

  await workbench.executeCommand('Notebook: Run All');
  await assertAllCellsExecutedSuccessfully(driver, workbench);
});
