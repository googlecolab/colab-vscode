/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { assert } from 'chai';
import { Workbench } from 'vscode-extension-tester';
import {
  createNotebook,
  hasQuickPickItem,
  KERNEL_SELECT_WAIT_MS,
  selectQuickPickItem,
  selectQuickPickItemIfShown,
  selectQuickPicksInOrder,
} from './ui';

// The "Resources" tree-view refresh is asynchronous and can lag behind the
// notebook-side server assignment by several seconds, especially on a fresh
// Colab server where the resource provider has to make its first round-trip
// to enumerate disk/CPU/etc.
const RESOURCE_VIEW_WAIT_MS = 30000;

it('renders resource tree view', async () => {
  const workbench = new Workbench();
  const driver = workbench.getDriver();

  await createNotebook(workbench);

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

  // Verify resource view in Colab activity bar.
  await workbench.executeCommand('Colab: Focus on Resources View');

  const activityBar = workbench.getActivityBar();
  const colabViewContainer = await activityBar.getViewControl('Colab');
  assert(colabViewContainer, 'Colab view container not found in activity bar');

  await driver.wait(
    async () => {
      try {
        const colabView = await colabViewContainer.openView();
        const resourceView = await colabView
          .getContent()
          .getSection('Resources');
        const resourceItems = await resourceView.getVisibleItems();
        // We expect the resource tree view to be expanded by default and
        // contain at least 3 items: the server and 2 child resource items.
        return (await resourceView.isExpanded()) && resourceItems.length > 2;
      } catch {
        return false;
      }
    },
    RESOURCE_VIEW_WAIT_MS,
    'Resource view is not rendered with expected content',
  );
});
