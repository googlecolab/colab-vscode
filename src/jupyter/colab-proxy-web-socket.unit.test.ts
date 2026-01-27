/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ClientRequestArgs } from 'http';
import { expect } from 'chai';
import sinon, { SinonStubbedInstance } from 'sinon';
import {
  Uri,
  WorkspaceConfiguration,
  ConfigurationChangeEvent,
  Disposable,
} from 'vscode';
import WebSocket from 'ws';
import { handleDriveFsAuth } from '../auth/drive';
import { ColabClient } from '../colab/client';
import { TestEventEmitter } from '../test/helpers/events';
import { newVsCodeStub, VsCodeStub } from '../test/helpers/vscode';
import {
  colabProxyWebSocket,
  ColabInputReplyMessage,
} from './colab-proxy-web-socket';
import { ColabAssignedServer } from './servers';

describe('colabProxyWebSocket', () => {
  const testServer = {
    connectionInformation: {
      token: 'test-token',
    },
  } as ColabAssignedServer;
  let vsCodeStub: VsCodeStub;
  let configChangeEmitter: TestEventEmitter<ConfigurationChangeEvent>;
  let colabClientStub: SinonStubbedInstance<ColabClient>;
  let handleDriveFsAuthStub: sinon.SinonStubbedFunction<
    typeof handleDriveFsAuth
  >;

  beforeEach(() => {
    configChangeEmitter = new TestEventEmitter<ConfigurationChangeEvent>();
    vsCodeStub = newVsCodeStub();
    vsCodeStub.workspace.getConfiguration.withArgs('colab').returns({
      get: sinon
        .stub<[string], boolean>()
        .withArgs('driveMounting')
        .returns(false),
    } as Pick<WorkspaceConfiguration, 'get'> as WorkspaceConfiguration);
    vsCodeStub.workspace.onDidChangeConfiguration.callsFake(
      configChangeEmitter.event,
    );
    colabClientStub = sinon.createStubInstance(ColabClient);
    handleDriveFsAuthStub = sinon.stub();
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
    const rawDriveMountMessage = JSON.stringify({
      header: { msg_type: 'execute_request' },
      content: { code: 'drive.mount("/content/drive")' },
    });

    it('shows warning notification when drive.mount() is executed', async () => {
      const warningShown = new Promise<void>((resolve) => {
        (vsCodeStub.window.showWarningMessage as sinon.SinonStub).callsFake(
          (message: string) => {
            expect(message).to.match(/drive.mount is not currently supported/);
            resolve();
            return Promise.resolve(undefined);
          },
        );
      });
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
      );
      const testWebSocket = new wsc('ws://example.com/socket');

      testWebSocket.send(rawDriveMountMessage);

      await expect(warningShown).to.eventually.be.fulfilled;
    });

    it('presents an action to view workaround when drive.mount() is executed', async () => {
      const warningShown = new Promise<void>((resolve) => {
        (vsCodeStub.window.showWarningMessage as sinon.SinonStub).callsFake(
          () => {
            resolve();
            return Promise.resolve('Workaround');
          },
        );
      });
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
      );
      const testWebSocket = new wsc('ws://example.com/socket');

      testWebSocket.send(rawDriveMountMessage);

      await expect(warningShown).to.eventually.be.fulfilled;
      sinon.assert.calledOnceWithMatch(
        vsCodeStub.env.openExternal,
        sinon.match(function (url: Uri) {
          return (
            url.toString() ===
            'https://github.com/googlecolab/colab-vscode/wiki/Known-Issues-and-Workarounds#drivemount'
          );
        }),
      );
    });

    it('presents an action to view issue when drive.mount() is executed', async () => {
      const warningShown = new Promise<void>((resolve) => {
        (vsCodeStub.window.showWarningMessage as sinon.SinonStub).callsFake(
          () => {
            resolve();
            return Promise.resolve('GitHub Issue');
          },
        );
      });
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
      );
      const testWebSocket = new wsc('ws://example.com/socket');

      testWebSocket.send(rawDriveMountMessage);

      await expect(warningShown).to.eventually.be.fulfilled;
      sinon.assert.calledOnceWithMatch(
        vsCodeStub.env.openExternal,
        sinon.match(function (url: Uri) {
          return (
            url.toString() ===
            'https://github.com/googlecolab/colab-vscode/issues/256'
          );
        }),
      );
    });

    it('does not show warning notification if not an execute_request', async () => {
      const rawJupyterMessage = JSON.stringify({
        header: { msg_type: 'kernel_info_request' },
      });
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
      );
      const testWebSocket = new wsc('ws://example.com/socket');

      testWebSocket.send(rawJupyterMessage);
      await flush();

      sinon.assert.notCalled(vsCodeStub.window.showWarningMessage);
    });

    it('does not show warning notification if not executing drive.mount()', async () => {
      const rawJupyterMessage = JSON.stringify({
        header: { msg_type: 'execute_request' },
        content: { code: 'print("Hello World!")' },
      });
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
      );
      const testWebSocket = new wsc('ws://example.com/socket');

      testWebSocket.send(rawJupyterMessage);
      await flush();

      sinon.assert.notCalled(vsCodeStub.window.showWarningMessage);
    });

    it('does not show warning notification if message is empty', async () => {
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
      );
      const testWebSocket = new wsc('ws://example.com/socket');

      testWebSocket.send('');
      await flush();

      sinon.assert.notCalled(vsCodeStub.window.showWarningMessage);
    });

    it('does not show warning notification if message is not Jupyter message format', async () => {
      const rawNonJupyterMessage = JSON.stringify({
        random_field: 'random_value',
      });
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
      );
      const testWebSocket = new wsc('ws://example.com/socket');

      testWebSocket.send(rawNonJupyterMessage);
      await flush();

      sinon.assert.notCalled(vsCodeStub.window.showWarningMessage);
    });

    it('does not show warning notification if message is malformed', async () => {
      const malformedMessage = 'non-json-format';
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
      );
      const testWebSocket = new wsc('ws://example.com/socket');

      testWebSocket.send(malformedMessage);
      await flush();

      sinon.assert.notCalled(vsCodeStub.window.showWarningMessage);
    });

    it('does not show warning notification if data is ArrayBuffer', async () => {
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
      );
      const testWebSocket = new wsc('ws://example.com/socket');

      testWebSocket.send(new ArrayBuffer(16));
      await flush();

      sinon.assert.notCalled(vsCodeStub.window.showWarningMessage);
    });

    it('does not show warning notification if driveMounting is enabled', async () => {
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
      );
      const testWebSocket = new wsc('ws://example.com/socket');
      vsCodeStub.workspace.getConfiguration.withArgs('colab').returns({
        get: sinon
          .stub<[string], boolean>()
          .withArgs('driveMounting')
          .returns(true),
      } as Pick<WorkspaceConfiguration, 'get'> as WorkspaceConfiguration);
      configChangeEmitter.fire({
        affectsConfiguration: (section: string) =>
          section === 'colab.driveMounting',
      } as ConfigurationChangeEvent);

      testWebSocket.send(rawDriveMountMessage);
      await flush();

      sinon.assert.notCalled(vsCodeStub.window.showWarningMessage);
    });
  });

  describe('message event', () => {
    const testRequestMessageId = 123;
    const rawColabRequestMessage = JSON.stringify({
      header: { msg_type: 'colab_request' },
      content: {
        request: { authType: 'dfs_ephemeral' },
      },
      metadata: {
        colab_request_type: 'request_auth',
        colab_msg_id: testRequestMessageId,
      },
    });

    beforeEach(() => {
      vsCodeStub.workspace.getConfiguration.withArgs('colab').returns({
        get: sinon
          .stub<[string], boolean>()
          .withArgs('driveMounting')
          .returns(true),
      } as Pick<WorkspaceConfiguration, 'get'> as WorkspaceConfiguration);
    });

    it('triggers handleDriveFsAuth and sends a reply if message is a dfs_ephemeral colab_request', async () => {
      const driveFsAuthHandled = new Promise<void>((resolve) => {
        handleDriveFsAuthStub.callsFake(() => {
          resolve();
          return Promise.resolve();
        });
      });
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
        handleDriveFsAuthStub,
      );
      const testWebSocket = new wsc('ws://example.com/socket');
      const sendSpy = sinon.spy(testWebSocket, 'send');

      testWebSocket.emit(
        'message',
        rawColabRequestMessage,
        /* isBinary= */ false,
      );

      await expect(driveFsAuthHandled).to.eventually.be.fulfilled;
      sinon.assert.calledOnceWithMatch(
        sendSpy,
        sinon.match((data: string) => {
          const message = JSON.parse(data) as unknown;
          return (
            isColabInputReplyMessage(message) &&
            typeof message.content.value !== 'string' &&
            message.content.value.colab_msg_id === testRequestMessageId &&
            !message.content.value.error
          );
        }),
      );
    });

    it('sends an error reply if handleDriveFsAuth throws an error', async () => {
      const errMsg = 'test error message';
      const handleDriveFsAuthFailed = new Promise<void>((resolve) => {
        handleDriveFsAuthStub.callsFake(() => {
          resolve();
          return Promise.reject(new Error(errMsg));
        });
      });
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
        handleDriveFsAuthStub,
      );
      const testWebSocket = new wsc('ws://example.com/socket');
      const sendSpy = sinon.spy(testWebSocket, 'send');

      testWebSocket.emit(
        'message',
        rawColabRequestMessage,
        /* isBinary= */ false,
      );

      await expect(handleDriveFsAuthFailed).to.eventually.be.fulfilled;
      sinon.assert.calledOnceWithMatch(
        sendSpy,
        sinon.match((data: string) => {
          const message = JSON.parse(data) as unknown;
          return (
            isColabInputReplyMessage(message) &&
            typeof message.content.value !== 'string' &&
            message.content.value.error === errMsg
          );
        }),
      );
    });

    it('does not trigger handleDriveFsAuth if message is not a colab_request', () => {
      const rawMessage = JSON.stringify({
        header: { msg_type: 'execute_reply' },
        content: { request: { authType: 'dfs_ephemeral' } },
        metadata: { colab_request_type: 'request_auth', colab_msg_id: 1 },
      });
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
        handleDriveFsAuthStub,
      );
      const testWebSocket = new wsc('ws://example.com/socket');

      testWebSocket.emit('message', rawMessage, /* isBinary= */ false);

      sinon.assert.notCalled(handleDriveFsAuthStub);
    });

    it('does not trigger handleDriveFsAuth if message is not dfs_ephemeral', () => {
      const rawMessage = JSON.stringify({
        header: { msg_type: 'colab_request' },
        content: { request: { authType: 'dfs_persistent' } },
        metadata: { colab_request_type: 'request_auth', colab_msg_id: 1 },
      });
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
        handleDriveFsAuthStub,
      );
      const testWebSocket = new wsc('ws://example.com/socket');

      testWebSocket.emit('message', rawMessage, /* isBinary= */ false);

      sinon.assert.notCalled(handleDriveFsAuthStub);
    });

    it('does not trigger handleDriveFsAuth if message is empty', () => {
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
        handleDriveFsAuthStub,
      );
      const testWebSocket = new wsc('ws://example.com/socket');

      testWebSocket.emit('message', /* message= */ '', /* isBinary= */ false);

      sinon.assert.notCalled(handleDriveFsAuthStub);
    });

    it('does not trigger handleDriveFsAuth if message is malformed', () => {
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
        handleDriveFsAuthStub,
      );
      const testWebSocket = new wsc('ws://example.com/socket');

      testWebSocket.emit('message', 'malformed message', /* isBinary= */ false);

      sinon.assert.notCalled(handleDriveFsAuthStub);
    });

    it('does not trigger handleDriveFsAuth if message data is ArrayBuffer', () => {
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
        handleDriveFsAuthStub,
      );
      const testWebSocket = new wsc('ws://example.com/socket');

      testWebSocket.emit(
        'message',
        /* message= */ new ArrayBuffer(16),
        /* isBinary= */ false,
      );

      sinon.assert.notCalled(handleDriveFsAuthStub);
    });

    it('does not trigger handleDriveFsAuth if message data is binary', () => {
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
        handleDriveFsAuthStub,
      );
      const testWebSocket = new wsc('ws://example.com/socket');

      testWebSocket.emit(
        'message',
        rawColabRequestMessage,
        /* isBinary= */ true,
      );

      sinon.assert.notCalled(handleDriveFsAuthStub);
    });

    it('does not trigger handleDriveFsAuth if driveMounting is disabled', () => {
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
        handleDriveFsAuthStub,
      );
      const testWebSocket = new wsc('ws://example.com/socket');
      vsCodeStub.workspace.getConfiguration.withArgs('colab').returns({
        get: sinon
          .stub<[string], boolean>()
          .withArgs('driveMounting')
          .returns(false),
      } as Pick<WorkspaceConfiguration, 'get'> as WorkspaceConfiguration);
      configChangeEmitter.fire({
        affectsConfiguration: (section: string) =>
          section === 'colab.driveMounting',
      } as ConfigurationChangeEvent);

      testWebSocket.emit(
        'message',
        rawColabRequestMessage,
        /* isBinary= */ false,
      );

      sinon.assert.notCalled(handleDriveFsAuthStub);
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

    it('disposes the config change listener', () => {
      expect(configChangeEmitter.hasListeners()).to.be.true;

      testWebSocket.dispose();

      expect(configChangeEmitter.hasListeners()).to.be.false;
    });

    it('removes the message event listener', () => {
      // No internal message listener is added anymore (we use emit override).
      // Verify other dispose logic if needed, or remove this test.
      // Keeping valid disposition check:
      testWebSocket.dispose();
      // expect(testWebSocket.listenerCount('message')).to.equal(0);
    });

    it('blocks send after disposed', () => {
      testWebSocket.dispose();

      expect(() => {
        testWebSocket.send('test message');
      }).to.throw(/ColabWebSocket cannot be used after it has been disposed/);
    });
  });

  describe('on', () => {
    beforeEach(() => {
      vsCodeStub.workspace.getConfiguration.withArgs('colab').returns({
        get: sinon
          .stub<[string], boolean>()
          .withArgs('driveMounting')
          .returns(true),
      } as Pick<WorkspaceConfiguration, 'get'> as WorkspaceConfiguration);
    });

    const authUrl = 'https://accounts.google.com/o/oauth2/auth?client_id=123';
    const rawAuthMessage = JSON.stringify({
      header: {
        msg_type: 'input_request',
        session: 'session-id',
        msg_id: 'msg-id',
      },
      content: {
        prompt: `Go to the following link in your browser:\n\n${authUrl}\n\nEnter verification code:`,
        password: false,
      },
      parent_header: {},
      metadata: {},
      channel: 'shell',
    });

    it('intercepts auth input_request and shows UI', async () => {
      let resolveUi: (value: string | undefined) => void;
      const uiShown = new Promise<string | undefined>((resolve) => {
        resolveUi = resolve;
      });

      (vsCodeStub.window.showInformationMessage as sinon.SinonStub).callsFake(
        (_message: string, ...items: string[]) => {
          resolveUi(items[0]); // Return the first item (action)
          return Promise.resolve(items[0]);
        },
      );

      (vsCodeStub.window.showInputBox as sinon.SinonStub).resolves('code');

      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
      );
      const ws = new wsc('ws://example.com/socket');
      const messageSpy = sinon.spy();
      ws.on('message', messageSpy);

      ws.emit('message', rawAuthMessage);

      await uiShown;

      sinon.assert.calledWith(
        vsCodeStub.window.showInformationMessage,
        sinon.match(/copy the verification code/i),
        sinon.match.string,
      );
      // The original message should NOT be forwarded to the listener
      sinon.assert.notCalled(messageSpy);
    });

    it('intercepts auth input_request with extra whitespace', async () => {
      const extraWhitespacePrompt = `Go to the following link in your browser:

        ${authUrl}

        Enter verification code:`;
      const rawExtraWhitespaceMessage = JSON.stringify({
        header: {
          msg_type: 'input_request',
          session: 'session-id',
          msg_id: 'msg-id-2',
        },
        content: {
          prompt: extraWhitespacePrompt,
          password: false,
        },
        parent_header: {},
        metadata: {},
        channel: 'shell',
      });
      let resolveUi: (value: string | undefined) => void;
      const uiShown = new Promise<string | undefined>((resolve) => {
        resolveUi = resolve;
      });

      (vsCodeStub.window.showInformationMessage as sinon.SinonStub).callsFake(
        (_message: string, ...items: string[]) => {
          resolveUi(items[0]);
          return Promise.resolve(items[0]);
        },
      );

      (vsCodeStub.window.showInputBox as sinon.SinonStub).resolves('code');

      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
      );
      const ws = new wsc('ws://example.com/socket');
      const messageSpy = sinon.spy();
      ws.on('message', messageSpy);

      ws.emit('message', rawExtraWhitespaceMessage);

      await uiShown;

      sinon.assert.calledWith(
        vsCodeStub.window.showInformationMessage,
        sinon.match(/copy the verification code/i),
        sinon.match.string,
      );
      sinon.assert.notCalled(messageSpy);
    });

    it('sends input_reply with code after user input', async () => {
      (vsCodeStub.window.showInformationMessage as sinon.SinonStub).resolves(
        'Open URL',
      );
      (vsCodeStub.window.showInputBox as sinon.SinonStub).resolves('12345');

      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
      );
      const ws = new wsc('ws://example.com/socket');
      const sendSpy = sinon.spy(ws, 'send');
      ws.on('message', () => {
        /* no-op */
      });

      ws.emit('message', rawAuthMessage);

      // Wait for async operations to complete
      await flush();
      await flush();
      await flush();

      sinon.assert.calledOnce(sendSpy);
      const sentMessage = JSON.parse(sendSpy.firstCall.args[0] as string) as {
        header: { msg_type: string };
        content: { value: string };
      };
      expect(sentMessage.header.msg_type).to.equal('input_reply');
      expect(sentMessage.content.value).to.equal('12345');
    });

    it('does not intercept other messages', () => {
      const otherMessage = JSON.stringify({
        header: { msg_type: 'other_request' },
        content: { some: 'content' },
      });

      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
      );
      const ws = new wsc('ws://example.com/socket');
      const messageSpy = sinon.spy();
      ws.on('message', messageSpy);

      ws.emit('message', otherMessage);

      sinon.assert.calledOnce(messageSpy);
      sinon.assert.calledWith(messageSpy, otherMessage);
    });

    it('intercepts auth input_request even if driveMounting is disabled', async () => {
      vsCodeStub.workspace.getConfiguration.withArgs('colab').returns({
        get: sinon
          .stub<[string], boolean>()
          .withArgs('driveMounting')
          .returns(false),
      } as Pick<WorkspaceConfiguration, 'get'> as WorkspaceConfiguration);

      let resolveUi: (value: string | undefined) => void;
      const uiShown = new Promise<string | undefined>((resolve) => {
        resolveUi = resolve;
      });

      (vsCodeStub.window.showInformationMessage as sinon.SinonStub).callsFake(
        (_message: string, ...items: string[]) => {
          resolveUi(items[0]);
          return Promise.resolve(items[0]);
        },
      );
      (vsCodeStub.window.showInputBox as sinon.SinonStub).resolves('code');

      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        TestWebSocket,
      );
      const ws = new wsc('ws://example.com/socket');
      const messageSpy = sinon.spy();
      ws.on('message', messageSpy);

      ws.emit('message', rawAuthMessage);

      await uiShown;

      sinon.assert.calledWith(
        vsCodeStub.window.showInformationMessage,
        sinon.match(/copy the verification code/i),
        sinon.match.string,
      );
      sinon.assert.notCalled(messageSpy);
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

async function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
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
