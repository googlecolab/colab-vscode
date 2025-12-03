/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { QuickPickItem } from "vscode";
import { MultiStepInput } from "../../common/multi-step-quickpick";
import { AssignmentManager } from "../../jupyter/assignments";
import { ColabAssignedServer, UnownedServer } from "../../jupyter/servers";
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
  const allServers = await assignmentManager.getAllServers();
  const vsCodeServers = allServers.assigned;
  const nonVsCodeServers = allServers.unowned;
  if (vsCodeServers.length === 0 && nonVsCodeServers.length === 0) {
    return;
  }

  await MultiStepInput.run(vs, async (input) => {
    const items: RemoveServerItem[] = vsCodeServers.map((s) => ({
      label: s.label,
      description: ServerCategory.VS_CODE,
      value: s,
    }));
    if (vsCodeServers.length > 0 && nonVsCodeServers.length > 0) {
      items.push({ label: "", kind: -1 });
    }
    items.push(
      ...nonVsCodeServers.map((s) => ({
        label: s.label,
        description: ServerCategory.COLAB_WEB,
        value: s,
      })),
    );
    const selectedServer = (
      await input.showQuickPick({
        title: REMOVE_SERVER.label,
        buttons: withBackButton ? [vs.QuickInputButtons.Back] : undefined,
        items,
      })
    ).value;
    if (!selectedServer) {
      return;
    }

    await vs.window.withProgress(
      {
        cancellable: false,
        location: vs.ProgressLocation.Notification,
        title: `Removing server "${selectedServer.label}"...`,
      },
      () => assignmentManager.unassignServer(selectedServer),
    );
    return undefined;
  });
}

enum ServerCategory {
  VS_CODE = "VS Code Server",
  COLAB_WEB = "Colab Web Server",
}

interface RemoveServerItem extends QuickPickItem {
  value?: ColabAssignedServer | UnownedServer;
}
