/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { QuickPickItem } from 'vscode';
import { MultiStepInput } from '../../common/multi-step-quickpick';
import { AssignmentManager } from '../../jupyter/assignments';
import { ColabAssignedServer } from '../../jupyter/servers';
import { ColabPseudoterminal } from '../terminal/colab-pseudoterminal';
import { ColabTerminalWebSocket } from '../terminal/colab-terminal-websocket';
import { OPEN_TERMINAL } from './constants';

/**
 * Opens a Colab terminal connected to an assigned server.
 *
 * - With no servers: Shows an info message.
 * - With one server: Opens terminal directly.
 * - With multiple servers: Prompts the user to select one.
 */
export async function openTerminal(
  vs: typeof vscode,
  assignmentManager: AssignmentManager,
  withBackButton?: boolean,
) {
  const allServers = await assignmentManager.getServers('extension');

  if (allServers.length === 0) {
    void vs.window.showInformationMessage(
      'No Colab servers are currently assigned.',
    );
    return;
  }

  if (allServers.length === 1) {
    createColabTerminal(vs, allServers[0]);
    return;
  }

  await MultiStepInput.run(vs, async (input) => {
    const items: TerminalServerItem[] = allServers.map((s) => ({
      label: s.label,
      value: s,
    }));

    const selectedServer = (
      await input.showQuickPick({
        title: OPEN_TERMINAL.label,
        buttons: withBackButton ? [vs.QuickInputButtons.Back] : undefined,
        items,
      })
    ).value;

    if (!selectedServer) {
      return;
    }

    createColabTerminal(vs, selectedServer);
    return undefined;
  });
}

/**
 * Creates and shows a Colab terminal for the specified server.
 */
function createColabTerminal(vs: typeof vscode, server: ColabAssignedServer) {
  // Create the WebSocket connection
  const terminalWebSocket = new ColabTerminalWebSocket(vs, server);

  // Create the Pseudoterminal bridge
  const pty = new ColabPseudoterminal(vs, terminalWebSocket);

  // Create the VS Code terminal
  const terminal = vs.window.createTerminal({
    name: `Colab Terminal: ${server.label}`,
    pty,
  });

  // Show the terminal
  terminal.show();
}

interface TerminalServerItem extends QuickPickItem {
  value?: ColabAssignedServer;
}
