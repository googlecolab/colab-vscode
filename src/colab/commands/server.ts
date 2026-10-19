/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { QuickPickItem } from 'vscode';
import { log } from '../../common/logging';
import { MultiStepInput } from '../../common/multi-step-quickpick';
import { AssignmentManager } from '../../jupyter/assignments';
import { ContentsFileSystemProvider } from '../../jupyter/contents/file-system';
import { ColabAssignedServer, UnownedServer } from '../../jupyter/servers';
import { ServerStorage } from '../../jupyter/storage';
import { telemetry } from '../../telemetry';
import { CommandSource } from '../../telemetry/api';
import { PROMPT_SERVER_ALIAS, validateServerAlias } from '../server-picker';
import { MOUNT_SERVER, REMOVE_SERVER, RENAME_SERVER_ALIAS } from './constants';

/**
 * Prompt the user to select and rename the local alias used to identify an
 * assigned Colab server.
 *
 * @param vs - The VS Code API instance.
 * @param serverStorage - The server storage instance.
 * @param withBackButton - Whether to show a back button in the UI.
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
        title: 'Select a Server',
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
 * Mount's a Colab server as a workspace folder.
 *
 * - With no servers: no-ops.
 * - With one server: mounts it directly.
 * - With multiple servers: prompts the user to select one.
 *
 * @param vs - The VS Code API instance.
 * @param assignmentManager - The assignment manager instance.
 * @param fs - The file system provider.
 * @param source - The source of the command invocation.
 * @param withBackButton - Whether to show a back button in the UI.
 */
// TODO: Consider making this multi-select.
export async function mountServer(
  vs: typeof vscode,
  assignmentManager: AssignmentManager,
  fs: ContentsFileSystemProvider,
  source: CommandSource,
  withBackButton?: boolean,
) {
  let selectedServer: ColabAssignedServer | undefined;
  try {
    const allServers = await assignmentManager.getServers('extension');
    if (!allServers.length) {
      return;
    }
    if (allServers.length === 1) {
      selectedServer = allServers[0];
      fs.mount(selectedServer);
      return;
    }

    await MultiStepInput.run(vs, async (input) => {
      const items: MountServerItem[] = allServers.map((s) => ({
        label: s.label,
        description: ServerCategory.VS_CODE,
        value: s,
      }));
      selectedServer = (
        await input.showQuickPick({
          title: MOUNT_SERVER.label,
          buttons: withBackButton ? [vs.QuickInputButtons.Back] : undefined,
          items,
        })
      ).value;
      if (!selectedServer) {
        return;
      }
      fs.mount(selectedServer);

      return undefined;
    });
  } finally {
    telemetry.logMountServer(source, selectedServer?.id);
  }
}

/**
 * Prompts the user to select one or more assigned Colab servers to remove.
 *
 * @param vs - The VS Code API instance.
 * @param assignmentManager - The assignment manager instance.
 * @param withBackButton - Whether to show a back button in the UI.
 * @param source - The source of the command invocation.
 */
// TODO: Update MultiStepInput to handle a single-step case.
export async function removeServer(
  vs: typeof vscode,
  assignmentManager: AssignmentManager,
  withBackButton?: boolean,
  source?: CommandSource,
) {
  telemetry.logRemoveServer(
    source ?? CommandSource.COMMAND_SOURCE_COMMAND_PALETTE,
  );
  const allServers = await assignmentManager.getServers('all');
  log.trace(`removeServer: getServers('all') resolved:`, allServers);
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
      items.push({ label: '', kind: vs.QuickPickItemKind.Separator });
    }
    items.push(
      ...nonVsCodeServers.map((s) => ({
        label: s.label,
        description: ServerCategory.COLAB_WEB,
        value: s,
      })),
    );
    const selectedServers = (
      await input.showQuickPickMany({
        title: REMOVE_SERVER.label,
        buttons: withBackButton ? [vs.QuickInputButtons.Back] : undefined,
        items,
      })
    )
      .map((item) => item.value)
      .filter((s): s is ColabAssignedServer | UnownedServer => !!s);
    if (selectedServers.length === 0) {
      return;
    }

    const failed: (ColabAssignedServer | UnownedServer)[] = [];
    await vs.window.withProgress(
      {
        cancellable: false,
        location: vs.ProgressLocation.Notification,
        title:
          selectedServers.length === 1
            ? `Removing server "${selectedServers[0].label}"...`
            : `Removing ${selectedServers.length.toString()} servers...`,
      },
      async () => {
        // Remove one at a time: `ServerStorage.remove` does a read-modify-write
        // of the stored servers, so concurrent removals can overwrite each
        // other and leave a removed server in storage.
        for (const server of selectedServers) {
          try {
            await assignmentManager.unassignServer(server);
          } catch (err) {
            // Catching lets the remaining removals proceed, but also hides the
            // error from the command's error tracking, so report it here.
            log.error(`Failed to remove server "${server.label}"`, err);
            telemetry.logError(err);
            failed.push(server);
          }
        }
      },
    );
    if (failed.length > 0) {
      const labels = failed.map((s) => `"${s.label}"`).join(', ');
      const countPart = failed.length > 1 ? 'servers' : 'server';
      void vs.window.showErrorMessage(
        `Failed to remove ${countPart} ${labels}. Check logs for details.`,
      );
    }
    return undefined;
  });
}

enum ServerCategory {
  VS_CODE = 'VS Code Server',
  COLAB_WEB = 'Colab Web Server',
}

interface MountServerItem extends QuickPickItem {
  value?: ColabAssignedServer;
}

interface RemoveServerItem extends QuickPickItem {
  value?: ColabAssignedServer | UnownedServer;
}
