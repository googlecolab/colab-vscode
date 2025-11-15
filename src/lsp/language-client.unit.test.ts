/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "crypto";
import { expect } from "chai";
import sinon, { SinonStubbedInstance } from "sinon";
import type {
  LanguageClientOptions,
  LanguageClient,
  MessageTransports,
  ServerOptions,
} from "vscode-languageclient/node";
import { WebSocket, AddressInfo, WebSocketServer } from "ws";
import { Variant } from "../colab/api";
import {
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
} from "../colab/headers";
import {
  AssignmentChangeEvent,
  AssignmentManager,
} from "../jupyter/assignments";
import { ColabAssignedServer } from "../jupyter/servers";
import { TestUri } from "../test/helpers/uri";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { LanguageClientController } from "./language-client";

class TestLanguageClient
  implements Pick<LanguageClient, "needsStart" | "start" | "dispose">
{
  private connection: Promise<MessageTransports>;
  private sendPingHandle: NodeJS.Timeout;

  constructor(
    _id: string,
    _name: string,
    private readonly serverOptions: ServerOptions,
    _clientOptions: LanguageClientOptions,
  ) {}

  needsStart(): boolean {
    return true;
  }

  async ping() {
    // The interface calls for passing an object, but the
    // test implementation expects a stringified object.
    (
      (await this.connection).writer as unknown as {
        write: (s: string) => void;
      }
    ).write(JSON.stringify({ jsonrpc: "{}" }));
  }

  start(): Promise<void> {
    this.connection = (
      this.serverOptions as () => Promise<MessageTransports>
    )();
    // Periodically send empty ping messages so that tests
    // can verify that the connection is live.
    this.sendPingHandle = setInterval(() => {
      try {
        void this.ping();
      } catch (e) {
        console.log(e);
      }
    }, 10);
    return Promise.resolve();
  }

  async dispose(): Promise<void> {
    (await this.connection).writer.end();
    clearTimeout(this.sendPingHandle);
  }
}

function newTestLanguageClient(
  id: string,
  name: string,
  serverOptions: ServerOptions,
  clientOptions: LanguageClientOptions,
): LanguageClient {
  return new TestLanguageClient(
    id,
    name,
    serverOptions,
    clientOptions,
  ) as Partial<LanguageClient> as LanguageClient;
}

const REFRESH_MS = 60000;
const emptyFunc = () => {
  // Empty intentionally.
};

