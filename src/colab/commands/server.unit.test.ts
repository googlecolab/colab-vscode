/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "crypto";
import { expect } from "chai";
import sinon, { SinonStubbedInstance } from "sinon";
import { InputBox, QuickPick, QuickPickItem } from "vscode";
import { AssignmentManager } from "../../jupyter/assignments";
import { ColabAssignedServer } from "../../jupyter/servers";
import { ServerStorage } from "../../jupyter/storage";
import {
  buildQuickPickStub,
  QuickPickStub,
  InputBoxStub,
  buildInputBoxStub,
} from "../../test/helpers/quick-input";
import { newVsCodeStub, VsCodeStub } from "../../test/helpers/vscode";
import { Variant } from "../api";
import { removeServer, renameServerAlias } from "./server";

describe("Server Commands", () => {
  let vsCodeStub: VsCodeStub;
  let defaultServer: ColabAssignedServer;
  let inputBoxStub: InputBoxStub & {
    nextShow: () => Promise<void>;
  };
  let quickPickStub: QuickPickStub & {
    nextShow: () => Promise<void>;
  };

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    quickPickStub = buildQuickPickStub();
    vsCodeStub.window.createQuickPick.returns(
      quickPickStub as Partial<
        QuickPick<QuickPickItem>
      > as QuickPick<QuickPickItem>,
    );
    inputBoxStub = buildInputBoxStub();
    vsCodeStub.window.createInputBox.returns(
      inputBoxStub as Partial<InputBox> as InputBox,
    );
    defaultServer = {
      id: randomUUID(),
      label: "foo",
      variant: Variant.DEFAULT,
      accelerator: undefined,
      endpoint: "m-s-foo",
      connectionInformation: {
        baseUrl: vsCodeStub.Uri.parse("https://example.com"),
        token: "123",
        headers: { foo: "bar" },
      },
      dateAssigned: new Date(),
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("renameServerAlias", () => {
    let serverStorageStub: SinonStubbedInstance<ServerStorage>;

    beforeEach(() => {
      serverStorageStub = sinon.createStubInstance(ServerStorage);
    });

    it("does not open the Quick Pick when no servers are assigned", async () => {
      serverStorageStub.list.resolves([]);

      await renameServerAlias(vsCodeStub.asVsCode(), serverStorageStub);

      sinon.assert.notCalled(vsCodeStub.window.createQuickPick);
    });

    describe("when servers are assigned", () => {
      it("lists assigned servers for selection", async () => {
        const additionalServer = { ...defaultServer, label: "bar" };
        serverStorageStub.list.resolves([defaultServer, additionalServer]);

        void renameServerAlias(vsCodeStub.asVsCode(), serverStorageStub);
        sinon.assert.calledOnce(serverStorageStub.list);

        await quickPickStub.nextShow();
        expect(quickPickStub.items).to.deep.equal([
          { label: defaultServer.label, value: defaultServer },
          { label: additionalServer.label, value: additionalServer },
        ]);
      });

      describe("renaming the selected server", () => {
        it("validates the input alias", async () => {
          serverStorageStub.list.resolves([defaultServer]);
          void renameServerAlias(vsCodeStub.asVsCode(), serverStorageStub);
          await quickPickStub.nextShow();
          quickPickStub.onDidChangeSelection.yield([
            { label: defaultServer.label, value: defaultServer },
          ]);

          await inputBoxStub.nextShow();
          inputBoxStub.value = "s".repeat(11);
          inputBoxStub.onDidChangeValue.yield(inputBoxStub.value);
          expect(inputBoxStub.validationMessage).equal(
            "Name must be less than 10 characters.",
          );

          inputBoxStub.value = "s".repeat(10);
          inputBoxStub.onDidChangeValue.yield(inputBoxStub.value);
          expect(inputBoxStub.validationMessage).equal("");
        });

        it("updates the server alias", async () => {
          serverStorageStub.list.resolves([defaultServer]);
          const rename = renameServerAlias(
            vsCodeStub.asVsCode(),
            serverStorageStub,
          );

          await quickPickStub.nextShow();
          quickPickStub.onDidChangeSelection.yield([
            { label: defaultServer.label, value: defaultServer },
          ]);

          await inputBoxStub.nextShow();
          inputBoxStub.value = "new_alias";
          inputBoxStub.onDidChangeValue.yield(inputBoxStub.value);
          inputBoxStub.onDidAccept.yield();

          await expect(rename).to.eventually.be.fulfilled;
          sinon.assert.calledOnceWithExactly(serverStorageStub.store, [
            { ...defaultServer, label: "new_alias" },
          ]);
        });

        it("does not update the server alias when it is unchanged", async () => {
          serverStorageStub.list.resolves([defaultServer]);
          const rename = renameServerAlias(
            vsCodeStub.asVsCode(),
            serverStorageStub,
          );

          await quickPickStub.nextShow();
          quickPickStub.onDidChangeSelection.yield([
            { label: defaultServer.label, value: defaultServer },
          ]);

          await inputBoxStub.nextShow();
          inputBoxStub.value = defaultServer.label;
          inputBoxStub.onDidChangeValue.yield(inputBoxStub.value);
          inputBoxStub.onDidAccept.yield();

          await expect(rename).to.eventually.be.fulfilled;
          sinon.assert.notCalled(serverStorageStub.store);
        });
      });
    });
  });

  describe("removeServer", () => {
    let assignmentManagerStub: SinonStubbedInstance<AssignmentManager>;

    beforeEach(() => {
      assignmentManagerStub = sinon.createStubInstance(AssignmentManager);
    });

    it("does not open the Quick Pick when no servers are assigned", async () => {
      assignmentManagerStub.getAssignedServers.resolves([]);

      await removeServer(vsCodeStub.asVsCode(), assignmentManagerStub);

      sinon.assert.notCalled(vsCodeStub.window.createQuickPick);
    });

    describe("when servers are assigned", () => {
      it("lists servers for selection", async () => {
        const additionalServer = { ...defaultServer, label: "bar" };
        assignmentManagerStub.getAssignedServers.resolves([
          defaultServer,
          additionalServer,
        ]);

        void removeServer(vsCodeStub.asVsCode(), assignmentManagerStub);
        await quickPickStub.nextShow();

        expect(quickPickStub.items).to.deep.equal([
          { label: defaultServer.label, value: defaultServer },
          { label: additionalServer.label, value: additionalServer },
        ]);
      });

      describe("when a server is removed", () => {
        let remove: Promise<void>;

        beforeEach(async () => {
          assignmentManagerStub.getAssignedServers.resolves([defaultServer]);
          remove = removeServer(vsCodeStub.asVsCode(), assignmentManagerStub);
          await quickPickStub.nextShow();
          quickPickStub.onDidChangeSelection.yield([
            { label: defaultServer.label, value: defaultServer },
          ]);
        });

        it("unassigns the selected server", async () => {
          await expect(remove).to.eventually.be.fulfilled;

          assignmentManagerStub.unassignServer.calledOnceWithExactly(
            defaultServer,
          );
        });

        it("notifies the user while server unassignment is in progress", async () => {
          await expect(remove).to.eventually.be.fulfilled;

          sinon.assert.calledWithMatch(
            vsCodeStub.window.withProgress,
            {
              cancellable: false,
              location: vsCodeStub.ProgressLocation.Notification,
              title: `Removing server "${defaultServer.label}"...`,
            },
            sinon.match.func,
          );
        });

        it("notifies the user to reload notebooks", async () => {
          await expect(remove).to.eventually.be.fulfilled;

          sinon.assert.calledWithMatch(
            vsCodeStub.window.showInformationMessage,
            sinon.match(/re-open notebooks foo was previously connected to/),
            sinon.match.string,
          );
        });

        it("opens the Jupyter Github issue when the notification is clicked", async () => {
          vsCodeStub.window.showInformationMessage.resolves({
            title: "View Issue",
          });

          await expect(remove).to.eventually.be.fulfilled;

          sinon.assert.calledWithMatch(
            vsCodeStub.env.openExternal,
            vsCodeStub.Uri.parse(
              "https://github.com/microsoft/vscode-jupyter/issues/17094",
            ),
          );
        });

        it("does not open the Jupyter Github issue when the notification is dismissed", async () => {
          vsCodeStub.window.showInformationMessage.resolves(undefined);

          await expect(remove).to.eventually.be.fulfilled;

          sinon.assert.notCalled(vsCodeStub.env.openExternal);
        });
      });
    });
  });
});
