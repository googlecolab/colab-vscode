/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon, { SinonStubbedInstance } from 'sinon';
import * as vscode from 'vscode';
import { ColabPseudoterminal } from './colab-pseudoterminal';
import { ColabTtyWebSocket } from './colab-tty-websocket';

describe('ColabPseudoterminal', () => {
  let ttyWebSocket: SinonStubbedInstance<ColabTtyWebSocket>;
  let pty: ColabPseudoterminal;
  let onDataCallbacks: Array<(data: string) => void>;
  let onCloseCallbacks: Array<() => void>;
  let onErrorCallbacks: Array<(error: Error) => void>;

  beforeEach(() => {
    onDataCallbacks = [];
    onCloseCallbacks = [];
    onErrorCallbacks = [];

    ttyWebSocket = sinon.createStubInstance(ColabTtyWebSocket);

    // Stub the event properties
    Object.defineProperty(ttyWebSocket, 'onData', {
      value: (callback: (data: string) => void) => {
        onDataCallbacks.push(callback);
        return { dispose: () => {} };
      },
    });
    Object.defineProperty(ttyWebSocket, 'onClose', {
      value: (callback: () => void) => {
        onCloseCallbacks.push(callback);
        return { dispose: () => {} };
      },
    });
    Object.defineProperty(ttyWebSocket, 'onError', {
      value: (callback: (error: Error) => void) => {
        onErrorCallbacks.push(callback);
        return { dispose: () => {} };
      },
    });

    pty = new ColabPseudoterminal(ttyWebSocket);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('Event Wiring', () => {
    beforeEach(() => {
      pty.open(undefined);
    });

    it('handleInput calls ttyWebSocket.send', () => {
      // Simulate connection by firing data
      onDataCallbacks.forEach((cb) => cb('connected'));

      const testInput = 'ls -la\n';
      pty.handleInput(testInput);

      sinon.assert.calledWith(ttyWebSocket.send, testInput);
    });

    it('setDimensions calls ttyWebSocket.sendResize', () => {
      // Simulate connection
      onDataCallbacks.forEach((cb) => cb('connected'));

      const dimensions = { columns: 120, rows: 30 } as vscode.TerminalDimensions;
      pty.setDimensions(dimensions);

      sinon.assert.calledWith(ttyWebSocket.sendResize, 120, 30);
    });

    it('WebSocket onData fires onDidWrite event', (done) => {
      const testData = 'terminal output\r\n';

      pty.onDidWrite((data) => {
        if (data === testData) {
          done();
        }
      });

      onDataCallbacks.forEach((cb) => cb(testData));
    });
  });

  describe('Lifecycle', () => {
    it('open() connects WebSocket', () => {
      pty.open(undefined);
      sinon.assert.calledOnce(ttyWebSocket.connect);
    });

    it('open() sends initial dimensions if available', () => {
      const dimensions = { columns: 80, rows: 24 } as vscode.TerminalDimensions;
      pty.open(dimensions);

      sinon.assert.calledOnce(ttyWebSocket.connect);
      sinon.assert.calledWith(ttyWebSocket.sendResize, 80, 24);
    });

    it('close() disposes WebSocket', () => {
      pty.open(undefined);
      pty.close();

      sinon.assert.calledOnce(ttyWebSocket.dispose);
    });

    it('close() is idempotent', () => {
      pty.open(undefined);
      pty.close();
      pty.close();

      sinon.assert.calledOnce(ttyWebSocket.dispose);
    });
  });

  describe('Error Handling', () => {
    it('handleInput when not connected does not call send', () => {
      pty.open(undefined);
      pty.handleInput('test');

      sinon.assert.notCalled(ttyWebSocket.send);
    });

    it('connection failure fires onDidClose with error code', (done) => {
      ttyWebSocket.connect.throws(new Error('Connection failed'));

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

      onCloseCallbacks.forEach((cb) => cb());
    });
  });
});
