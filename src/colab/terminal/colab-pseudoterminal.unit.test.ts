/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon from 'sinon';
import { newVsCodeStub, VsCodeStub } from '../../test/helpers/vscode';
import { ColabPseudoterminal } from './colab-pseudoterminal';
import { ColabTerminalWebSocketLike } from './colab-terminal-websocket';

describe('ColabPseudoterminal', () => {
  let vsCodeStub: VsCodeStub;
  let terminalWebSocket: ColabTerminalWebSocketLike & {
    connect: sinon.SinonStub<[], void>;
    send: sinon.SinonStub<[string], void>;
    sendResize: sinon.SinonStub<[number, number], void>;
    dispose: sinon.SinonStub<[], void>;
  };
  let pty: ColabPseudoterminal;
  let onOpenCallbacks: (() => void)[];
  let onDataCallbacks: ((data: string) => void)[];
  let onCloseCallbacks: (() => void)[];
  let onErrorCallbacks: ((error: Error) => void)[];

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    onOpenCallbacks = [];
    onDataCallbacks = [];
    onCloseCallbacks = [];
    onErrorCallbacks = [];

    terminalWebSocket = {
      connect: sinon.stub(),
      send: sinon.stub(),
      sendResize: sinon.stub(),
      dispose: sinon.stub(),
      onOpen: (callback: () => void) => {
        onOpenCallbacks.push(callback);
        return { dispose: () => undefined };
      },
      onData: (callback: (data: string) => void) => {
        onDataCallbacks.push(callback);
        return { dispose: () => undefined };
      },
      onClose: (callback: () => void) => {
        onCloseCallbacks.push(callback);
        return { dispose: () => undefined };
      },
      onError: (callback: (error: Error) => void) => {
        onErrorCallbacks.push(callback);
        return { dispose: () => undefined };
      },
    };

    pty = new ColabPseudoterminal(vsCodeStub.asVsCode(), terminalWebSocket);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('Event Wiring', () => {
      beforeEach(() => {
        pty.open(undefined);
      });

    it('handleInput calls ttyWebSocket.send', () => {
      // Simulate connection by firing onOpen
      onOpenCallbacks.forEach((cb) => {
        cb();
      });

      const testInput = 'ls -la\n';
      pty.handleInput(testInput);

      sinon.assert.calledWith(terminalWebSocket.send, testInput);
    });

    it('setDimensions calls ttyWebSocket.sendResize', () => {
      // Simulate connection
      onOpenCallbacks.forEach((cb) => {
        cb();
      });

      const dimensions: Parameters<ColabPseudoterminal['setDimensions']>[0] = {
        columns: 120,
        rows: 30,
      };
      pty.setDimensions(dimensions);

      sinon.assert.calledWith(terminalWebSocket.sendResize, 120, 30);
    });

    it('WebSocket onData fires onDidWrite event', (done) => {
      const testData = 'terminal output\r\n';

      pty.onDidWrite((data) => {
        if (data === testData) {
          done();
        }
      });

      onDataCallbacks.forEach((cb) => {
        cb(testData);
      });
    });
  });

  describe('Lifecycle', () => {
    it('open() connects WebSocket', () => {
      pty.open(undefined);
      sinon.assert.calledOnce(terminalWebSocket.connect);
    });

    it('open() sends initial dimensions if available', () => {
      const dimensions: Exclude<
        Parameters<ColabPseudoterminal['open']>[0],
        undefined
      > = {
        columns: 80,
        rows: 24,
      };
      pty.open(dimensions);

      // Simulate successful connection
      onOpenCallbacks.forEach((cb) => {
        cb();
      });

      sinon.assert.calledOnce(terminalWebSocket.connect);
      sinon.assert.calledWith(terminalWebSocket.sendResize, 80, 24);
    });

    it('close() disposes WebSocket', () => {
      pty.open(undefined);
      pty.close();

      sinon.assert.calledOnce(terminalWebSocket.dispose);
    });

    it('close() is idempotent', () => {
      pty.open(undefined);
      pty.close();
      pty.close();

      sinon.assert.calledOnce(terminalWebSocket.dispose);
    });
  });

  describe('Error Handling', () => {
    it('handleInput when not connected does not call send', () => {
      pty.open(undefined);
      pty.handleInput('test');

      sinon.assert.notCalled(terminalWebSocket.send);
    });

    it('connection failure fires onDidClose with error code', (done) => {
      terminalWebSocket.connect.throws(new Error('Connection failed'));

      pty.onDidClose((exitCode) => {
        expect(exitCode).to.equal(1);
        done();
      });

      pty.open(undefined);
    });

    it('WebSocket onClose fires terminal onDidClose', (done) => {
      pty.open(undefined);

      pty.onDidClose((exitCode) => {
        expect(exitCode).to.equal(0);
        done();
      });

      onCloseCallbacks.forEach((cb) => {
        cb();
      });
    });
  });
});
