/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import { randomUUID } from 'crypto';
import sinon, { SinonStubbedInstance } from 'sinon';
import * as vscode from 'vscode';
import { Variant } from '../../colab/api';
import { AssignmentManager } from '../../jupyter/assignments';
import { ColabAssignedServer } from '../../jupyter/servers';
import { openTerminal } from './terminal';

describe('openTerminal command', () => {
  let assignmentManager: SinonStubbedInstance<AssignmentManager>;
  let createTerminalStub: sinon.SinonStub;
  let showInformationMessageStub: sinon.SinonStub;

  const server1: ColabAssignedServer = {
    id: randomUUID(),
    label: 'Server 1',
    variant: Variant.DEFAULT,
    endpoint: 'test-endpoint-1',
    connectionInformation: {
      baseUrl: vscode.Uri.parse('https://server1.example.com'),
      token: 'token1',
      tokenExpiry: new Date(Date.now() + 3600000),
      headers: {},
      fetch: (() => {}) as never,
      WebSocket: (() => {}) as never,
    },
    dateAssigned: new Date(),
  };

  const server2: ColabAssignedServer = {
    id: randomUUID(),
    label: 'Server 2',
    variant: Variant.GPU,
    endpoint: 'test-endpoint-2',
    connectionInformation: {
      baseUrl: vscode.Uri.parse('https://server2.example.com'),
      token: 'token2',
      tokenExpiry: new Date(Date.now() + 3600000),
      headers: {},
      fetch: (() => {}) as never,
      WebSocket: (() => {}) as never,
    },
    dateAssigned: new Date(),
  };

  beforeEach(() => {
    assignmentManager = sinon.createStubInstance(AssignmentManager);
    // Setup getServers to handle the 'extension' call properly
    (assignmentManager.getServers as sinon.SinonStub).callsFake(
      async (from: 'extension' | 'external' | 'all') => {
        if (from === 'extension') {
          return [];
        }
        throw new Error('Unexpected call to getServers');
      }
    );
    showInformationMessageStub = sinon.stub(vscode.window, 'showInformationMessage');

    const mockTerminal = {
      show: sinon.stub(),
    };
    createTerminalStub = sinon.stub(vscode.window, 'createTerminal').returns(mockTerminal as never);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('Server Selection', () => {
    it('shows info message when no servers available', async () => {
      (assignmentManager.getServers as sinon.SinonStub).resolves([]);

      await openTerminal(vscode, assignmentManager);

      sinon.assert.calledOnce(showInformationMessageStub);
      sinon.assert.calledWithMatch(
        showInformationMessageStub,
        /No Colab servers are currently assigned/,
      );
    });

    it('does not create terminal when no servers available', async () => {
      (assignmentManager.getServers as sinon.SinonStub).resolves([]);

      await openTerminal(vscode, assignmentManager);

      sinon.assert.notCalled(createTerminalStub);
    });

    it('auto-selects and creates terminal with one server', async () => {
      (assignmentManager.getServers as sinon.SinonStub).resolves([server1]);

      await openTerminal(vscode, assignmentManager);

      sinon.assert.calledOnce(createTerminalStub);
      const options = createTerminalStub.firstCall.args[0];
      expect(options).to.have.property('name', 'Colab Terminal: Server 1');
    });

    it('shows QuickPick with multiple servers', async () => {
      (assignmentManager.getServers as sinon.SinonStub).resolves([server1, server2]);

      const quickPickStub = sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);

      await openTerminal(vscode, assignmentManager);

      sinon.assert.called(quickPickStub);
    });
  });

  describe('Terminal Creation', () => {
    it('creates terminal with correct name format', async () => {
      (assignmentManager.getServers as sinon.SinonStub).resolves([server1]);

      await openTerminal(vscode, assignmentManager);

      sinon.assert.calledOnce(createTerminalStub);
      const options = createTerminalStub.firstCall.args[0];
      expect(options).to.have.property('name', 'Colab Terminal: Server 1');
      expect(options).to.have.property('pty');
    });

    it('calls terminal.show() after creation', async () => {
      (assignmentManager.getServers as sinon.SinonStub).resolves([server1]);
      const mockTerminal = { show: sinon.stub() };
      createTerminalStub.returns(mockTerminal as never);

      await openTerminal(vscode, assignmentManager);

      sinon.assert.calledOnce(mockTerminal.show);
    });

    it('requests extension source for servers', async () => {
      (assignmentManager.getServers as sinon.SinonStub).resolves([server1]);

      await openTerminal(vscode, assignmentManager);

      sinon.assert.calledWith(assignmentManager.getServers as sinon.SinonStub, 'extension');
    });
  });
});
