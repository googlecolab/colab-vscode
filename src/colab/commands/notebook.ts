/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { QuickPickItem } from "vscode";
import { InputFlowAction } from "../../common/multi-step-quickpick";
import { AssignmentManager } from "../../jupyter/assignments";
import { OPEN_COLAB_WEB, REMOVE_SERVER, UPGRADE_TO_PRO } from "./constants";
import { openColabSignup, openColabWeb } from "./external";

/**
 * Prompt the user to select a Colab command to run.
 *
 * The server-specific commands are only shown if there is at least one
 * assigned Colab server.
 */
export async function notebookToolbar(
  vs: typeof vscode,
  assignments: AssignmentManager,
): Promise<void> {
  const commands = await getAvailableCommands(vs, assignments);
  const command = await vs.window.showQuickPick<NotebookCommand>(commands, {
    title: "Colab",
  });
  if (!command) {
    return;
  }

  try {
    await command.invoke();
  } catch (err: unknown) {
    // The back button was pressed, pop this notebook toolbar quick pick again.
    if (err === InputFlowAction.back) {
      await notebookToolbar(vs, assignments);
      return;
    }
    throw err;
  }
}

interface NotebookCommand extends QuickPickItem {
  invoke: () => Thenable<void> | void;
}

async function getAvailableCommands(
  vs: typeof vscode,
  assignments: AssignmentManager,
): Promise<NotebookCommand[]> {
  const externalCommands: NotebookCommand[] = [
    {
      label: OPEN_COLAB_WEB.label,
      invoke: () => {
        openColabWeb(vs);
      },
    },
    {
      label: UPGRADE_TO_PRO.label,
      invoke: () => {
        openColabSignup(vs);
      },
    },
  ];
  if (!(await assignments.hasAssignedServer())) {
    return externalCommands;
  }
  const serverCommands: NotebookCommand[] = [
    // TODO: Include the rename server alias command once rename is reflected in
    // the recent kernels list. See https://github.com/microsoft/vscode-jupyter/issues/17107.
    {
      label: REMOVE_SERVER.label,
      invoke: () => {
        return vs.commands.executeCommand(
          REMOVE_SERVER.id,
          /* withBackButton= */ true,
        );
      },
    },
  ];
  const separator: NotebookCommand = {
    label: "",
    kind: vs.QuickPickItemKind.Separator,
    invoke: () => {
      // Not selectable.
    },
  };

  return [...serverCommands, separator, ...externalCommands];
}
