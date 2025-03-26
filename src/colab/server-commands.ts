import vscode from "vscode";
import { MultiStepInput } from "../common/multi-step-quickpick";
import { ServerStorage } from "../jupyter/storage";
import { PROMPT_SERVER_ALIAS, validateServerAlias } from "./server-picker";

/**
 * Prompt the user to select and rename the local alias used to identify an
 * assigned Colab server.
 */
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
