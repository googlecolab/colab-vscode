/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon, { SinonStubbedInstance } from 'sinon';
import { QuickPickItem, Uri, WorkspaceConfiguration } from 'vscode';
import { InputFlowAction } from '../../common/multi-step-quickpick';
import { AssignmentManager } from '../../jupyter/assignments';
import { newVsCodeStub, VsCodeStub } from '../../test/helpers/vscode';
import { TestWorkspaceEdit } from '../../test/helpers/workspace';
import {
  OPEN_COLAB_WEB,
  UPGRADE_TO_PRO,
  REMOVE_SERVER,
  MOUNT_SERVER,
  MOUNT_DRIVE,
} from './constants';
import { notebookToolbar, insertCodeCellBelow } from './notebook';

describe('Notebook', () => {
  let vs: VsCodeStub;

  beforeEach(() => {
    vs = newVsCodeStub();
  });

  describe('notebookToolbar', () => {
    let assignmentManager: SinonStubbedInstance<AssignmentManager>;
    let serverMountingEnabled: boolean;
    let driveMountingEnabled: boolean;

    beforeEach(() => {
      serverMountingEnabled = false;
      driveMountingEnabled = false;
      assignmentManager = sinon.createStubInstance(AssignmentManager);
      vs.workspace.getConfiguration.withArgs('colab').returns({
        get: sinon.stub<[string], boolean>().callsFake((name: string) => {
          switch (name) {
            case 'serverMounting':
              return serverMountingEnabled;
            case 'driveMounting':
              return driveMountingEnabled;
            default:
              return false;
          }
        }),
      } as Pick<WorkspaceConfiguration, 'get'> as WorkspaceConfiguration);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('does nothing when no command is selected', async () => {
      vs.window.showQuickPick.resolves(undefined);

      await expect(notebookToolbar(vs.asVsCode(), assignmentManager)).to
        .eventually.be.fulfilled;
    });

    it('re-invokes the notebook toolbar when a command flows back', async () => {
      assignmentManager.hasAssignedServer.resolves(true);
      vs.commands.executeCommand
        .withArgs(REMOVE_SERVER.id)
        .onFirstCall()
        .rejects(InputFlowAction.back);
      vs.window.showQuickPick
        .onFirstCall()
        .callsFake(findCommand(REMOVE_SERVER.label))
        .onSecondCall()
        .callsFake(findCommand(REMOVE_SERVER.label));

      await expect(notebookToolbar(vs.asVsCode(), assignmentManager)).to
        .eventually.be.fulfilled;

      sinon.assert.calledTwice(vs.window.showQuickPick);
    });

    it('excludes server specific commands when there are non assigned', async () => {
      vs.window.showQuickPick
        .onFirstCall()
        // Arbitrarily select the first command.
        .callsFake(findCommand(OPEN_COLAB_WEB.label));

      await expect(notebookToolbar(vs.asVsCode(), assignmentManager)).to
        .eventually.be.fulfilled;

      sinon.assert.calledOnceWithMatch(
        vs.window.showQuickPick,
        commandsLabeled([OPEN_COLAB_WEB.label, UPGRADE_TO_PRO.label]),
      );
    });

    it('includes all commands when there is a server assigned', async () => {
      assignmentManager.hasAssignedServer.resolves(true);
      vs.window.showQuickPick
        .onFirstCall()
        // Arbitrarily select the first command.
        .callsFake(findCommand(OPEN_COLAB_WEB.label));

      await expect(notebookToolbar(vs.asVsCode(), assignmentManager)).to
        .eventually.be.fulfilled;

      sinon.assert.calledOnceWithMatch(
        vs.window.showQuickPick,
        commandsLabeled([
          REMOVE_SERVER.label,
          /* separator */ '',
          OPEN_COLAB_WEB.label,
          UPGRADE_TO_PRO.label,
        ]),
      );
    });

    it('includes server mounting when there is a server assigned and the setting is enabled', async () => {
      assignmentManager.hasAssignedServer.resolves(true);
      serverMountingEnabled = true;
      vs.window.showQuickPick
        .onFirstCall()
        // Arbitrarily select the first command.
        .callsFake(findCommand(OPEN_COLAB_WEB.label));

      await expect(notebookToolbar(vs.asVsCode(), assignmentManager)).to
        .eventually.be.fulfilled;

      sinon.assert.calledOnceWithMatch(
        vs.window.showQuickPick,
        commandsLabeled([
          MOUNT_SERVER.label,
          REMOVE_SERVER.label,
          /* separator */ '',
          OPEN_COLAB_WEB.label,
          UPGRADE_TO_PRO.label,
        ]),
      );
    });

    it('includes drive mounting when there is a server assigned and the setting is enabled', async () => {
      assignmentManager.hasAssignedServer.resolves(true);
      driveMountingEnabled = true;
      vs.window.showQuickPick
        .onFirstCall()
        // Arbitrarily select the first command.
        .callsFake(findCommand(OPEN_COLAB_WEB.label));

      await expect(notebookToolbar(vs.asVsCode(), assignmentManager)).to
        .eventually.be.fulfilled;

      sinon.assert.calledOnceWithMatch(
        vs.window.showQuickPick,
        commandsLabeled([
          MOUNT_DRIVE.label,
          REMOVE_SERVER.label,
          /* separator */ '',
          OPEN_COLAB_WEB.label,
          UPGRADE_TO_PRO.label,
        ]),
      );
    });

    it('opens Colab in web', async () => {
      vs.window.showQuickPick.callsFake(findCommand(OPEN_COLAB_WEB.label));

      await expect(notebookToolbar(vs.asVsCode(), assignmentManager)).to
        .eventually.be.fulfilled;

      sinon.assert.calledOnceWithMatch(
        vs.env.openExternal,
        sinon.match(
          (u: Uri) =>
            u.authority === 'colab.research.google.com' && u.path === '/',
        ),
      );
    });

    it('opens the Colab signup page', async () => {
      vs.window.showQuickPick.callsFake(findCommand(UPGRADE_TO_PRO.label));

      await expect(notebookToolbar(vs.asVsCode(), assignmentManager)).to
        .eventually.be.fulfilled;

      sinon.assert.calledOnceWithMatch(
        vs.env.openExternal,
        sinon.match(
          (u: Uri) =>
            u.authority === 'colab.research.google.com' && u.path === '/signup',
        ),
      );
    });

    it('mounts Drive', async () => {
      assignmentManager.hasAssignedServer.resolves(true);
      driveMountingEnabled = true;
      vs.window.showQuickPick.callsFake(findCommand(MOUNT_DRIVE.label));

      await expect(notebookToolbar(vs.asVsCode(), assignmentManager)).to
        .eventually.be.fulfilled;

      sinon.assert.calledOnceWithMatch(
        vs.commands.executeCommand,
        MOUNT_DRIVE.id,
      );
    });

    it('mounts a server', async () => {
      assignmentManager.hasAssignedServer.resolves(true);
      serverMountingEnabled = true;
      vs.window.showQuickPick.callsFake(findCommand(MOUNT_SERVER.label));

      await expect(notebookToolbar(vs.asVsCode(), assignmentManager)).to
        .eventually.be.fulfilled;

      sinon.assert.calledOnceWithMatch(
        vs.commands.executeCommand,
        MOUNT_SERVER.id,
      );
    });

    it('removes a server', async () => {
      assignmentManager.hasAssignedServer.resolves(true);
      vs.window.showQuickPick.callsFake(findCommand(REMOVE_SERVER.label));

      await expect(notebookToolbar(vs.asVsCode(), assignmentManager)).to
        .eventually.be.fulfilled;

      sinon.assert.calledOnceWithMatch(
        vs.commands.executeCommand,
        REMOVE_SERVER.id,
      );
    });
  });

  describe('insertCodeCellBelow', () => {
    it('returns false if no active notebook editor', async () => {
      const result = await insertCodeCellBelow(vs.asVsCode(), '', '');

      expect(result).to.be.false;
      sinon.assert.notCalled(vs.workspace.applyEdit);
    });

    describe('with an active notebook editor', () => {
      const testNotebookUri = 'test-notebook-uri';
      const selectedCellIndex = 2;

      beforeEach(() => {
        vs.window.activeNotebookEditor = {
          notebook: {
            uri: vs.Uri.from({
              scheme: '',
              path: testNotebookUri,
            }),
          },
          selection: sinon.createStubInstance(vs.NotebookRange),
        };
        vs.window.activeNotebookEditor.selection.start = selectedCellIndex;
      });

      const tests = [
        { name: 'succeeds', success: true },
        { name: 'fails', success: false },
      ];
      tests.forEach(({ name, success }) => {
        it(`inserts code in language below selection and returns ${String(success)} if applyEdit ${name}`, async () => {
          vs.workspace.applyEdit.resolves(success);
          const code = 'print("Hello World")';
          const language = 'python';

          const result = await insertCodeCellBelow(
            vs.asVsCode(),
            code,
            language,
          );

          expect(result).to.equals(success);
          sinon.assert.calledOnceWithMatch(
            vs.workspace.applyEdit,
            sinon.match((edit: TestWorkspaceEdit) => {
              const notebookEdit = edit.edits[0];
              const newCellData = notebookEdit.newCells[0];
              return (
                edit.uri.path === testNotebookUri &&
                notebookEdit.range.start === selectedCellIndex + 1 &&
                newCellData.value === code &&
                newCellData.languageId === language
              );
            }),
          );
        });
      });
    });
  });
});

function findCommand(label: string) {
  return async (
    commands: readonly QuickPickItem[] | Thenable<readonly QuickPickItem[]>,
  ) => {
    return Promise.resolve(
      (await commands).find((command) => command.label === label),
    );
  };
}

function commandsLabeled(labels: string[]) {
  return sinon.match(labels.map((label) => sinon.match.has('label', label)));
}
