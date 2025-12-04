/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "crypto";
import { Duplex, EventEmitter } from "stream";
import { assert, expect } from "chai";
import * as sinon from "sinon";
import { TextDocument } from "vscode";
import {
  vsdiag,
  type LanguageClient,
  type LanguageClientOptions,
} from "vscode-languageclient/node";
import { WebSocket } from "ws";
import { Variant } from "../colab/api";
import {
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
} from "../colab/headers";
import { LogLevel } from "../common/logging";
import { ColabAssignedServer } from "../jupyter/servers";
import { TestCancellationToken } from "../test/helpers/cancellation";
import { ColabLogWatcher } from "../test/helpers/logging";
import { TestUri } from "../test/helpers/uri";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { ContentLengthTransformer } from "./content-length-transformer";
import { ColabLanguageClient, LanguageClientFactory } from "./language-client";

const DEFAULT_SERVER: ColabAssignedServer = {
  id: randomUUID(),
  label: "Colab GPU A100",
  variant: Variant.GPU,
  accelerator: "A100",
  endpoint: "m-s-foo",
  connectionInformation: {
    baseUrl: TestUri.parse("https://example.com"),
    token: "123",
    tokenExpiry: new Date(Date.now() + 1000 * 60 * 60),
    headers: {
      [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]: "123",
      [COLAB_CLIENT_AGENT_HEADER.key]: COLAB_CLIENT_AGENT_HEADER.value,
    },
  },
  dateAssigned: new Date(),
};

type LanguageClientStub = sinon.SinonStubbedInstance<LanguageClient>;

function newLanguageClientStub(): LanguageClientStub {
  return {
    needsStart: sinon.stub<[], boolean>(),
    start: sinon.stub<[], Promise<void>>(),
    dispose: sinon.stub<[], Promise<void>>(),
  } as unknown as LanguageClientStub;
}

type WebSocketStub = sinon.SinonStubbedInstance<WebSocket>;

function newWebSocketStub(): WebSocketStub {
  const partial = new EventEmitter() as Partial<WebSocket>;
  partial.binaryType = "arraybuffer";
  return partial as WebSocketStub;
}

type DuplexStub = sinon.SinonStubbedInstance<Duplex>;

function newDuplexStub(): DuplexStub {
  const stub = sinon.createStubInstance(Duplex);
  stub.pipe.returns(stub);

  return stub;
}

