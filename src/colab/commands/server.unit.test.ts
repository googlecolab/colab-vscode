/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'crypto';
import { expect } from 'chai';
import sinon, { SinonStubbedInstance, SinonStubbedFunction } from 'sinon';
import { InputBox, QuickPick, QuickPickItem } from 'vscode';
import { AssignmentManager } from '../../jupyter/assignments';
import { ContentsFileSystemProvider } from '../../jupyter/contents/file-system';
import { ColabAssignedServer, UnownedServer } from '../../jupyter/servers';
import { ServerStorage } from '../../jupyter/storage';
import { telemetry } from '../../telemetry';
import { CommandSource } from '../../telemetry/api';
import { TestCancellationTokenSource } from '../../test/helpers/cancellation';
import {
  buildQuickPickStub,
  QuickPickStub,
  InputBoxStub,
  buildInputBoxStub,
} from '../../test/helpers/quick-input';
import { newVsCodeStub, VsCodeStub } from '../../test/helpers/vscode';
import { Variant } from '../types';
import { mountServer, removeServer, renameServerAlias } from './server';

describe('Server Commands', () => {
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
      label: 'foo',
      variant: Variant.DEFAULT,
      accelerator: undefined,
      endpoint: 'm-s-foo',
      connectionInformation: {
        baseUrl: vsCodeStub.Uri.parse('https://example.com'),
        token: '123',
        tokenExpiry: new Date(Date.now() + 1000 * 60 * 60),
        headers: { foo: 'bar' },
      },
      dateAssigned: new Date(),
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('renameServerAlias', () => {
    let serverStorageStub: SinonStubbedInstance<ServerStorage>;

    beforeEach(() => {
      serverStorageStub = sinon.createStubInstance(ServerStorage);
    });

    it('does not open the Quick Pick when no servers are assigned', async () => {
      serverStorageStub.list.resolves([]);

      await renameServerAlias(vsCodeStub.asVsCode(), serverStorageStub);

      sinon.assert.notCalled(vsCodeStub.window.createQuickPick);
    });

    describe('when servers are assigned', () => {
      it('lists assigned servers for selection', async () => {
        const additionalServer = { ...defaultServer, label: 'bar' };
        serverStorageStub.list.resolves([defaultServer, additionalServer]);

        void renameServerAlias(vsCodeStub.asVsCode(), serverStorageStub);
        sinon.assert.calledOnce(serverStorageStub.list);

        await quickPickStub.nextShow();
        expect(quickPickStub.items).to.deep.equal([
          { label: defaultServer.label, value: defaultServer },
          { label: additionalServer.label, value: additionalServer },
        ]);
      });

      describe('renaming the selected server', () => {
        it('validates the input alias', async () => {
          serverStorageStub.list.resolves([defaultServer]);
          void renameServerAlias(vsCodeStub.asVsCode(), serverStorageStub);
          await quickPickStub.nextShow();
          quickPickStub.onDidChangeSelection.yield([
            { label: defaultServer.label, value: defaultServer },
          ]);

          await inputBoxStub.nextShow();
          inputBoxStub.value = 's'.repeat(11);
          inputBoxStub.onDidChangeValue.yield(inputBoxStub.value);
          expect(inputBoxStub.validationMessage).equal(
            'Name must be less than 10 characters.',
          );

          inputBoxStub.value = 's'.repeat(10);
          inputBoxStub.onDidChangeValue.yield(inputBoxStub.value);
          expect(inputBoxStub.validationMessage).equal('');
        });

        it('updates the server alias', async () => {
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
          inputBoxStub.value = 'new_alias';
          inputBoxStub.onDidChangeValue.yield(inputBoxStub.value);
          inputBoxStub.onDidAccept.yield();

          await expect(rename).to.eventually.be.fulfilled;
          sinon.assert.calledOnceWithExactly(serverStorageStub.store, [
            { ...defaultServer, label: 'new_alias' },
          ]);
        });

        it('does not update the server alias when it is unchanged', async () => {
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

  describe('mountServer', () => {
    const source = CommandSource.COMMAND_SOURCE_COMMAND_PALETTE;
    let assignmentManagerStub: SinonStubbedInstance<AssignmentManager>;
    let fsStub: SinonStubbedInstance<ContentsFileSystemProvider>;
    let logStub: SinonStubbedFunction<typeof telemetry.logMountServer>;

    beforeEach(() => {
      assignmentManagerStub = sinon.createStubInstance(AssignmentManager);
      fsStub = sinon.createStubInstance(ContentsFileSystemProvider);
      logStub = sinon.stub(telemetry, 'logMountServer');
    });

    it('does nothing when no servers are assigned', async () => {
      // Type assertion needed due to overloading on getServers
      (assignmentManagerStub.getServers as sinon.SinonStub)
        .withArgs('extension')
        .resolves([]);

      await mountServer(
        vsCodeStub.asVsCode(),
        assignmentManagerStub,
        fsStub,
        source,
      );

      sinon.assert.notCalled(vsCodeStub.window.createQuickPick);
      sinon.assert.notCalled(fsStub.mount);
      sinon.assert.calledOnceWithExactly(logStub, source, undefined);
    });

    it('mounts the server directly when only one is assigned', async () => {
      // Type assertion needed due to overloading on getServers
      (assignmentManagerStub.getServers as sinon.SinonStub)
        .withArgs('extension')
        .resolves([defaultServer]);

      await mountServer(
        vsCodeStub.asVsCode(),
        assignmentManagerStub,
        fsStub,
        source,
      );

      sinon.assert.notCalled(vsCodeStub.window.createQuickPick);
      sinon.assert.calledOnceWithExactly(fsStub.mount, defaultServer);
      sinon.assert.calledOnceWithExactly(logStub, source, defaultServer.id);
    });

    describe('when multiple servers are assigned', () => {
      let additionalServer: ColabAssignedServer;

      beforeEach(() => {
        additionalServer = { ...defaultServer, id: randomUUID(), label: 'bar' };
        // Type assertion needed due to overloading on getServers
        (assignmentManagerStub.getServers as sinon.SinonStub)
          .withArgs('extension')
          .resolves([defaultServer, additionalServer]);
      });

      it('lists servers for selection', async () => {
        void mountServer(
          vsCodeStub.asVsCode(),
          assignmentManagerStub,
          fsStub,
          source,
        );
        await quickPickStub.nextShow();

        expect(quickPickStub.items).to.deep.equal([
          {
            label: defaultServer.label,
            value: defaultServer,
            description: 'VS Code Server',
          },
          {
            label: additionalServer.label,
            value: additionalServer,
            description: 'VS Code Server',
          },
        ]);
      });

      it('mounts the selected server', async () => {
        const mount = mountServer(
          vsCodeStub.asVsCode(),
          assignmentManagerStub,
          fsStub,
          source,
        );
        await quickPickStub.nextShow();
        quickPickStub.onDidChangeSelection.yield([
          { label: defaultServer.label, value: defaultServer },
        ]);

        await expect(mount).to.eventually.be.fulfilled;
        sinon.assert.calledOnceWithExactly(fsStub.mount, defaultServer);
        sinon.assert.calledOnceWithExactly(logStub, source, defaultServer.id);
      });

      it('does not mount if selection is cancelled', async () => {
        const mount = mountServer(
          vsCodeStub.asVsCode(),
          assignmentManagerStub,
          fsStub,
          source,
        );
        await quickPickStub.nextShow();
        quickPickStub.onDidHide.yield();

        await expect(mount).to.eventually.be.fulfilled;
        sinon.assert.notCalled(fsStub.mount);
        sinon.assert.calledOnceWithExactly(logStub, source, undefined);
      });

      it('shows back button when requested', async () => {
        void mountServer(
          vsCodeStub.asVsCode(),
          assignmentManagerStub,
          fsStub,
          source,
          /* withBackButton= */ true,
        );
        await quickPickStub.nextShow();

        expect(quickPickStub.buttons).to.deep.equal([
          vsCodeStub.QuickInputButtons.Back,
        ]);
      });
    });
  });

  describe('removeServer', () => {
    let assignmentManagerStub: SinonStubbedInstance<AssignmentManager>;

    beforeEach(() => {
      assignmentManagerStub = sinon.createStubInstance(AssignmentManager);
      vsCodeStub.window.withProgress.callsFake((_options, task) =>
        task({ report: sinon.stub() }, new TestCancellationTokenSource().token),
      );
    });

    function selectAndAccept(
      ...servers: (ColabAssignedServer | UnownedServer)[]
    ) {
      quickPickStub.selectedItems = servers.map((s) => ({
        label: s.label,
        value: s,
      }));
      quickPickStub.onDidAccept.yield();
    }

    it('does not open the Quick Pick when no servers are assigned', async () => {
      assignmentManagerStub.getServers.withArgs('all').resolves({
        assigned: [],
        unowned: [],
      });

      await removeServer(vsCodeStub.asVsCode(), assignmentManagerStub);

      sinon.assert.notCalled(vsCodeStub.window.createQuickPick);
    });

    describe('when servers are assigned', () => {
      it('lists mixed servers with a separator', async () => {
        const additionalVsCodeServer = { ...defaultServer, label: 'bar' };
        const nonVsCodeServer = {
          id: 'test-id',
          label: 'test.ipynb',
          endpoint: 'test-endpoint',
          variant: Variant.DEFAULT,
        };
        assignmentManagerStub.getServers.withArgs('all').resolves({
          assigned: [defaultServer, additionalVsCodeServer],
          unowned: [nonVsCodeServer],
        });

        void removeServer(vsCodeStub.asVsCode(), assignmentManagerStub);
        await quickPickStub.nextShow();

        expect(quickPickStub.items).to.deep.equal([
          {
            label: defaultServer.label,
            value: defaultServer,
            description: 'VS Code Server',
          },
          {
            label: additionalVsCodeServer.label,
            value: additionalVsCodeServer,
            description: 'VS Code Server',
          },
          { label: '', kind: vsCodeStub.QuickPickItemKind.Separator },
          {
            label: nonVsCodeServer.label,
            value: nonVsCodeServer,
            description: 'Colab Web Server',
          },
        ]);
      });

      it('lists VS Code servers without separator', async () => {
        const additionalVsCodeServer = { ...defaultServer, label: 'bar' };
        assignmentManagerStub.getServers.withArgs('all').resolves({
          assigned: [defaultServer, additionalVsCodeServer],
          unowned: [],
        });

        void removeServer(vsCodeStub.asVsCode(), assignmentManagerStub);
        await quickPickStub.nextShow();

        expect(quickPickStub.items).to.deep.equal([
          {
            label: defaultServer.label,
            value: defaultServer,
            description: 'VS Code Server',
          },
          {
            label: additionalVsCodeServer.label,
            value: additionalVsCodeServer,
            description: 'VS Code Server',
          },
        ]);
      });

      it('lists Colab web servers without separator', async () => {
        const nonVsCodeServer = {
          id: 'test-id',
          label: 'test.ipynb',
          endpoint: 'test-endpoint',
          variant: Variant.DEFAULT,
        };
        assignmentManagerStub.getServers.withArgs('all').resolves({
          assigned: [],
          unowned: [nonVsCodeServer],
        });

        void removeServer(vsCodeStub.asVsCode(), assignmentManagerStub);
        await quickPickStub.nextShow();

        expect(quickPickStub.items).to.deep.equal([
          {
            label: nonVsCodeServer.label,
            value: nonVsCodeServer,
            description: 'Colab Web Server',
          },
        ]);
      });

      it('shows a multi-select Quick Pick', async () => {
        assignmentManagerStub.getServers.withArgs('all').resolves({
          assigned: [defaultServer],
          unowned: [],
        });

        void removeServer(vsCodeStub.asVsCode(), assignmentManagerStub);
        await quickPickStub.nextShow();

        expect(quickPickStub.canSelectMany).to.equal(true);
      });

      it('does not unassign servers when none are selected', async () => {
        assignmentManagerStub.getServers.withArgs('all').resolves({
          assigned: [defaultServer],
          unowned: [],
        });

        const remove = removeServer(
          vsCodeStub.asVsCode(),
          assignmentManagerStub,
        );
        await quickPickStub.nextShow();
        selectAndAccept();

        await expect(remove).to.eventually.be.fulfilled;
        sinon.assert.notCalled(assignmentManagerStub.unassignServer);
        sinon.assert.notCalled(vsCodeStub.window.withProgress);
      });

      describe('when a server is removed', () => {
        let remove: Promise<void>;

        beforeEach(async () => {
          assignmentManagerStub.getServers.withArgs('all').resolves({
            assigned: [defaultServer],
            unowned: [],
          });
          remove = removeServer(vsCodeStub.asVsCode(), assignmentManagerStub);
          await quickPickStub.nextShow();
          selectAndAccept(defaultServer);
        });

        it('unassigns the selected server', async () => {
          await expect(remove).to.eventually.be.fulfilled;

          sinon.assert.calledOnceWithExactly(
            assignmentManagerStub.unassignServer,
            defaultServer,
          );
        });

        it('notifies the user while server unassignment is in progress', async () => {
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
      });

      describe('when multiple servers are removed', () => {
        let secondServer: ColabAssignedServer;
        let unownedServer: UnownedServer;

        beforeEach(() => {
          secondServer = { ...defaultServer, id: randomUUID(), label: 'bar' };
          unownedServer = {
            id: 'test-id',
            label: 'test.ipynb',
            endpoint: 'test-endpoint',
            variant: Variant.DEFAULT,
          };
          assignmentManagerStub.getServers.withArgs('all').resolves({
            assigned: [defaultServer, secondServer],
            unowned: [unownedServer],
          });
        });

        async function removeAll(): Promise<void> {
          const remove = removeServer(
            vsCodeStub.asVsCode(),
            assignmentManagerStub,
          );
          await quickPickStub.nextShow();
          selectAndAccept(defaultServer, secondServer, unownedServer);
          return remove;
        }

        it('unassigns each selected server in order', async () => {
          await expect(removeAll()).to.eventually.be.fulfilled;

          sinon.assert.calledThrice(assignmentManagerStub.unassignServer);
          expect(
            assignmentManagerStub.unassignServer.getCalls().map((c) => c.args),
          ).to.deep.equal([[defaultServer], [secondServer], [unownedServer]]);
        });

        it('unassigns servers one at a time', async () => {
          let inFlight = 0;
          let maxInFlight = 0;
          assignmentManagerStub.unassignServer.callsFake(async () => {
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((r) => setTimeout(r, 0));
            inFlight--;
          });

          await expect(removeAll()).to.eventually.be.fulfilled;

          expect(maxInFlight).to.equal(1);
        });

        it('notifies the user with the number of servers being removed', async () => {
          await expect(removeAll()).to.eventually.be.fulfilled;

          sinon.assert.calledOnceWithMatch(
            vsCodeStub.window.withProgress,
            {
              cancellable: false,
              location: vsCodeStub.ProgressLocation.Notification,
              title: 'Removing 3 servers...',
            },
            sinon.match.func,
          );
        });

        it('continues removing servers after one fails', async () => {
          const error = new Error('🤮');
          assignmentManagerStub.unassignServer
            .withArgs(secondServer)
            .rejects(error);
          const logErrorStub = sinon.stub(telemetry, 'logError');

          await expect(removeAll()).to.eventually.be.fulfilled;

          sinon.assert.calledThrice(assignmentManagerStub.unassignServer);
          sinon.assert.calledOnceWithExactly(logErrorStub, error);
          sinon.assert.calledOnce(vsCodeStub.window.showErrorMessage);
          sinon.assert.calledWith(
            vsCodeStub.window.showErrorMessage,
            `Failed to remove server "${secondServer.label}". Check logs for details.`,
          );
        });

        it('does not show an error when all servers are removed', async () => {
          await expect(removeAll()).to.eventually.be.fulfilled;

          sinon.assert.notCalled(vsCodeStub.window.showErrorMessage);
        });
      });
    });
  });
});
