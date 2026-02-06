/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'crypto';
import { expect } from 'chai';
import sinon from 'sinon';
import WebSocket from 'ws';
import { Variant } from '../../colab/api';
import { ColabAssignedServer } from '../../jupyter/servers';
import { newVsCodeStub, VsCodeStub } from '../../test/helpers/vscode';
import { COLAB_RUNTIME_PROXY_TOKEN_HEADER } from '../headers';
import { ColabTerminalWebSocket } from './colab-terminal-websocket';

describe('ColabTerminalWebSocket', () => {
  let vsCodeStub: VsCodeStub;
  let testServer: ColabAssignedServer;

  let terminalWebSocket: ColabTerminalWebSocket;
  let capturedUrl: string | undefined;
  let capturedOptions: WebSocket.ClientOptions | undefined;

  class TestWebSocket extends WebSocket {
    override readyState: 0 | 1 | 2 | 3 = WebSocket.OPEN;

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
    vsCodeStub = newVsCodeStub();
    testServer = {
      id: randomUUID(),
      label: 'Test Server',
      variant: Variant.DEFAULT,
      endpoint: 'test-endpoint',
      connectionInformation: {
        baseUrl: vsCodeStub.Uri.parse('https://example.colab.google.com'),
        token: 'test-token-123',
        tokenExpiry: new Date(Date.now() + 3600000),
        headers: {},
        fetch: (() => undefined) as never,
        WebSocket: (() => undefined) as never,
      },
      dateAssigned: new Date(),
    };
    capturedUrl = undefined;
    capturedOptions = undefined;
    terminalWebSocket = new ColabTerminalWebSocket(
      vsCodeStub.asVsCode(),
      testServer,
      TestWebSocket as typeof WebSocket,
    );
  });

  afterEach(() => {
    terminalWebSocket.dispose();
    sinon.restore();
  });

  describe('URL Building', () => {
    it('converts https:// baseUrl to wss://', () => {
      terminalWebSocket.connect();
      const url = capturedUrl;
      expect(url).to.match(/^wss:\/\//);
    });

    it('sets path to /colab/tty', () => {
      terminalWebSocket.connect();
      const url = capturedUrl;
      expect(url).to.include('/colab/tty');
    });

    it('does not include token in query parameter', () => {
      terminalWebSocket.connect();
      const url = capturedUrl;
      expect(url).to.not.include('colab-runtime-proxy-token');
    });
  });

  describe('Message Format', () => {
    beforeEach(() => {
      terminalWebSocket.connect();
    });

    it('send(data) creates {"data": data} message', () => {
      const testData = 'echo hello\n';
      const ws = (terminalWebSocket as unknown as { ws?: TestWebSocket }).ws;
      if (!ws) {
        throw new Error('WebSocket was not created');
      }
      const sendSpy = sinon.spy(ws, 'send');

      terminalWebSocket.send(testData);

      sinon.assert.calledOnceWithMatch(
        sendSpy,
        sinon.match((message: string) => {
          const parsed = JSON.parse(message) as { data: string };
          return parsed.data === testData;
        }),
      );
    });

    it('sendResize(cols, rows) creates {"cols": cols, "rows": rows} message', () => {
      const ws = (terminalWebSocket as unknown as { ws?: TestWebSocket }).ws;
      if (!ws) {
        throw new Error('WebSocket was not created');
      }
      const sendSpy = sinon.spy(ws, 'send');

      terminalWebSocket.sendResize(80, 24);

      sinon.assert.calledOnceWithMatch(
        sendSpy,
        sinon.match((message: string) => {
          const parsed = JSON.parse(message) as {
            cols: number;
            rows: number;
          };
          return parsed.cols === 80 && parsed.rows === 24;
        }),
      );
    });

    it('incoming {"data": "..."} fires onData event', (done) => {
      const testData = 'terminal output\r\n';
      const message = JSON.stringify({ data: testData });
      const ws = (terminalWebSocket as unknown as { ws?: TestWebSocket }).ws;
      if (!ws) {
        throw new Error('WebSocket was not created');
      }

      terminalWebSocket.onData((data) => {
        expect(data).to.equal(testData);
        done();
      });

      ws.emit('message', message, false);
    });
  });

  describe('Auth Logic', () => {
    it('includes X-Colab-Runtime-Proxy-Token header', () => {
      terminalWebSocket.connect();
      expect(capturedOptions?.headers).to.have.property(
        COLAB_RUNTIME_PROXY_TOKEN_HEADER.key,
      );
    });
  });

  describe('Lifecycle', () => {
    describe('connect()', () => {
      it('throws if already connected', () => {
        terminalWebSocket.connect();

        expect(() => {
          terminalWebSocket.connect();
        }).to.throw('WebSocket is already connected');
      });

      it('throws if disposed', () => {
        terminalWebSocket.dispose();

        expect(() => {
          terminalWebSocket.connect();
        }).to.throw('ColabTerminalWebSocket is disposed');
      });
    });

    it('send() throws if disposed', () => {
      terminalWebSocket.dispose();

      expect(() => {
        terminalWebSocket.send('test');
      }).to.throw('ColabTerminalWebSocket is disposed');
    });

    it('dispose() cleans up properly', () => {
      terminalWebSocket.connect();
      const ws = (terminalWebSocket as unknown as { ws?: TestWebSocket }).ws;
      if (!ws) {
        throw new Error('WebSocket was not created');
      }
      const removeAllListenersSpy = sinon.spy(ws, 'removeAllListeners');
      const closeSpy = sinon.spy(ws, 'close');

      terminalWebSocket.dispose();

      sinon.assert.calledOnce(removeAllListenersSpy);
      sinon.assert.calledOnce(closeSpy);
    });
  });
});