describe("LanguageClientController", () => {
  let assignmentStub: SinonStubbedInstance<AssignmentManager>;
  let vsStub: VsCodeStub;
  let server: WebSocketServer;
  let latestServer: ColabAssignedServer;

  beforeEach(async () => {
    assignmentStub = sinon.createStubInstance(AssignmentManager);
    vsStub = newVsCodeStub();
    Object.defineProperty(assignmentStub, "onDidAssignmentsChange", {
      value: sinon.stub(),
    });
    assignmentStub.onDidAssignmentsChange.returns({ dispose: emptyFunc });
    server = new WebSocketServer({ port: 9876, host: "127.0.0.1" });
    // Wait for the server to be listening.
    await new Promise<void>((resolve) =>
      server.on("listening", () => {
        resolve();
      }),
    );
    const addr = server.address() as AddressInfo;
    const baseUrl = TestUri.parse(
      `ws://${addr.address}:${addr.port.toString()}`,
    );
    latestServer = {
      id: randomUUID(),
      label: "Colab GPU A100",
      variant: Variant.GPU,
      accelerator: "A100",
      endpoint: "m-s-foo",
      connectionInformation: {
        baseUrl,
        token: "123",
        tokenExpiry: new Date(Date.now() + REFRESH_MS),
        headers: {
          [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]: "123",
          [COLAB_CLIENT_AGENT_HEADER.key]: COLAB_CLIENT_AGENT_HEADER.value,
        },
      },
      dateAssigned: new Date(),
    };
  });

  afterEach(() => {
    server.close();
  });

  it("sets up a socket to a server", async () => {
    assignmentStub.latestServer.returns(Promise.resolve(latestServer));
    // Promise that resolves when the server receives a websocket connection.
    const connectionPromise = new Promise<WebSocket>((resolve, reject) => {
      server.on("connection", (socket) => {
        resolve(socket);
      });
      // Avoid hanging the test forever.
      setTimeout(() => {
        reject(new Error("Timeout waiting for connection"));
      }, 2000);
    });
    const languageClient = new LanguageClientController(
      vsStub.asVsCode(),
      assignmentStub,
      newTestLanguageClient,
    );
    // Ensure the client is started so it registers its assignment-change
    // handler.
    languageClient.on();
    // Await connection after enabling the client.
    const socket = await connectionPromise;

    // Promise that resolves when the server disconnects.
    const disconnectPromise = new Promise<void>((resolve, reject) => {
      socket.on("close", () => {
        resolve();
      });
      setTimeout(() => {
        reject(new Error("Timeout waiting for close"));
      }, 5000);
    });

    // Ensure the client disconnects on disposal.
    languageClient.off();
    await disconnectPromise;
  });

  it("disconnects when server is unassigned", async () => {
    let connectedCallback = (_: AssignmentChangeEvent) => {
      // NoOp
    };
    assignmentStub.onDidAssignmentsChange.callsFake(
      (listener: (e: AssignmentChangeEvent) => void) => {
        connectedCallback = listener;
        return { dispose: emptyFunc };
      },
    );
    assignmentStub.latestServer.returns(Promise.resolve(latestServer));
    // Promise that resolves when the server receives a websocket connection.
    const connectionPromise = new Promise<WebSocket>((resolve, reject) => {
      server.on("connection", (socket) => {
        resolve(socket);
      });
      // Avoid hanging the test forever.
      setTimeout(() => {
        reject(new Error("Timeout waiting for connection"));
      }, 2000);
    });
    const languageClient = new LanguageClientController(
      vsStub.asVsCode(),
      assignmentStub,
      newTestLanguageClient,
    );
    // Ensure the client is started so it registers its assignment-change
    // handler.
    languageClient.on();
    // Await connection after enabling the client.
    // Await connection after enabling the client.
    const socket = await connectionPromise;

    // Promise that resolves when the server disconnects.
    const disconnectPromise = new Promise<void>((resolve, reject) => {
      socket.on("close", () => {
        resolve();
      });
      setTimeout(() => {
        reject(new Error("Timeout waiting for close"));
      }, 5000);
    });

    // // Ensure the client disconnects on the latest runtime disappearing.
    assignmentStub.latestServer.returns(Promise.resolve(undefined));
    connectedCallback({
      added: [],
      changed: [],
      removed: [{ server: latestServer, userInitiated: true }],
    });
    await disconnectPromise;
  });

  it("connects to a newer runtime", async () => {
    let assignmentsChangedCallback = (_: AssignmentChangeEvent) => {
      // NoOp
    };
    assignmentStub.onDidAssignmentsChange.callsFake(
      (listener: (e: AssignmentChangeEvent) => void) => {
        assignmentsChangedCallback = listener;
        return { dispose: emptyFunc };
      },
    );
    assignmentStub.latestServer.returns(Promise.resolve(latestServer));

    // Promise that resolves when the server receives a websocket connection.
    const connectionPromise1 = new Promise<WebSocket>((resolve, reject) => {
      server.on("connection", (socket) => {
        resolve(socket);
      });
      // Avoid hanging the test forever.
      setTimeout(() => {
        reject(new Error("Timeout waiting for connection to server 1"));
      }, 2000);
    });
    const languageClient = new LanguageClientController(
      vsStub.asVsCode(),
      assignmentStub,
      newTestLanguageClient,
    );
    languageClient.on();
    const socket1 = await connectionPromise1;

    // Promise that resolves when the server disconnects.
    const disconnectPromise1 = new Promise<void>((resolve, reject) => {
      socket1.on("close", () => {
        resolve();
      });
      setTimeout(() => {
        reject(new Error("Timeout waiting for close from server 1"));
      }, 5000);
    });

    // Set up a second server.
    const server2 = new WebSocketServer({ port: 9877, host: "127.0.0.1" });
    after(() => {
      server2.close();
    });
    await new Promise<void>((resolve) =>
      server2.on("listening", () => {
        resolve();
      }),
    );
    const addr2 = server2.address() as AddressInfo;
    const baseUrl2 = TestUri.parse(
      `ws://${addr2.address}:${addr2.port.toString()}`,
    );
    const latestServer2: ColabAssignedServer = {
      ...latestServer,
      id: randomUUID(),
      // Must be a new endpoint to trigger a new connection.
      endpoint: "m-s-foo2",
      connectionInformation: {
        ...latestServer.connectionInformation,
        baseUrl: baseUrl2,
      },
    };

    const connectionPromise2 = new Promise<WebSocket>((resolve, reject) => {
      server2.on("connection", (socket) => {
        resolve(socket);
      });
      setTimeout(() => {
        reject(new Error("Timeout waiting for connection to server 2"));
      }, 2000);
    });

    // Switch to the new server.
    assignmentStub.latestServer.returns(Promise.resolve(latestServer2));
    assignmentsChangedCallback({
      added: [latestServer2],
      changed: [],
      removed: [],
    });

    await disconnectPromise1;
    const socket2 = await connectionPromise2;

    const disconnectPromise2 = new Promise<void>((resolve, reject) => {
      socket2.on("close", () => {
        resolve();
      });
      setTimeout(() => {
        reject(new Error("Timeout waiting for close from server 2"));
      }, 5000);
    });

    languageClient.dispose();
    await disconnectPromise2;
  });

  it("does not reconnect when an older server is removed", async () => {
    let assignmentsChangedCallback = (_: AssignmentChangeEvent) => {
      // NoOp
    };
    assignmentStub.onDidAssignmentsChange.callsFake(
      (listener: (e: AssignmentChangeEvent) => void) => {
        assignmentsChangedCallback = listener;
        return { dispose: emptyFunc };
      },
    );
    assignmentStub.latestServer.returns(Promise.resolve(latestServer));

    // Promise that resolves when the server receives a websocket connection.
    const connectionPromise1 = new Promise<WebSocket>((resolve, reject) => {
      server.on("connection", (socket) => {
        resolve(socket);
      });
      // Avoid hanging the test forever.
      setTimeout(() => {
        reject(new Error("Timeout waiting for connection to server 1"));
      }, 2000);
    });
    const languageClient = new LanguageClientController(
      vsStub.asVsCode(),
      assignmentStub,
      newTestLanguageClient,
    );
    languageClient.on();
    const socket1 = await connectionPromise1;

    let closed = false;
    socket1.on("close", () => {
      closed = true;
    });
    const removedServer: ColabAssignedServer = {
      ...latestServer,
      endpoint: "not-newest",
    };
    // Call the callback, even though latestServer is returning the same
    // value. This is expected if the user removes an older runtime.
    assignmentsChangedCallback({
      added: [],
      changed: [],
      removed: [{ server: removedServer, userInitiated: true }],
    });

    // Listen for another message on the client to know that the connection
    // is still live.
    await new Promise<void>((resolve, reject) => {
      socket1.once("message", () => {
        resolve();
      });
      setTimeout(() => {
        reject(new Error("Did not complete within timeout"));
      }, 5000);
    });
    expect(closed).to.equal(false);
    languageClient.dispose();
  });

  it("can call the assignment callback multiple times", async () => {
    assignmentStub.latestServer
      .onFirstCall()
      .returns(Promise.resolve(undefined));
    assignmentStub.latestServer
      .onSecondCall()
      .returns(Promise.reject(new Error("Test error")));
    assignmentStub.latestServer
      .onThirdCall()
      .returns(Promise.resolve(latestServer));
    let assignmentsChangedCallback = (_: AssignmentChangeEvent) => {
      // NoOp
    };
    assignmentStub.onDidAssignmentsChange.callsFake(
      (listener: (e: AssignmentChangeEvent) => void) => {
        assignmentsChangedCallback = listener;
        return { dispose: emptyFunc };
      },
    );
    // Promise that resolves when the server receives a websocket connection.
    const connectionPromise = new Promise<WebSocket>((resolve, reject) => {
      server.on("connection", (socket) => {
        resolve(socket);
      });
      // Avoid hanging the test forever.
      setTimeout(() => {
        reject(new Error("Timeout waiting for connection"));
      }, 2000);
    });
    const languageClient = new LanguageClientController(
      vsStub.asVsCode(),
      assignmentStub,
      newTestLanguageClient,
    );
    // Ensure the client is started so it registers its assignment-change
    // handler.
    languageClient.on();
    // Call the callback twice, to check that it recovers from the first error
    // returned, and also can handle multiple callbacks happening at once.
    assignmentsChangedCallback({
      added: [latestServer],
      changed: [],
      removed: [],
    });
    assignmentsChangedCallback({
      added: [latestServer],
      changed: [],
      removed: [],
    });
    // Await connection after enabling the client.
    const socket = await connectionPromise;
    // Promise that resolves when the server disconnects.
    const disconnectPromise = new Promise<void>((resolve, reject) => {
      socket.on("close", () => {
        resolve();
      });
      setTimeout(() => {
        reject(new Error("Timeout waiting for close"));
      }, 5000);
    });

    // Ensure the client disconnects on disposal.
    languageClient.off();
    await disconnectPromise;
  });
});
