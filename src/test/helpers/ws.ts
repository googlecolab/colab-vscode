/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import WebSocket from 'ws';

/**
 * The `ws` WebSocket class, typed to allow constructing an unconnected socket
 * for test fakes: `super(null, undefined, {})`.
 *
 * `@types/ws` only declares `new WebSocket(null)`, but ws 8+ reads the
 * options argument even then, so `super(null)` throws.
 */
export const UnconnectedWebSocket: typeof WebSocket &
  (new (
    address: null,
    protocols: undefined,
    options: WebSocket.ClientOptions,
  ) => WebSocket) = WebSocket;
