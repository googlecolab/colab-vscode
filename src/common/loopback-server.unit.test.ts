import http from "http";
import { AddressInfo } from "net";
import { assert, expect } from "chai";
import * as sinon from "sinon";
import { createHttpServerMock } from "../test/helpers/http-server";
import { LoopbackHandler, LoopbackServer } from "./loopback-server";

const DEFAULT_ADDRESS: AddressInfo = {
  address: "127.0.0.1",
  family: "IPv4",
  port: 12345,
};

describe("LoopbackServer", () => {
  let handler: sinon.SinonStubbedInstance<LoopbackHandler>;
  let server: LoopbackServer;
  let fakeServer: sinon.SinonStubbedInstance<http.Server>;

  beforeEach(() => {
    handler = {
      handleRequest: sinon.stub(),
      handleError: sinon.stub(),
      handleClose: sinon.stub(),
    };
    fakeServer = createHttpServerMock(DEFAULT_ADDRESS);
    sinon.stub(http, "createServer").returns(fakeServer);

    server = new LoopbackServer(handler);
  });

  afterEach(() => {
    sinon.restore();
    server.dispose();
  });

  describe("dispose", () => {
    it("does nothing when no server is running", () => {
      // Required since `listening` is a readonly getter.
      Object.defineProperty(fakeServer, "listening", { get: () => false });
      server.dispose();

      sinon.assert.notCalled(fakeServer.close);
    });

    describe("when a server is listening", () => {
      beforeEach(async () => {
        await server.start();
      });

      it("closes the server", () => {
        server.dispose();

        sinon.assert.calledOnce(fakeServer.close);
      });

      it("does nothing if called more than once", () => {
        server.dispose();
        server.dispose();

        sinon.assert.calledOnce(fakeServer.close);
      });
    });
  });

  describe("start", () => {
    it("rejects when a port cannot be obtained", async () => {
      fakeServer.address.returns(null);

      await expect(server.start()).to.be.rejectedWith(
        "Failed to acquire server port",
      );
    });

    it("rejects if a proxied address' port cannot be parsed", async () => {
      fakeServer.address.returns("not-a-port");

      await expect(server.start()).to.be.rejectedWith(
        "Failed to acquire server port",
      );
    });

    it("resolves a port number when started successfully", async () => {
      await expect(server.start()).to.eventually.equal(DEFAULT_ADDRESS.port);
    });

    it("resolves the existing promise if start is called more than once", async () => {
      const firstStart = server.start();
      const secondStart = server.start();

      await expect(firstStart).to.eventually.equal(DEFAULT_ADDRESS.port);
      await expect(secondStart).to.eventually.equal(DEFAULT_ADDRESS.port);

      // Verifies that the underlying server listen was not called a second
      // time.
      sinon.assert.calledOnce(fakeServer.listen);
    });
  });

  describe("server started", () => {
    beforeEach(async () => {
      await server.start();
    });

    it("invokes the handler for incoming requests", () => {
      const req = {} as http.IncomingMessage;
      const res = {} as http.ServerResponse;

      fakeServer.emit("request", req, res);

      sinon.assert.calledOnceWithExactly(handler.handleRequest, req, res);
    });

    it("invokes the handler on error", () => {
      const err = new Error("test error");

      fakeServer.emit("error", err);

      assert.isDefined(handler.handleError);
      sinon.assert.calledOnceWithExactly(handler.handleError, err);
    });

    it("invokes the handler on close", () => {
      fakeServer.emit("close");

      assert.isDefined(handler.handleClose);
      sinon.assert.calledOnce(handler.handleClose);
    });
  });
});
