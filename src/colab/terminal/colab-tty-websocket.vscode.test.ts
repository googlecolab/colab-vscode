/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import { randomUUID } from 'crypto';
import sinon from 'sinon';
import * as vscode from 'vscode';
import WebSocket from 'ws';
import { Variant } from '../../colab/api';
import { ColabAssignedServer } from '../../jupyter/servers';
import { COLAB_RUNTIME_PROXY_TOKEN_HEADER } from '../headers';
import { ColabTtyWebSocket } from './colab-tty-websocket';

describe('ColabTtyWebSocket', () => {
  const testServer: ColabAssignedServer = {
    id: randomUUID(),
    label: 'Test Server',
    variant: Variant.DEFAULT,
    endpoint: 'test-endpoint',
    connectionInformation: {
      baseUrl: vscode.Uri.parse('https://example.colab.google.com'),
      token: 'test-token-123',
      tokenExpiry: new Date(Date.now() + 3600000),
      headers: {},
      fetch: (() => {}) as never,
      WebSocket: (() => {}) as never,
    },
    dateAssigned: new Date(),
  };

  let ttyWebSocket: ColabTtyWebSocket;
  let capturedUrl: string | undefined;
  let capturedOptions: WebSocket.ClientOptions | undefined;

  class TestWebSocket extends WebSocket {
    public override readyState: 0 | 1 | 2 | 3 = WebSocket.OPEN;

    constructor(
      address: string | URL,
      protocols?: string | string[] | WebSocket.ClientOptions,
      options?: WebSocket.ClientOptions,
    ) {
      super(null); // Avoid real WS connection
      capturedUrl = address.toString();
      if (typeof protocols === 'object' && !Array.isArray(protocols)) {
        capturedOptions = protocols;
      } else {
        capturedOptions = options;
      }
    }

    override send(_data: unknown, _options?: unknown, _cb?: unknown): void {
      // Avoid real send
    }

    override close(): void {
      this.readyState = WebSocket.CLOSED;
    }
  }

  beforeEach(() => {
    capturedUrl = undefined;
    capturedOptions = undefined;
    ttyWebSocket = new ColabTtyWebSocket(testServer, TestWebSocket as any);
  });

  afterEach(() => {
    ttyWebSocket.dispose();
    sinon.restore();
  });

  describe('URL Building', () => {
    it('converts https:// baseUrl to wss://', () => {
      ttyWebSocket.connect();
      const url = capturedUrl;
      expect(url).to.match(/^wss:\/\//);
    });

    it('sets path to /colab/tty', () => {
      ttyWebSocket.connect();
      const url = capturedUrl;
      expect(url).to.include('/colab/tty');
    });

    it('does not include token in query parameter', () => {
      ttyWebSocket.connect();
      const url = capturedUrl;
      expect(url).to.not.include('colab-runtime-proxy-token');
    });
  });

  describe('Message Format', () => {
    beforeEach(() => {
      ttyWebSocket.connect();
    });

    it('send(data) creates {"data": data} message', () => {
      const testData = 'echo hello\n';
      const ws = (ttyWebSocket as unknown as { ws?: TestWebSocket }).ws;
      const sendSpy = sinon.spy(ws!, 'send');

      ttyWebSocket.send(testData);

      sinon.assert.calledOnce(sendSpy);
      const sentMessage = sendSpy.firstCall.args[0] as string;
      const parsed = JSON.parse(sentMessage);
      expect(parsed).to.deep.equal({ data: testData });
    });

    it('sendResize(cols, rows) creates {"cols": cols, "rows": rows} message', () => {
      const ws = (ttyWebSocket as unknown as { ws?: TestWebSocket }).ws;
      const sendSpy = sinon.spy(ws!, 'send');

      ttyWebSocket.sendResize(80, 24);

      sinon.assert.calledOnce(sendSpy);
      const sentMessage = sendSpy.firstCall.args[0] as string;
      const parsed = JSON.parse(sentMessage);
      expect(parsed).to.deep.equal({ cols: 80, rows: 24 });
    });

    it('incoming {"data": "..."} fires onData event', (done) => {
      const testData = 'terminal output\r\n';
      const message = JSON.stringify({ data: testData });
      const ws = (ttyWebSocket as unknown as { ws?: TestWebSocket }).ws;

      ttyWebSocket.onData((data) => {
        expect(data).to.equal(testData);
        done();
      });

      ws!.emit('message', message, false);
    });
  });

  describe('Auth Logic', () => {
    it('includes X-Colab-Runtime-Proxy-Token header', () => {
      ttyWebSocket.connect();
      expect(capturedOptions?.headers).to.have.property(COLAB_RUNTIME_PROXY_TOKEN_HEADER.key);
    });
  });

  describe('Lifecycle', () => {
    it('connect() throws if already connected', () => {
      ttyWebSocket.connect();
      expect(() => ttyWebSocket.connect()).to.throw('WebSocket is already connected');
    });

    it('connect() throws if disposed', () => {
      ttyWebSocket.dispose();
      expect(() => ttyWebSocket.connect()).to.throw('ColabTtyWebSocket is disposed');
    });

    it('send() throws if disposed', () => {
      ttyWebSocket.dispose();
      expect(() => ttyWebSocket.send('test')).to.throw('ColabTtyWebSocket is disposed');
    });

    it('dispose() cleans up properly', () => {
      ttyWebSocket.connect();
      const ws = (ttyWebSocket as unknown as { ws?: TestWebSocket }).ws;
      const removeAllListenersSpy = sinon.spy(ws!, 'removeAllListeners');
      const closeSpy = sinon.spy(ws!, 'close');

      ttyWebSocket.dispose();

      sinon.assert.calledOnce(removeAllListenersSpy);
      sinon.assert.calledOnce(closeSpy);
    });
  });
});
