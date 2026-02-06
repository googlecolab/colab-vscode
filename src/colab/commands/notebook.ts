/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { QuickPickItem } from 'vscode';
import { InputFlowAction } from '../../common/multi-step-quickpick';
import { AssignmentManager } from '../../jupyter/assignments';
import {
  MOUNT_DRIVE,
  MOUNT_SERVER,
  OPEN_TERMINAL,
  OPEN_COLAB_WEB,
  REMOVE_SERVER,
  UPGRADE_TO_PRO,
} from './constants';
import { openColabSignup, openColabWeb } from './external';
import { commandThemeIcon } from './utils';

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
    title: 'Colab',
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

/**
 * Inserts a new code cell in the active notebook below the last selected cell.
 *
 * @param cellContent - Code content to add in the new cell.
 * @param languageId - Language of the code.
 * @returns `true` if cell is inserted successfully; `false` otherwise.
 */
export async function insertCodeCellBelow(
  vs: typeof vscode,
  cellContent: string,
  languageId: string,
): Promise<boolean> {
  const editor = vs.window.activeNotebookEditor;
  if (!editor) {
    return false;
  }

  const currentCell = editor.selection.start;
  const newCellData = new vs.NotebookCellData(
    vs.NotebookCellKind.Code,
    cellContent,
    languageId,
  );
  const edit = new vs.WorkspaceEdit();
  edit.set(editor.notebook.uri, [
    new vs.NotebookEdit(
      new vs.NotebookRange(currentCell + 1, currentCell + 1),
      [newCellData],
    ),
  ]);
  return await vs.workspace.applyEdit(edit);
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
      iconPath: commandThemeIcon(vs, OPEN_COLAB_WEB),
      invoke: () => {
        openColabWeb(vs);
      },
    },
    {
      label: UPGRADE_TO_PRO.label,
      iconPath: commandThemeIcon(vs, UPGRADE_TO_PRO),
      invoke: () => {
        openColabSignup(vs);
      },
    },
  ];
  if (!(await assignments.hasAssignedServer())) {
    return externalCommands;
  }
  const serverCommands: NotebookCommand[] = [];
  const colabConfigs = vs.workspace.getConfiguration('colab');

  const includeMountServer = colabConfigs.get<boolean>('serverMounting', false);
  if (includeMountServer) {
    serverCommands.push({
      label: MOUNT_SERVER.label,
      iconPath: commandThemeIcon(vs, MOUNT_SERVER),
      description: MOUNT_SERVER.description,
      invoke: () => {
        return vs.commands.executeCommand(
          MOUNT_SERVER.id,
          /* withBackButton= */ true,
        );
      },
    });
  }
  const includeTerminal = colabConfigs.get<boolean>('terminal', false);
  if (includeTerminal) {
    serverCommands.push({
      label: OPEN_TERMINAL.label,
      iconPath: commandThemeIcon(vs, OPEN_TERMINAL),
      description: OPEN_TERMINAL.description,
      invoke: () => {
        return vs.commands.executeCommand(
          OPEN_TERMINAL.id,
          /* withBackButton= */ true,
        );
      },
    });
  }
  serverCommands.push(
    // TODO: Include the rename server alias command once rename is reflected in
    // the recent kernels list. See https://github.com/microsoft/vscode-jupyter/issues/17107.
    {
      label: REMOVE_SERVER.label,
      iconPath: commandThemeIcon(vs, REMOVE_SERVER),
      invoke: () => {
        return vs.commands.executeCommand(
          REMOVE_SERVER.id,
          /* withBackButton= */ true,
        );
      },
    },
  );
  serverCommands.push({
    label: MOUNT_DRIVE.label,
    iconPath: commandThemeIcon(vs, MOUNT_DRIVE),
    description: MOUNT_DRIVE.description,
    invoke: () => {
      return vs.commands.executeCommand(MOUNT_DRIVE.id);
    },
  });

  const separator: NotebookCommand = {
    label: '',
    kind: vs.QuickPickItemKind.Separator,
    invoke: () => {
      // Not selectable.
    },
  };

  return [...serverCommands, separator, ...externalCommands];
}
