/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import EventEmitter from "events";
import http from "http";
import { AddressInfo } from "net";
import * as sinon from "sinon";

/**
 * Creates a stubbed instance of an {@link http.Server} which can trigger events
 * directly.
 *
 * The server is "listening" to requests and will invoke the callback passed to
 * `listen` when called.
 *
 * @param address - The address of the fake server.
 * @returns A stubbed instance of an {@link http.Server}. Since the
 * {@link http.Server} is an {@link EventEmitter}, tests using this fake server
 * can trigger events directly. E.g.:
 *
 * - `fakeServer.emit("request", req, res);`
 * - `fakeServer.emit("error", err);`
 * - `fakeServer.emit("close");`
 */
export function createHttpServerMock(
  address: AddressInfo | string | null,
): sinon.SinonStubbedInstance<http.Server> {
  const fakeServer = sinon.createStubInstance(http.Server);
  const eventEmitter = new EventEmitter();
  fakeServer.on.callsFake(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (eventName: string | symbol, listener: (...args: any[]) => void) => {
      eventEmitter.on(eventName, listener);
      return fakeServer;
    },
  );
  fakeServer.emit.callsFake(eventEmitter.emit.bind(eventEmitter));
  fakeServer.address.returns(address);
  fakeServer.listen.yields();
  // Required since `listening` is a readonly getter.
  Object.defineProperty(fakeServer, "listening", {
    get: () => true,
    // Make it configurable so we can override it in tests.
    configurable: true,
  });

  return fakeServer;
}
