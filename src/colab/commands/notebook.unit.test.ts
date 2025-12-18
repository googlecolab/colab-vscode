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
import {
  OPEN_COLAB_WEB,
  UPGRADE_TO_PRO,
  REMOVE_SERVER,
  MOUNT_SERVER,
} from './constants';
import { notebookToolbar } from './notebook';

describe('notebookToolbar', () => {
  let vs: VsCodeStub;
  let assignmentManager: SinonStubbedInstance<AssignmentManager>;
  let serverMountingEnabled = false;

  beforeEach(() => {
    vs = newVsCodeStub();
    assignmentManager = sinon.createStubInstance(AssignmentManager);
    vs.workspace.getConfiguration.withArgs('colab').returns({
      get: sinon
        .stub<[string], boolean>()
        .withArgs('serverMounting')
        .callsFake(() => serverMountingEnabled),
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
