/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ClientRequestArgs } from 'http';
import { expect } from 'chai';
import WebSocket from 'ws';
import { newVsCodeStub, VsCodeStub } from '../test/helpers/vscode';
import { colabProxyWebSocket } from './colab-proxy-web-socket';
import { resetConfiguredSessions } from './plotly-config';

describe('colabProxyWebSocket', () => {
  const testToken = 'test-token';
  let vsCodeStub: VsCodeStub;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    resetConfiguredSessions();
  });

  afterEach(() => {
    resetConfiguredSessions();
  });

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
  }

  function verifyColabHeadersPresent(
    options?: WebSocket.ClientOptions | ClientRequestArgs,
  ) {
    expect(options?.headers).to.deep.equal({
      'X-Colab-Runtime-Proxy-Token': testToken,
      'X-Colab-Client-Agent': 'vscode',
    });
  }

  /**
   * Type for parsed Jupyter kernel messages in tests.
   */
  interface ParsedMessage {
    header: {
      msg_type: string;
      session?: string;
    };
    content?: {
      code?: string;
    };
  }

  describe('Plotly config injection', () => {
    it('injects Plotly config on first execute_request', () => {
      const sentData: string[] = [];
      class MockWebSocket extends WebSocket {
        constructor(_address: string | URL | null) {
          super(null);
        }
        override send(data: string) {
          sentData.push(data);
        }
      }

      const ColabWebSocket = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        testToken,
        MockWebSocket,
      );
      const ws = new ColabWebSocket('ws://example.com/socket');

      const executeRequest = JSON.stringify({
        header: { msg_type: 'execute_request', session: 'test-session' },
        content: { code: 'print("hello")' },
      });

      ws.send(executeRequest, {});

      expect(sentData.length).to.equal(1);
      const parsed = JSON.parse(sentData[0]) as ParsedMessage;
      expect(parsed.content?.code).to.include('plotly.io');
      expect(parsed.content?.code).to.include('print("hello")');
    });

    it('does not inject Plotly config on subsequent requests for same session', () => {
      const sentData: string[] = [];
      class MockWebSocket extends WebSocket {
        constructor(_address: string | URL | null) {
          super(null);
        }
        override send(data: string) {
          sentData.push(data);
        }
      }

      const ColabWebSocket = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        testToken,
        MockWebSocket,
      );
      const ws = new ColabWebSocket('ws://example.com/socket');

      const executeRequest1 = JSON.stringify({
        header: { msg_type: 'execute_request', session: 'test-session-2' },
        content: { code: 'x = 1' },
      });
      const executeRequest2 = JSON.stringify({
        header: { msg_type: 'execute_request', session: 'test-session-2' },
        content: { code: 'y = 2' },
      });

      ws.send(executeRequest1, {});
      ws.send(executeRequest2, {});

      expect(sentData.length).to.equal(2);
      // First request should have Plotly config
      expect(
        (JSON.parse(sentData[0]) as ParsedMessage).content?.code,
      ).to.include('plotly.io');
      // Second request should NOT have Plotly config
      expect((JSON.parse(sentData[1]) as ParsedMessage).content?.code).to.equal(
        'y = 2',
      );
    });

    it('does not modify non-execute_request messages', () => {
      const sentData: string[] = [];
      class MockWebSocket extends WebSocket {
        constructor(_address: string | URL | null) {
          super(null);
        }
        override send(data: string) {
          sentData.push(data);
        }
      }

      const ColabWebSocket = colabProxyWebSocket(
        vsCodeStub.asVsCode(),
        testToken,
        MockWebSocket,
      );
      const ws = new ColabWebSocket('ws://example.com/socket');

      const kernelInfoRequest = JSON.stringify({
        header: { msg_type: 'kernel_info_request', session: 'test-session-3' },
      });

      ws.send(kernelInfoRequest, {});

      expect(sentData.length).to.equal(1);
      expect(sentData[0]).to.equal(kernelInfoRequest);
    });
  });
});
