/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ClientRequestArgs } from 'http';
import { expect } from 'chai';
import sinon from 'sinon';
import { Uri } from 'vscode';
import WebSocket from 'ws';
import { newVsCodeStub, VsCodeStub } from '../test/helpers/vscode';
import { colabProxyWebSocket } from './colab-proxy-web-socket';

describe('colabProxyWebSocket', () => {
  const testToken = 'test-token';
  let vsCodeStub: VsCodeStub;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
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
          testToken,
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
        testToken,
        TestWebSocket,
      );
      const testWebSocket = new wsc('ws://example.com/socket');

      testWebSocket.send(rawDriveMountMessage, {});

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
        testToken,
        TestWebSocket,
      );
      const testWebSocket = new wsc('ws://example.com/socket');

      testWebSocket.send(rawDriveMountMessage, {});

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
        testToken,
        TestWebSocket,
      );
      const testWebSocket = new wsc('ws://example.com/socket');

      testWebSocket.send(rawDriveMountMessage, {});

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
        testToken,
        TestWebSocket,
      );
      const testWebSocket = new wsc('ws://example.com/socket');

      testWebSocket.send(rawJupyterMessage, {});
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
        testToken,
        TestWebSocket,
      );
      const testWebSocket = new wsc('ws://example.com/socket');

      testWebSocket.send(rawJupyterMessage, {});
      await flush();

      sinon.assert.notCalled(vsCodeStub.window.showWarningMessage);
    });

    it('does not show warning notification if message is empty', async () => {
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        testToken,
        TestWebSocket,
      );
      const testWebSocket = new wsc('ws://example.com/socket');

      testWebSocket.send('', {});
      await flush();

      sinon.assert.notCalled(vsCodeStub.window.showWarningMessage);
    });

    it('does not show warning notification if message is not Jupyter message format', async () => {
      const rawNonJupyterMessage = JSON.stringify({
        random_field: 'random_value',
      });
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        testToken,
        TestWebSocket,
      );
      const testWebSocket = new wsc('ws://example.com/socket');

      testWebSocket.send(rawNonJupyterMessage, {});
      await flush();

      sinon.assert.notCalled(vsCodeStub.window.showWarningMessage);
    });

    it('does not show warning notification if message is malformed', async () => {
      const malformedMessage = 'non-json-format';
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        testToken,
        TestWebSocket,
      );
      const testWebSocket = new wsc('ws://example.com/socket');

      testWebSocket.send(malformedMessage, {});
      await flush();

      sinon.assert.notCalled(vsCodeStub.window.showWarningMessage);
    });

    it('does not show warning notification if data is ArrayBuffer', async () => {
      const wsc = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        testToken,
        TestWebSocket,
      );
      const testWebSocket = new wsc('ws://example.com/socket');

      testWebSocket.send(new ArrayBuffer(16), {});
      await flush();

      sinon.assert.notCalled(vsCodeStub.window.showWarningMessage);
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
      'X-Colab-Runtime-Proxy-Token': testToken,
      'X-Colab-Client-Agent': 'vscode',
    });
  }
});

async function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
