/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from "chai";
import sinon, { SinonStubbedInstance } from "sinon";
import { QuickPickItem, Uri } from "vscode";
import { InputFlowAction } from "../../common/multi-step-quickpick";
import { AssignmentManager } from "../../jupyter/assignments";
import { newVsCodeStub, VsCodeStub } from "../../test/helpers/vscode";
import { OPEN_COLAB_WEB, UPGRADE_TO_PRO } from "./constants";
import { REMOVE_SERVER } from "./constants";
import { notebookToolbar } from "./notebook";

describe("notebookToolbar", () => {
  let vsCodeStub: VsCodeStub;
  let assignmentManager: SinonStubbedInstance<AssignmentManager>;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    assignmentManager = sinon.createStubInstance(AssignmentManager);
  });

  afterEach(() => {
    sinon.restore();
  });

  it("does nothing when no command is selected", async () => {
    vsCodeStub.window.showQuickPick.resolves(undefined);

    await expect(notebookToolbar(vsCodeStub.asVsCode(), assignmentManager)).to
      .eventually.be.fulfilled;
  });

  it("re-invokes the notebook toolbar when a command flows back", async () => {
    assignmentManager.hasAssignedServer.resolves(true);
    vsCodeStub.commands.executeCommand
      .withArgs("colab.removeServer")
      .onFirstCall()
      .rejects(InputFlowAction.back);
    vsCodeStub.window.showQuickPick
      .onFirstCall()
      .callsFake(findCommand(REMOVE_SERVER.label))
      .onSecondCall()
      .callsFake(findCommand(REMOVE_SERVER.label));

    await expect(notebookToolbar(vsCodeStub.asVsCode(), assignmentManager)).to
      .eventually.be.fulfilled;

    sinon.assert.calledTwice(vsCodeStub.window.showQuickPick);
  });

  it("excludes server specific commands when there are non assigned", async () => {
    vsCodeStub.window.showQuickPick
      .onFirstCall()
      // Arbitrarily select the first command.
      .callsFake(findCommand(OPEN_COLAB_WEB.label));

    await expect(notebookToolbar(vsCodeStub.asVsCode(), assignmentManager)).to
      .eventually.be.fulfilled;

    sinon.assert.calledOnceWithMatch(
      vsCodeStub.window.showQuickPick,
      commandsLabeled([OPEN_COLAB_WEB.label, UPGRADE_TO_PRO.label]),
    );
  });

  it("includes all commands when there is a server assigned", async () => {
    assignmentManager.hasAssignedServer.resolves(true);
    vsCodeStub.window.showQuickPick
      .onFirstCall()
      // Arbitrarily select the first command.
      .callsFake(findCommand(OPEN_COLAB_WEB.label));

    await expect(notebookToolbar(vsCodeStub.asVsCode(), assignmentManager)).to
      .eventually.be.fulfilled;

    sinon.assert.calledOnceWithMatch(
      vsCodeStub.window.showQuickPick,
      commandsLabeled([
        REMOVE_SERVER.label,
        /* separator */ "",
        OPEN_COLAB_WEB.label,
        UPGRADE_TO_PRO.label,
      ]),
    );
  });

  it("opens Colab in web", async () => {
    vsCodeStub.window.showQuickPick.callsFake(
      findCommand(OPEN_COLAB_WEB.label),
    );

    await expect(notebookToolbar(vsCodeStub.asVsCode(), assignmentManager)).to
      .eventually.be.fulfilled;

    sinon.assert.calledOnceWithMatch(
      vsCodeStub.env.openExternal,
      sinon.match(
        (u: Uri) =>
          u.authority === "colab.research.google.com" && u.path === "/",
      ),
    );
  });

  it("opens the Colab signup page", async () => {
    vsCodeStub.window.showQuickPick.callsFake(
      findCommand(UPGRADE_TO_PRO.label),
    );

    await expect(notebookToolbar(vsCodeStub.asVsCode(), assignmentManager)).to
      .eventually.be.fulfilled;

    sinon.assert.calledOnceWithMatch(
      vsCodeStub.env.openExternal,
      sinon.match(
        (u: Uri) =>
          u.authority === "colab.research.google.com" && u.path === "/signup",
      ),
    );
  });

  it("removes a server", async () => {
    assignmentManager.hasAssignedServer.resolves(true);
    vsCodeStub.window.showQuickPick.callsFake(findCommand(REMOVE_SERVER.label));

    await expect(notebookToolbar(vsCodeStub.asVsCode(), assignmentManager)).to
      .eventually.be.fulfilled;

    sinon.assert.calledOnceWithMatch(
      vsCodeStub.commands.executeCommand,
      "colab.removeServer",
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
  return sinon.match(labels.map((label) => sinon.match.has("label", label)));
}
