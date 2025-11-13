/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "crypto";
import { Duplex, EventEmitter } from "stream";
import { assert, expect } from "chai";
import * as sinon from "sinon";
import type {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";
import { WebSocket } from "ws";
import { Variant } from "../colab/api";
import {
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
} from "../colab/headers";
import { LogLevel } from "../common/logging";
import { ColabAssignedServer } from "../jupyter/servers";
import { ColabLogWatcher } from "../test/helpers/logging";
import { TestUri } from "../test/helpers/uri";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { ContentLengthTransformer } from "./content-length-transformer";
import { ColabLanguageClient } from "./language-client";

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

  beforeEach(() => {
    vs = newVsCodeStub();
  });

  describe("lifecycle", () => {
    it("creates a Colab language server", async () => {
      const factory = sinon
        .stub<
          [string, string, ServerOptions, LanguageClientOptions],
          LanguageClient
        >()
        .returns(newLanguageClientStub());
      const socket = newWebSocketStub();

      const client = new ColabLanguageClient(
        vs.asVsCode(),
        DEFAULT_SERVER,
        factory,
        () => socket,
      );

      expect(factory.callCount).to.equal(1);
      const call = factory.getCall(0);
      const [id, name, serverOptions, clientOptions] = call.args;
      expect(id).to.equal("colabLanguageServer");
      expect(name).to.equal("Colab Language Server");
      expect(serverOptions).to.be.a("function");
      expect(clientOptions).to.not.be.undefined;
      expect(clientOptions.documentSelector).to.deep.equal([
        {
          scheme: "vscode-notebook-cell",
          language: "python",
        },
      ]);
      await client.dispose();
    });

    it("throws when started after being disposed", async () => {
      const factory = sinon
        .stub<
          [string, string, ServerOptions, LanguageClientOptions],
          LanguageClient
        >()
        .returns(newLanguageClientStub());
      const socket = newWebSocketStub();

      const client = new ColabLanguageClient(
        vs.asVsCode(),
        DEFAULT_SERVER,
        factory,
        () => socket,
      );
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
      const lsClient = newLanguageClientStub();
      const factory = sinon
        .stub<
          [string, string, ServerOptions, LanguageClientOptions],
          LanguageClient
        >()
        .returns(lsClient);
      const socket = newWebSocketStub();

      const client = new ColabLanguageClient(
        vs.asVsCode(),
        DEFAULT_SERVER,
        factory,
        () => socket,
      );
      await client.dispose();

      expect(lsClient.dispose.callCount).to.equal(1);
    });

    it("no-ops on repeat dispose calls", async () => {
      const lsClient = newLanguageClientStub();
      const factory = sinon
        .stub<
          [string, string, ServerOptions, LanguageClientOptions],
          LanguageClient
        >()
        .returns(lsClient);
      const socket = newWebSocketStub();

      const client = new ColabLanguageClient(
        vs.asVsCode(),
        DEFAULT_SERVER,
        factory,
        () => socket,
      );
      await client.dispose();
      await client.dispose();

      expect(lsClient.dispose.callCount).to.equal(1);
    });
  });

  describe("when started", () => {
    let logs: ColabLogWatcher;
    let lsClient: LanguageClientStub;
    let socket: WebSocketStub;
    let stream: DuplexStub;
    let client: ColabLanguageClient;

    beforeEach(async () => {
      logs = new ColabLogWatcher(vs, LogLevel.Error);
      lsClient = newLanguageClientStub();
      socket = newWebSocketStub();
      stream = newDuplexStub();

      const factory = sinon
        .stub<
          [string, string, ServerOptions, LanguageClientOptions],
          LanguageClient
        >()
        .returns(lsClient);

      client = new ColabLanguageClient(
        vs.asVsCode(),
        DEFAULT_SERVER,
        factory,
        () => socket,
        () => stream,
      );

      lsClient.needsStart.returns(true);
      await client.start();

      const call = factory.getCall(0);
      const serverOptions = call.args[2];
      const promise = (serverOptions as () => Promise<unknown>)();
      if (socket.onopen) {
        socket.onopen({ type: "open", target: socket });
      }
      await promise;
    });

    afterEach(async () => {
      await client.dispose();
      logs.dispose();
    });

    it("pipes the stream with the content-length header", () => {
      expect(stream.pipe.callCount).to.equal(1);
      const arg = stream.pipe.getCall(0).args[0];
      expect(arg).to.be.instanceOf(ContentLengthTransformer);
    });

    it("logs piped stream errors", () => {
      const call = stream.on.getCalls().find((c) => c.args[0] === "error");
      assert(call, "no error listener registered");
      const listener = call.args[1];

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