describe("ColabLanguageClient", () => {
  let vs: VsCodeStub;
  let logs: ColabLogWatcher;
  let lsClient: LanguageClientStub;
  let socket: WebSocketStub;
  let stream: DuplexStub;
  let client: ColabLanguageClient;
  let factory: sinon.SinonStub<
    Parameters<LanguageClientFactory>,
    ReturnType<LanguageClientFactory>
  >;
  let createSocket: sinon.SinonStub<[string], WebSocket>;

  beforeEach(() => {
    vs = newVsCodeStub();
    logs = new ColabLogWatcher(vs, LogLevel.Error);
    lsClient = newLanguageClientStub();
    socket = newWebSocketStub();
    stream = newDuplexStub();

    factory = sinon.stub();
    factory.returns(lsClient);

    createSocket = sinon.stub<[string], WebSocket>().returns(socket);

    client = new ColabLanguageClient(
      vs.asVsCode(),
      DEFAULT_SERVER,
      factory,
      createSocket,
      () => stream,
    );
  });

  afterEach(async () => {
    await client.dispose();
    logs.dispose();
    sinon.restore();
  });

  describe("lifecycle", () => {
    it("throws when started after being disposed", async () => {
      await client.dispose();

      try {
        await client.start();
        expect.fail("Should have thrown");
      } catch (e) {
        expect((e as Error).message).to.equal(
          "Cannot start after being disposed",
        );
      }
    });

    it("disposes the supporting language client", async () => {
      await client.dispose();

      expect(lsClient.dispose.callCount).to.equal(1);
    });

    it("no-ops on repeat dispose calls", async () => {
      await client.dispose();
      await client.dispose();

      expect(lsClient.dispose.callCount).to.equal(1);
    });
  });

  describe("configuration", () => {
    let clientOptions: LanguageClientOptions;

    beforeEach(() => {
      expect(factory.callCount).to.equal(1);
      const call = factory.getCall(0);
      clientOptions = call.args[3];
    });

    it("initializes the client with correct arguments", () => {
      const call = factory.getCall(0);
      const [id, name, serverOptions] = call.args;
      expect(id).to.equal("colabLanguageServer");
      expect(name).to.equal("Colab Language Server");
      expect(serverOptions).to.be.a("function");
    });

    it("includes the expected document selector", () => {
      expect(clientOptions.documentSelector).to.deep.equal([
        {
          scheme: "vscode-notebook-cell",
          language: "python",
        },
      ]);
    });

    it("binds the diagnostics middleware", async () => {
      const middleware = clientOptions.middleware;
      assert(middleware, "middleware is undefined");

      const provideDiagnostics = middleware.provideDiagnostics;
      assert(provideDiagnostics, "provideDiagnostics is undefined");

      const docUri = TestUri.parse("file:///test.ipynb");
      const doc = {
        uri: docUri,
        getText: sinon.stub().returns("!"),
      };
      vs.workspace.textDocuments = [
        doc as Pick<TextDocument, "uri" | "getText"> as TextDocument,
      ];
      const token = new TestCancellationToken(new vs.EventEmitter<void>());
      const next = sinon.stub().resolves({
        kind: "full",
        items: [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
            message: "bash command",
          },
        ],
      });

      const result = await provideDiagnostics(docUri, undefined, token, next);

      assert(
        result?.kind.toString() === "full",
        "Expected full diagnostic report",
      );
      expect((result as vsdiag.FullDocumentDiagnosticReport).items).to.be.empty;
      expect(doc.getText.called).to.be.true;
    });
  });

  describe("connection", () => {
    it("connects to the correct URL", async () => {
      lsClient.needsStart.returns(true);
      await client.start();

      const call = factory.getCall(0);
      const serverOptions = call.args[2];
      const promise = (serverOptions as () => Promise<unknown>)();

      expect(createSocket.calledOnce).to.be.true;
      const urlString = createSocket.firstCall.args[0];
      const url = new URL(urlString);

      expect(url.protocol).to.equal("wss:");
      expect(url.hostname).to.equal("example.com");
      expect(url.pathname).to.equal("/colab/lsp");
      expect(url.searchParams.get("colab-runtime-proxy-token")).to.equal("123");

      assert(socket.onopen);
      socket.onopen({ type: "open", target: socket });
      await promise;
    });

    it("rejects if socket closes before opening", async () => {
      lsClient.needsStart.returns(true);
      await client.start();

      const call = factory.getCall(0);
      const serverOptions = call.args[2];
      const promise = (serverOptions as () => Promise<unknown>)();

      if (!socket.onclose) {
        expect.fail("onclose was not assigned");
      }
      socket.onclose({
        code: 1006, // Abnormal closure
        reason: "connection refused",
        wasClean: false,
        type: "close",
        target: socket,
      });

      await expect(promise).to.be.rejectedWith(
        "Language server socket closed unexpectedly",
      );
    });
  });

  describe("when started", () => {
    beforeEach(async () => {
      lsClient.needsStart.returns(true);
      await client.start();
      const call = factory.getCall(0);
      const serverOptions = call.args[2];
      const promise = (serverOptions as () => Promise<unknown>)();
      assert(socket.onopen);
      socket.onopen({ type: "open", target: socket });
      await promise;
    });

    it("pipes the stream with the content-length header", () => {
      expect(stream.pipe.callCount).to.equal(1);
      const arg = stream.pipe.getCall(0).args[0];
      expect(arg).to.be.instanceOf(ContentLengthTransformer);
    });

    it("logs piped stream errors", () => {
      const streamCall = stream.on
        .getCalls()
        .find((c) => c.args[0] === "error");
      assert(streamCall, "no error listener registered");
      const listener = streamCall.args[1];

      listener(new Error("stream error"));

      const output = logs.output;
      expect(output).to.match(/stream/);
    });

    it("logs socket errors", () => {
      if (!socket.onerror) {
        expect.fail("onerror was not assigned");
      }
      socket.onerror({
        error: new Error("socket error"),
        message: "socket error",
        type: "error",
        target: socket,
      });
      const output = logs.output;
      expect(output).to.match(/socket/);
    });
  });
});
