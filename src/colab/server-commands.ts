import vscode from "vscode";
import { MultiStepInput } from "../common/multi-step-quickpick";
import { AssignmentManager } from "../jupyter/assignments";
import { ServerStorage } from "../jupyter/storage";
import { PROMPT_SERVER_ALIAS, validateServerAlias } from "./server-picker";

/**
 * Prompt the user to select and rename the local alias used to identify an
 * assigned Colab server.
 */
// TODO: Consider adding a notification that the rename was successful.
// TODO: Add constraint for when there are no servers assigned.
export async function renameServerAlias(
  vs: typeof vscode,
  serverStorage: ServerStorage,
): Promise<void> {
  const servers = await serverStorage.list();
  const totalSteps = 2;

  await MultiStepInput.run(vs, async (input) => {
    const selectedServer = (
      await input.showQuickPick({
        items: servers.map((s) => ({ label: s.label, value: s })),
        step: 1,
        title: "Select a Server",
        totalSteps,
      })
    ).value;

    return async () => {
      const alias = await input.showInputBox({
        buttons: [vs.QuickInputButtons.Back],
        placeholder: selectedServer.label,
        prompt: PROMPT_SERVER_ALIAS,
        step: 2,
        title: "Update your Server Alias",
        totalSteps,
        validate: validateServerAlias,
        value: selectedServer.label,
      });
      if (!alias || alias === selectedServer.label) return undefined;

      void serverStorage.store([{ ...selectedServer, label: alias }]);
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
// TODO: Add constraint for when there are no servers assigned.
export async function removeServer(
  vs: typeof vscode,
  assignmentManager: AssignmentManager,
) {
  const servers = await assignmentManager.getAssignedServers();
  await MultiStepInput.run(vs, async (input) => {
    const selectedServer = (
      await input.showQuickPick({
        items: servers.map((s) => ({ label: s.label, value: s })),
        step: 1,
        title: "Select a Server to Remove",
        totalSteps: 1,
      })
    ).value;
    await assignmentManager.unassignServer(selectedServer);
    return undefined;
  });
}
