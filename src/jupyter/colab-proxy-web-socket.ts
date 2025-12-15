/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import WebSocketIsomorphic from 'isomorphic-ws';
import vscode from 'vscode';
import {
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
} from '../colab/headers';
import { warnOnDriveMount } from './drive-mount-warning';

/**
 * Returns a `WebSocket` class which extends `WebSocketIsomorphic`, adds Colab's
 * custom headers, and intercepts `WebSocket.send` to warn users when on
 * `drive.mount` execution.
 */
export function colabProxyWebSocket(
  vs: typeof vscode,
  token: string,
  BaseWebSocket: typeof WebSocketIsomorphic = WebSocketIsomorphic,
) {
  // These custom headers are required for Colab's proxy WebSocket to work.
  const colabHeaders: Record<string, string> = {};
  colabHeaders[COLAB_RUNTIME_PROXY_TOKEN_HEADER.key] = token;
  colabHeaders[COLAB_CLIENT_AGENT_HEADER.key] = COLAB_CLIENT_AGENT_HEADER.value;

  const addColabHeaders = (
    options?: WebSocketIsomorphic.ClientOptions,
  ): WebSocketIsomorphic.ClientOptions => {
    options ??= {};
    options.headers ??= {};
    const headers: Record<string, string> = {
      ...options.headers,
      ...colabHeaders,
    };
    return { ...options, headers };
  };

  return class ColabWebSocket extends BaseWebSocket {
    constructor(
      address: string | URL,
      protocols?: string | string[] | WebSocketIsomorphic.ClientOptions,
      options?: WebSocketIsomorphic.ClientOptions,
    ) {
      if (typeof protocols === 'object' && !Array.isArray(protocols)) {
        super(address, addColabHeaders(protocols));
      } else {
        super(address, protocols, addColabHeaders(options));
      }
    }

    override send(
      data: string,
      options:
        | {
            mask?: boolean;
            binary?: boolean;
            compress?: boolean;
            fin?: boolean;
          }
        | ((err?: Error) => void)
        | undefined,
      cb?: (err?: Error) => void,
    ) {
      warnOnDriveMount(vs, data);

      if (options === undefined || typeof options === 'function') {
        cb = options;
        options = {};
      }
      super.send(data, options, cb);
    }
  };
}
