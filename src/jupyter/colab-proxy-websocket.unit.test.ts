/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ClientRequestArgs } from 'http';
import { expect } from 'chai';
import sinon, { SinonStubbedInstance } from 'sinon';
import { Disposable } from 'vscode';
import WebSocket, { WebSocketServer } from 'ws';
import { handleEphemeralAuth } from '../auth/ephemeral';
import { ColabClient } from '../colab/client/v1';
import { AuthType } from '../colab/client/v1/api';
import { UserCancelledError } from '../common/cancellation';
import { telemetry } from '../telemetry';
import { newVsCodeStub, VsCodeStub } from '../test/helpers/vscode';
import { UnconnectedWebSocket } from '../test/helpers/ws';
import {
  colabProxyWebSocket,
  ColabInputReplyMessage,
} from './colab-proxy-websocket';
import { ColabAssignedServer } from './servers';

describe('colabProxyWebSocket', () => {
  const testServer = {
    connectionInformation: {
      token: 'test-token',
    },
  } as ColabAssignedServer;
  let vsCodeStub: VsCodeStub;
  let colabClientStub: SinonStubbedInstance<ColabClient>;
  let handleEphemeralAuthStub: sinon.SinonStubbedFunction<
    typeof handleEphemeralAuth
  >;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    colabClientStub = sinon.createStubInstance(ColabClient);
    handleEphemeralAuthStub = sinon.stub();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('constructor', () => {
    const tests = [
      {
        name: 'no protocols or options',
        protocols: undefined,
        options: undefined,
      },
      { name: 'options only', protocols: {}, options: undefined },
      {
        name: 'single protocol only',
        protocols: 'jupyter',
        options: undefined,
      },
      { name: 'protocols only', protocols: ['jupyter'], options: undefined },
      {
        name: 'single protocol and options',
        protocols: 'jupyter',
        options: {},
      },
      { name: 'protocols and options', protocols: ['jupyter'], options: {} },
    ];

    tests.forEach(({ name, protocols, options }) => {
      it(`adds Colab headers to WebSocket with ${name}`, () => {
        const wsc = colabProxyWebSocket(
          vsCodeStub.asVsCode(),
          colabClientStub,
          testServer,
          TestWebSocket,
        );
        new wsc('ws://example.com/socket', protocols, options);
      });
    });
  });

  describe('send', () => {
    let testWebSocket: TestWebSocket;

    beforeEach(() => {
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
      );
      testWebSocket = new wsc('ws://example.com/socket');
    });

    interface TestWebSocketWithClientSessionId extends TestWebSocket {
      clientSessionId?: string;
    }

    it('sets client session ID on first call', () => {
      const testWebSocketWithClientSessionId =
        testWebSocket as TestWebSocketWithClientSessionId;
      expect(testWebSocketWithClientSessionId.clientSessionId).to.be.undefined;
      const sessionId = 'test-client-session-id';

      testWebSocket.send(
        JSON.stringify({
          header: {
            session: sessionId,
          },
        }),
      );

      expect(testWebSocketWithClientSessionId.clientSessionId).to.equal(
        sessionId,
      );
    });

    it('does not change client session ID on subsequent calls', () => {
      const testWebSocketWithClientSessionId =
        testWebSocket as TestWebSocketWithClientSessionId;
      const sessionId = 'test-client-session-id';
      testWebSocket.send(
        JSON.stringify({
          header: {
            session: sessionId,
          },
        }),
      );
      expect(testWebSocketWithClientSessionId.clientSessionId).to.equal(
        sessionId,
      );

      // Makes a second send call
      testWebSocket.send(
        JSON.stringify({
          header: {
            session: 'a-different-session-id',
          },
        }),
      );

      // Client session ID remains the same.
      expect(testWebSocketWithClientSessionId.clientSessionId).to.equal(
        sessionId,
      );
    });
  });

  describe('message event', () => {
    const testRequestMessageId = 123;
    const rawColabRequestMessage = {
      header: { msg_type: 'colab_request' },
      content: {
        request: { authType: AuthType.DFS_EPHEMERAL },
      },
      metadata: {
        colab_request_type: 'request_auth',
        colab_msg_id: testRequestMessageId,
      },
    };
    let testWebSocket: TestWebSocket;

    beforeEach(() => {
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
        handleEphemeralAuthStub,
      );
      testWebSocket = new wsc('ws://example.com/socket');
      // Send a dummy message to set client session ID
      testWebSocket.send(
        JSON.stringify({
          header: {
            session: 'test-session-id',
          },
        }),
      );
    });

    Object.values(AuthType).forEach((authType) => {
      it(`triggers handleEphemeralAuth and sends a reply if message is a ${authType} colab_request`, async () => {
        const ephemeralAuthHandled = new Promise<void>((resolve) => {
          handleEphemeralAuthStub.callsFake(() => {
            resolve();
            return Promise.resolve();
          });
        });
        const sendSpy = sinon.spy(testWebSocket, 'send');

        testWebSocket.emit(
          'message',
          textFrame({
            ...rawColabRequestMessage,
            content: { request: { authType } },
          }),
          /* isBinary= */ false,
        );

        await expect(ephemeralAuthHandled).to.eventually.be.fulfilled;
        sinon.assert.calledOnceWithMatch(
          sendSpy,
          sinon.match((data: string) => {
            const message = JSON.parse(data) as unknown;
            return (
              isColabInputReplyMessage(message) &&
              message.content.value.colab_msg_id === testRequestMessageId &&
              !message.content.value.error
            );
          }),
        );
      });
    });

    it('sends an error reply if handleEphemeralAuth throws an error', async () => {
      const errMsg = 'test error message';
      const handleEphemeralAuthFailed = new Promise<void>((resolve) => {
        handleEphemeralAuthStub.callsFake(() => {
          resolve();
          return Promise.reject(new Error(errMsg));
        });
      });
      const sendSpy = sinon.spy(testWebSocket, 'send');
      const logErrorStub = sinon.stub(telemetry, 'logError');

      testWebSocket.emit(
        'message',
        textFrame(rawColabRequestMessage),
        /* isBinary= */ false,
      );

      await expect(handleEphemeralAuthFailed).to.eventually.be.fulfilled;
      sinon.assert.calledOnce(logErrorStub);
      sinon.assert.calledOnceWithMatch(
        sendSpy,
        sinon.match((data: string) => {
          const message = JSON.parse(data) as unknown;
          return (
            isColabInputReplyMessage(message) &&
            message.content.value.error === errMsg
          );
        }),
      );
    });

    it('does not report an error when the user declines consent', async () => {
      const errMsg = 'User cancelled dfs_ephemeral authorization';
      const consentDeclined = new Promise<void>((resolve) => {
        handleEphemeralAuthStub.callsFake(() => {
          resolve();
          return Promise.reject(new UserCancelledError(errMsg));
        });
      });
      const sendSpy = sinon.spy(testWebSocket, 'send');
      const logErrorStub = sinon.stub(telemetry, 'logError');

      testWebSocket.emit(
        'message',
        textFrame(rawColabRequestMessage),
        /* isBinary= */ false,
      );

      await expect(consentDeclined).to.eventually.be.fulfilled;
      // The kernel still needs to hear that no credentials are coming.
      sinon.assert.calledOnceWithMatch(
        sendSpy,
        sinon.match((data: string) => {
          const message = JSON.parse(data) as unknown;
          return (
            isColabInputReplyMessage(message) &&
            message.content.value.error === errMsg
          );
        }),
      );
      sinon.assert.notCalled(logErrorStub);
    });

    it('drops the input reply when the socket is no longer open', async () => {
      const ephemeralAuthHandled = new Promise<void>((resolve) => {
        handleEphemeralAuthStub.callsFake(() => {
          // The auth modal outlives the kernel socket.
          testWebSocket.readyState = WebSocket.CLOSED;
          resolve();
          return Promise.resolve();
        });
      });
      const sendSpy = sinon.spy(testWebSocket, 'send');
      const logErrorStub = sinon.stub(telemetry, 'logError');
      const unhandled: unknown[] = [];
      const capture = (reason: unknown) => {
        unhandled.push(reason);
      };
      process.on('unhandledRejection', capture);

      try {
        testWebSocket.emit(
          'message',
          textFrame(rawColabRequestMessage),
          /* isBinary= */ false,
        );

        await expect(ephemeralAuthHandled).to.eventually.be.fulfilled;
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        process.off('unhandledRejection', capture);
      }

      sinon.assert.notCalled(sendSpy);
      // Dropping the reply must be silent, not a reported error.
      sinon.assert.notCalled(logErrorStub);
      expect(unhandled).to.be.empty;
    });

    it('does not trigger handleEphemeralAuth if message is not a colab_request', () => {
      const rawMessage = textFrame({
        header: { msg_type: 'execute_reply' },
        content: { request: { authType: AuthType.DFS_EPHEMERAL } },
        metadata: { colab_request_type: 'request_auth', colab_msg_id: 1 },
      });

      testWebSocket.emit('message', rawMessage, /* isBinary= */ false);

      sinon.assert.notCalled(handleEphemeralAuthStub);
    });

    it('does not trigger handleEphemeralAuth if message is not dfs_ephemeral or auth_user_ephemeral', () => {
      const rawMessage = textFrame({
        header: { msg_type: 'colab_request' },
        content: { request: { authType: 'dfs_persistent' } },
        metadata: { colab_request_type: 'request_auth', colab_msg_id: 1 },
      });

      testWebSocket.emit('message', rawMessage, /* isBinary= */ false);

      sinon.assert.notCalled(handleEphemeralAuthStub);
    });

    it('does not trigger handleEphemeralAuth if message is empty', () => {
      testWebSocket.emit(
        'message',
        /* message= */ Buffer.alloc(0),
        /* isBinary= */ false,
      );

      sinon.assert.notCalled(handleEphemeralAuthStub);
    });

    it('does not trigger handleEphemeralAuth if message is malformed', () => {
      testWebSocket.emit(
        'message',
        Buffer.from('malformed message'),
        /* isBinary= */ false,
      );

      sinon.assert.notCalled(handleEphemeralAuthStub);
    });

    it('does not trigger handleEphemeralAuth if message data is ArrayBuffer', () => {
      testWebSocket.emit(
        'message',
        /* message= */ new ArrayBuffer(16),
        /* isBinary= */ false,
      );

      sinon.assert.notCalled(handleEphemeralAuthStub);
    });

    it('does not trigger handleEphemeralAuth if message data is binary', () => {
      testWebSocket.emit(
        'message',
        textFrame(rawColabRequestMessage),
        /* isBinary= */ true,
      );

      sinon.assert.notCalled(handleEphemeralAuthStub);
    });

    // The Jupyter extension subclasses the socket and reads raw message args
    // in its emit override, treating anything but a string as binary.
    it('presents text frames to subclass emit overrides as strings', () => {
      const received: unknown[] = [];
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
        handleEphemeralAuthStub,
      );
      class HookedWebSocket extends wsc {
        override emit(event: string | symbol, ...args: unknown[]): boolean {
          if (event === 'message') {
            received.push(args[0]);
          }
          return super.emit(event, ...args);
        }
      }
      const hooked = new HookedWebSocket('ws://example.com/socket');
      const binary = new ArrayBuffer(16);

      hooked.emit('message', Buffer.from('{"a":1}'), /* isBinary= */ false);
      hooked.emit('message', binary, /* isBinary= */ true);

      expect(received).to.deep.equal(['{"a":1}', binary]);
      expect(received[1]).to.equal(binary);
    });
  });

  describe('ping', () => {
    it('reports a still-connecting socket through the callback', () => {
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
      );
      const testWebSocket: TestWebSocket = new wsc('ws://example.com/socket');
      testWebSocket.readyState = WebSocket.CONNECTING;
      const callback = sinon.spy();

      expect(() => {
        testWebSocket.ping(callback);
      }).not.to.throw();
      sinon.assert.calledOnceWithMatch(
        callback,
        sinon.match
          .instanceOf(Error)
          .and(sinon.match.has('message', sinon.match(/not open/))),
      );
    });
  });

  describe('against a real server', () => {
    let server: WebSocketServer;
    let url: string;

    beforeEach(async () => {
      server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
      await new Promise((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Expected a TCP address');
      }
      url = `ws://127.0.0.1:${address.port.toString()}`;
    });

    afterEach(async () => {
      for (const client of server.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    });

    it('sends Colab headers and answers a colab_request text frame', async () => {
      handleEphemeralAuthStub.resolves();
      const reply = new Promise<unknown>((resolve) => {
        server.on('connection', (socket, request) => {
          expect(request.headers['x-colab-runtime-proxy-token']).to.equal(
            testServer.connectionInformation.token,
          );
          socket.once('message', () => {
            // The client's session is known; ask it for credentials.
            socket.send(
              JSON.stringify({
                header: { msg_type: 'colab_request' },
                content: { request: { authType: AuthType.DFS_EPHEMERAL } },
                metadata: {
                  colab_request_type: 'request_auth',
                  colab_msg_id: 7,
                },
              }),
            );
            socket.once('message', (data, isBinary) => {
              expect(isBinary).to.be.false;
              expect(Buffer.isBuffer(data)).to.be.true;
              resolve(JSON.parse(Buffer.isBuffer(data) ? data.toString() : ''));
            });
          });
        });
      });
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        WebSocket,
        handleEphemeralAuthStub,
      );
      const client = new wsc(url);
      await new Promise((resolve) => client.once('open', resolve));

      client.send(JSON.stringify({ header: { session: 'test-session-id' } }));

      const message = await reply;
      expect(isColabInputReplyMessage(message)).to.be.true;
      expect(message).to.have.nested.property('content.value.colab_msg_id', 7);
      client.close();
    });
  });

  describe('dispose', () => {
    let testWebSocket: TestWebSocket & Disposable;
    beforeEach(() => {
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
      );
      testWebSocket = new wsc('ws://example.com/socket');
    });

    it('removes the message event listener', () => {
      expect(testWebSocket.listenerCount('message')).to.equal(1);

      testWebSocket.dispose();

      expect(testWebSocket.listenerCount('message')).to.equal(0);
    });

    it('throws when send is called after being disposed', () => {
      testWebSocket.dispose();

      expect(() => {
        testWebSocket.send('test message');
      }).to.throw(/disposed/);
    });
  });

  class TestWebSocket extends UnconnectedWebSocket {
    /** Mutable stand-in for the real socket's connection state. */
    override readyState: WebSocket['readyState'] = WebSocket.OPEN;

    constructor(
      _address: string | URL | null,
      protocols?:
        | string
        | string[]
        | WebSocket.ClientOptions
        | ClientRequestArgs,
      options?: WebSocket.ClientOptions | ClientRequestArgs,
    ) {
      super(null, undefined, {}); // Avoid real WS connection
      if (typeof protocols === 'object' && !Array.isArray(protocols)) {
        verifyColabHeadersPresent(protocols);
      } else {
        verifyColabHeadersPresent(options);
      }
    }

    override send(_data: unknown, _options?: unknown, _cb?: unknown): void {
      // Avoid real send
    }
  }

  function verifyColabHeadersPresent(
    options?: WebSocket.ClientOptions | ClientRequestArgs,
  ) {
    expect(options?.headers).to.deep.equal({
      'X-Colab-Runtime-Proxy-Token': testServer.connectionInformation.token,
      'X-Colab-Client-Agent': 'vscode',
    });
  }
});

/**
 * Encodes a message the way ws delivers a received text frame: as a Buffer.
 *
 * @param message - The message to JSON-encode.
 * @returns The text frame payload.
 */
function textFrame(message: unknown): Buffer {
  return Buffer.from(JSON.stringify(message));
}

function isColabInputReplyMessage(
  message: unknown,
): message is ColabInputReplyMessage {
  return (
    typeof message === 'object' &&
    !!message &&
    'header' in message &&
    typeof message.header === 'object' &&
    !!message.header &&
    'msg_type' in message.header &&
    message.header.msg_type === 'input_reply' &&
    'content' in message &&
    typeof message.content === 'object' &&
    !!message.content &&
    'value' in message.content &&
    typeof message.content.value === 'object' &&
    !!message.content.value &&
    'type' in message.content.value &&
    message.content.value.type === 'colab_reply'
  );
}
