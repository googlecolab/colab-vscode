import EventEmitter from "events";
import http from "http";
import { AddressInfo } from "net";
import * as sinon from "sinon";

/**
 * Installs a stub on {@link http.createServer} to return a fake server which
 * can be invoked directly in tests.
 *
 * @param address - The address of the fake server.
 * @param isListening - Whether the server should be started and "listen" to
 * requests.
 * @returns A stubbed instance of an {@link http.Server}. Since the
 * {@link http.Server} is an {@link EventEmitter}, tests using this fake server
 * can trigger events directly. E.g.:
 *
 * - `fakeServer.emit("request", req, res);`
 * - `fakeServer.emit("error", err);`
 * - `fakeServer.emit("close");`
 */
export function installHttpServerStub(
  address: AddressInfo | string | null,
  isListening = true,
): sinon.SinonStubbedInstance<http.Server> {
  const fakeServer = sinon.createStubInstance(http.Server);
  sinon.stub(http, "createServer").returns(fakeServer);
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
  if (isListening) fakeServer.listen.yields();

  return fakeServer;
}
