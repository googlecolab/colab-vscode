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

describe('colabProxyWebSocket', () => {
  const testToken = 'test-token';
  let vsCodeStub: VsCodeStub;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
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
});
