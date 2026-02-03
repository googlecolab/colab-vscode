/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ClientRequestArgs } from 'http';
import { expect } from 'chai';
import sinon, { SinonStubbedInstance } from 'sinon';
import { Disposable } from 'vscode';
import WebSocket from 'ws';
import { handleEphemeralAuth } from '../auth/ephemeral';
import { ColabClient } from '../colab/client';
import { newVsCodeStub, VsCodeStub } from '../test/helpers/vscode';
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
      { name: 'single protocol only', protocols: '', options: undefined },
      { name: 'protocols only', protocols: [], options: undefined },
      { name: 'single protocol and options', protocols: '', options: {} },
      { name: 'protocols and options', protocols: [], options: {} },
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
        request: { authType: 'dfs_ephemeral' },
      },
      metadata: {
        colab_request_type: 'request_auth',
        colab_msg_id: testRequestMessageId,
      },
    };
    const supportedAuthTypes = ['dfs_ephemeral', 'auth_user_ephemeral'];
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

    supportedAuthTypes.forEach((authType) => {
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
          JSON.stringify({
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

      testWebSocket.emit(
        'message',
        JSON.stringify(rawColabRequestMessage),
        /* isBinary= */ false,
      );

      await expect(handleEphemeralAuthFailed).to.eventually.be.fulfilled;
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

    it('does not trigger handleEphemeralAuth if message is not a colab_request', () => {
      const rawMessage = JSON.stringify({
        header: { msg_type: 'execute_reply' },
        content: { request: { authType: 'dfs_ephemeral' } },
        metadata: { colab_request_type: 'request_auth', colab_msg_id: 1 },
      });

      testWebSocket.emit('message', rawMessage, /* isBinary= */ false);

      sinon.assert.notCalled(handleEphemeralAuthStub);
    });

    it('does not trigger handleEphemeralAuth if message is not dfs_ephemeral or auth_user_ephemeral', () => {
      const rawMessage = JSON.stringify({
        header: { msg_type: 'colab_request' },
        content: { request: { authType: 'dfs_persistent' } },
        metadata: { colab_request_type: 'request_auth', colab_msg_id: 1 },
      });

      testWebSocket.emit('message', rawMessage, /* isBinary= */ false);

      sinon.assert.notCalled(handleEphemeralAuthStub);
    });

    it('does not trigger handleEphemeralAuth if message is empty', () => {
      testWebSocket.emit('message', /* message= */ '', /* isBinary= */ false);

      sinon.assert.notCalled(handleEphemeralAuthStub);
    });

    it('does not trigger handleEphemeralAuth if message is malformed', () => {
      testWebSocket.emit('message', 'malformed message', /* isBinary= */ false);

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
      testWebSocket.emit('message', 'some binary data', /* isBinary= */ true);

      sinon.assert.notCalled(handleEphemeralAuthStub);
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

    it('blocks send after disposed', () => {
      testWebSocket.dispose();

      expect(() => {
        testWebSocket.send('test message');
      }).to.throw(/ColabWebSocket cannot be used after it has been disposed/);
    });
  });

  class TestWebSocket extends WebSocket {
    constructor(
      _address: string | URL | null,
      protocols?:
        | string
        | string[]
        | WebSocket.ClientOptions
        | ClientRequestArgs,
      options?: WebSocket.ClientOptions | ClientRequestArgs,
    ) {
      super(null); // Avoid real WS connection
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
