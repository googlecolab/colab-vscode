/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'crypto';
import sinon, { SinonStubbedInstance } from 'sinon';
import { ExtensionTerminalOptions } from 'vscode';
import { Variant } from '../../colab/api';
import { AssignmentManager } from '../../jupyter/assignments';
import { ColabAssignedServer } from '../../jupyter/servers';
import { buildQuickPickStub } from '../../test/helpers/quick-input';
import { TestUri } from '../../test/helpers/uri';
import { newVsCodeStub, VsCodeStub } from '../../test/helpers/vscode';
import { openTerminal } from './terminal';

describe('openTerminal command', () => {
  let vsCodeStub: VsCodeStub;
  let vs: ReturnType<VsCodeStub['asVsCode']>;
  let assignmentManager: SinonStubbedInstance<AssignmentManager>;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    vs = vsCodeStub.asVsCode();
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
    it('shows info message when no servers available', async () => {
      (assignmentManager.getServers as sinon.SinonStub).resolves([]);

      await openTerminal(vs, assignmentManager);

      sinon.assert.calledOnce(vsCodeStub.window.showInformationMessage);
      sinon.assert.calledWithMatch(
        vsCodeStub.window.showInformationMessage,
        sinon.match(/No Colab servers are currently assigned/),
      );
    });

    it('does not create terminal when no servers available', async () => {
      (assignmentManager.getServers as sinon.SinonStub).resolves([]);

      await openTerminal(vs, assignmentManager);

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

      await openTerminal(vs, assignmentManager);

      sinon.assert.calledOnceWithMatch(
        vsCodeStub.window.createTerminal,
        sinon.match(
          (options: ExtensionTerminalOptions) =>
            options.name === 'Colab Terminal: Server 1',
        ),
      );
    });

    it('shows QuickPick with multiple servers', async () => {
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
      (assignmentManager.getServers as sinon.SinonStub).resolves([
        server1,
        server2,
      ]);

      const quickPickStub = buildQuickPickStub();
      vsCodeStub.window.createQuickPick.returns(quickPickStub as never);

      // Start openTerminal in background
      const openTerminalPromise = openTerminal(vs, assignmentManager);

      // Wait for QuickPick to be shown
      await quickPickStub.nextShow();

      // Simulate user canceling (hiding the quick pick)
      const onDidHideCallback = quickPickStub.onDidHide.firstCall.args[0];
      onDidHideCallback();

      // Wait for openTerminal to complete
      await openTerminalPromise;

      sinon.assert.calledOnce(vsCodeStub.window.createQuickPick);
      sinon.assert.calledOnce(quickPickStub.show);
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

      await openTerminal(vs, assignmentManager);

      sinon.assert.calledOnceWithMatch(
        vsCodeStub.window.createTerminal,
        sinon.match(
          (options: ExtensionTerminalOptions) =>
            options.name === 'Colab Terminal: Server 1' && !!options.pty,
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

      await openTerminal(vs, assignmentManager);

      sinon.assert.calledOnce(mockTerminal.show);
    });

    it('requests extension source for servers', async () => {
      const server1 = buildColabAssignedServer({
        label: 'Server 1',
        endpoint: 'test-endpoint-1',
        baseUrl: 'https://server1.example.com',
        token: 'token1',
      });
      (assignmentManager.getServers as sinon.SinonStub).resolves([server1]);

      await openTerminal(vs, assignmentManager);

      sinon.assert.calledWith(
        assignmentManager.getServers as sinon.SinonStub,
        'extension',
      );
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
