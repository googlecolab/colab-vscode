import vscode from "vscode";
import { MultiStepInput } from "../common/multi-step-quickpick";
import { ColabAssignedServer } from "../jupyter/servers";
import { ServerStorage } from "../jupyter/storage";

/** Prompt the user to select and rename the local alias used to identify an assigned Colab server. */
export async function renameServerAlias(
  vs: typeof vscode,
  serverStorage: ServerStorage,
): Promise<void> {
  const servers: ColabAssignedServer[] = await serverStorage.list();
  const totalSteps = 2;

  await MultiStepInput.run(vs, async (input) => {
    const selectedServer = (
      await input.showQuickPick({
        // Since there are no previous QuickInputs, don't show the back button.
        buttons: [],
        items: servers.map((s) => ({ label: s.label, value: s })),
        step: 1,
        title: "Select a Server",
        totalSteps,
      })
    ).value;

    return async () => {
      const alias = await input.showInputBox({
        placeholder: selectedServer.label,
        prompt: "Provide a local convenience alias to the server.",
        step: 2,
        title: "Update your Server Alias",
        totalSteps,
        validate: (value) =>
          value.length > 10 ? "Name must be less than 10 characters." : "",
        value: selectedServer.label,
      });
      if (!alias) return undefined;

      void serverStorage.store([{ ...selectedServer, label: alias }]);
    };
  });
}
