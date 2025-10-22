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
    await vs.window.withProgress(
      {
        cancellable: false,
        location: vs.ProgressLocation.Notification,
        title: `Removing server "${selectedServer.label}"...`,
      },
      () => assignmentManager.unassignServer(selectedServer),
    );
    // TODO: Remove once https://github.com/microsoft/vscode-jupyter/issues/17094 is fixed.
    void notifyReloadNotebooks(vs, selectedServer.label);
    return undefined;
  });
}

async function notifyReloadNotebooks(vs: typeof vscode, serverLabel: string) {
  const viewIssue = await vs.window.showInformationMessage(
    `Sorry for the inconvenience, to work around [microsoft/vscode-jupyter #17094](https://github.com/microsoft/vscode-jupyter/issues/17094) - please re-open notebooks ${serverLabel} was previously connected to.`,
    `View Issue`,
  );
  if (viewIssue) {
    vs.env.openExternal(
      vs.Uri.parse("https://github.com/microsoft/vscode-jupyter/issues/17094"),
    );
  }
}
