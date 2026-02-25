/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'crypto';
import sinon, { SinonStubbedInstance } from 'sinon';
import { ExtensionTerminalOptions, QuickPick, QuickPickItem } from 'vscode';
import { Variant } from '../../colab/api';
import { AssignmentManager } from '../../jupyter/assignments';
import { ColabAssignedServer } from '../../jupyter/servers';
import {
  buildQuickPickStub,
  QuickPickStub,
} from '../../test/helpers/quick-input';
import { TestThemeIcon } from '../../test/helpers/theme';
import { TestUri } from '../../test/helpers/uri';
import { newVsCodeStub, VsCodeStub } from '../../test/helpers/vscode';
import { openTerminal } from './terminal';

describe('openTerminal command', () => {
  let vsCodeStub: VsCodeStub;
  let assignmentManager: SinonStubbedInstance<AssignmentManager>;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    assignmentManager = sinon.createStubInstance(AssignmentManager);
    // Setup getServers to handle the 'extension' call properly
    (assignmentManager.getServers as sinon.SinonStub).callsFake(
      (from: 'extension' | 'external' | 'all') => {
        if (from === 'extension') {
          return Promise.resolve([]);
        }
        throw new Error('Unexpected call to getServers');
      },
    );
    const mockTerminal = { show: sinon.stub() };
    vsCodeStub.window.createTerminal.returns(mockTerminal as never);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('Server Selection', () => {
    it('requests extension source for servers', async () => {
      const server1 = buildColabAssignedServer({
        label: 'Server 1',
        endpoint: 'test-endpoint-1',
        baseUrl: 'https://server1.example.com',
        token: 'token1',
      });
      (assignmentManager.getServers as sinon.SinonStub).resolves([server1]);

      await openTerminal(vsCodeStub.asVsCode(), assignmentManager);

      sinon.assert.calledWith(
        assignmentManager.getServers as sinon.SinonStub,
        'extension',
      );
    });

    it('shows info message when no servers available', async () => {
      (assignmentManager.getServers as sinon.SinonStub).resolves([]);

      await openTerminal(vsCodeStub.asVsCode(), assignmentManager);

      sinon.assert.calledOnceWithMatch(
        vsCodeStub.window.showInformationMessage,
        sinon.match(/No Colab servers are currently assigned/),
      );
    });

    it('does not create terminal when no servers available', async () => {
      (assignmentManager.getServers as sinon.SinonStub).resolves([]);

      await openTerminal(vsCodeStub.asVsCode(), assignmentManager);

      sinon.assert.notCalled(vsCodeStub.window.createTerminal);
    });

    it('auto-selects and creates terminal with one server', async () => {
      const server1 = buildColabAssignedServer({
        label: 'Server 1',
        endpoint: 'test-endpoint-1',
        baseUrl: 'https://server1.example.com',
        token: 'token1',
      });
      (assignmentManager.getServers as sinon.SinonStub).resolves([server1]);

      await openTerminal(vsCodeStub.asVsCode(), assignmentManager);

      sinon.assert.calledOnceWithMatch(
        vsCodeStub.window.createTerminal,
        sinon.match(
          (options: ExtensionTerminalOptions) => options.name === 'Server 1',
        ),
      );
    });

    describe('with multiple servers', () => {
      const server1 = buildColabAssignedServer({
        label: 'Server 1',
        endpoint: 'test-endpoint-1',
        baseUrl: 'https://server1.example.com',
        token: 'token1',
      });
      const server2 = buildColabAssignedServer({
        label: 'Server 2',
        endpoint: 'test-endpoint-2',
        baseUrl: 'https://server2.example.com',
        token: 'token2',
      });
      let quickPickStub: QuickPickStub & { nextShow: () => Promise<void> };

      beforeEach(() => {
        (assignmentManager.getServers as sinon.SinonStub).resolves([
          server1,
          server2,
        ]);

        quickPickStub = buildQuickPickStub();
        vsCodeStub.window.createQuickPick.returns(
          quickPickStub as Partial<
            QuickPick<QuickPickItem>
          > as QuickPick<QuickPickItem>,
        );
      });

      it('shows QuickPick', async () => {
        // Start openTerminal in background
        const openTerminalPromise = openTerminal(
          vsCodeStub.asVsCode(),
          assignmentManager,
        );

        // Wait for QuickPick to be shown
        await quickPickStub.nextShow();

        // Simulate user cancelling (hiding the quick pick)
        quickPickStub.onDidHide.yield(undefined);

        // Wait for openTerminal to complete
        await openTerminalPromise;

        sinon.assert.calledOnce(vsCodeStub.window.createQuickPick);
        sinon.assert.calledOnce(quickPickStub.show);
      });

      it('creates terminal with selected server', async () => {
        // Start openTerminal in background
        const openTerminalPromise = openTerminal(
          vsCodeStub.asVsCode(),
          assignmentManager,
        );
        // Wait for QuickPick to be shown
        await quickPickStub.nextShow();
        // Simulate user selecting Server 2
        quickPickStub.onDidChangeSelection.yield([
          { label: server2.label, value: server2 },
        ]);

        // Wait for openTerminal to complete
        await openTerminalPromise;

        sinon.assert.calledOnceWithMatch(
          vsCodeStub.window.createTerminal,
          sinon.match(
            (options: ExtensionTerminalOptions) => options.name === 'Server 2',
          ),
        );
      });
    });
  });

  describe('Terminal Creation', () => {
    it('creates terminal with correct name format', async () => {
      const server1 = buildColabAssignedServer({
        label: 'Server 1',
        endpoint: 'test-endpoint-1',
        baseUrl: 'https://server1.example.com',
        token: 'token1',
      });
      (assignmentManager.getServers as sinon.SinonStub).resolves([server1]);

      await openTerminal(vsCodeStub.asVsCode(), assignmentManager);

      sinon.assert.calledOnceWithMatch(
        vsCodeStub.window.createTerminal,
        sinon.match(
          (options: ExtensionTerminalOptions) =>
            options.name === 'Server 1' &&
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            !!options.pty &&
            options.iconPath instanceof TestThemeIcon &&
            options.iconPath.id === 'colab-logo',
        ),
      );
    });

    it('calls terminal.show() after creation', async () => {
      const server1 = buildColabAssignedServer({
        label: 'Server 1',
        endpoint: 'test-endpoint-1',
        baseUrl: 'https://server1.example.com',
        token: 'token1',
      });
      (assignmentManager.getServers as sinon.SinonStub).resolves([server1]);
      const mockTerminal = { show: sinon.stub() };
      vsCodeStub.window.createTerminal.returns(mockTerminal as never);

      await openTerminal(vsCodeStub.asVsCode(), assignmentManager);

      sinon.assert.calledOnce(mockTerminal.show);
    });
  });
});

function buildColabAssignedServer(opts: {
  label: string;
  endpoint: string;
  baseUrl: string;
  token: string;
}): ColabAssignedServer {
  return {
    id: randomUUID(),
    label: opts.label,
    variant: Variant.DEFAULT,
    endpoint: opts.endpoint,
    connectionInformation: {
      baseUrl: TestUri.parse(opts.baseUrl),
      token: opts.token,
      tokenExpiry: new Date(Date.now() + 3600000),
      headers: {},
      fetch: (() => undefined) as never,
      WebSocket: (() => undefined) as never,
    },
    dateAssigned: new Date(),
  };
}
