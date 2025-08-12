/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from "vscode";
import { MultiStepInput } from "../../common/multi-step-quickpick";
import { AssignmentManager } from "../../jupyter/assignments";
import { ServerStorage } from "../../jupyter/storage";
import { PROMPT_SERVER_ALIAS, validateServerAlias } from "../server-picker";
import { REMOVE_SERVER, RENAME_SERVER_ALIAS } from "./constants";

/**
 * Prompt the user to select and rename the local alias used to identify an
 * assigned Colab server.
 */
// TODO: Consider adding a notification that the rename was successful.
export async function renameServerAlias(
  vs: typeof vscode,
  serverStorage: ServerStorage,
  withBackButton?: boolean,
): Promise<void> {
  const servers = await serverStorage.list();
  if (servers.length === 0) {
    return;
  }

  const totalSteps = 2;

  await MultiStepInput.run(vs, async (input) => {
    const selectedServer = (
      await input.showQuickPick({
        title: "Select a Server",
        buttons: withBackButton ? [vs.QuickInputButtons.Back] : undefined,
        items: servers.map((s) => ({ label: s.label, value: s })),
        step: 1,
        totalSteps,
      })
    ).value;

    return async () => {
      const alias = await input.showInputBox({
        title: RENAME_SERVER_ALIAS.label,
        buttons: [vs.QuickInputButtons.Back],
        placeholder: selectedServer.label,
        prompt: PROMPT_SERVER_ALIAS,
        step: 2,
        totalSteps,
        validate: validateServerAlias,
        value: selectedServer.label,
      });
      if (!alias || alias === selectedServer.label) return undefined;

      await serverStorage.store([{ ...selectedServer, label: alias }]);
    };
  });
}

/**
 * Prompts the user to select an assigned Colab server to remove.
 */
// TODO: Consider making this multi-select.
// TODO: Handle bug where, if the server of the connected kernel is
// removed, a fallback kernel is selected but does not connect.
// TODO: Consider adding a notification that the server was removed.
// TODO: Update MultiStepInput to handle a single-step case.
export async function removeServer(
  vs: typeof vscode,
  assignmentManager: AssignmentManager,
  withBackButton?: boolean,
) {
  const servers = await assignmentManager.getAssignedServers();
  if (servers.length === 0) {
    return;
  }

  await MultiStepInput.run(vs, async (input) => {
    const selectedServer = (
      await input.showQuickPick({
        title: REMOVE_SERVER.label,
        buttons: withBackButton ? [vs.QuickInputButtons.Back] : undefined,
        items: servers.map((s) => ({ label: s.label, value: s })),
      })
    ).value;
    await assignmentManager.unassignServer(selectedServer);
    return undefined;
  });
}
