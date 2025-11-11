/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Disposable } from "vscode";
import type {
  LanguageClientOptions,
  ServerOptions,
  LanguageClient,
} from "vscode-languageclient/node";
import { ClientOptions, WebSocket, createWebSocketStream } from "ws";
import { log } from "../common/logging";
import { AsyncToggleable } from "../common/toggleable";
import { AssignmentManager } from "../jupyter/assignments";
import { ColabAssignedServer } from "../jupyter/servers";
import { ContentLengthTransformer } from "./content-length-transformer";
import { getMiddleware } from "./middleware";

type VSLanguageClientFactory = (
  id: string,
  name: string,
  serverOptions: ServerOptions,
  clientOptions: LanguageClientOptions,
) => LanguageClient;

/**
 * Manages the lifecycle of a LanguageClient connected to the latest assigned
 * Colab server.
 */
export class LanguageClientController extends AsyncToggleable<Disposable> {
  private client: ColabLanguageClient | undefined;
  private latestServerEndpoint: string;
  private abortController = new AbortController();

  constructor(
    private vs: typeof vscode,
    private readonly assignments: AssignmentManager,
    private readonly vsLanguageClientFactory: VSLanguageClientFactory,
  ) {
    super();
  }

  override async initialize(signal: AbortSignal): Promise<Disposable> {
    // signal will be aborted when the Toggleable is turned off.
    signal.onabort = (e) => {
      this.abortController.abort(e);
    };
    const listenDispose = this.assignments.onDidAssignmentsChange(async (e) => {
      if (
        e.added.length ||
        e.removed.some((s) => {
          return s.server.endpoint === this.latestServerEndpoint;
        })
      ) {
        // Abort any in-flight work from the last call.
        this.abortController.abort();
        await this.tearDownClient("Server removed");
      } else {
        // Don't care about updated server lists, or servers being
        // removed that we weren't connected to.
        return;
      }
      this.abortController = new AbortController();
      await this.connectToLatest(this.abortController.signal);
    });
    await this.connectToLatest(this.abortController.signal);
    return {
      dispose: () => {
        listenDispose.dispose();
        void this.tearDownClient("Toggled off");
      },
    };
  }

  private async connectToLatest(signal?: AbortSignal): Promise<void> {
    const latestServer = await this.assignments.latestServer(signal);
    if (!latestServer) {
      await this.tearDownClient("No assigned servers");
      return;
    }
    // Don't make a new client if the latest runtime has not changed.
    if (latestServer.endpoint === this.latestServerEndpoint) {
      return;
    }
    await this.tearDownClient("Newer runtime found");
    this.latestServerEndpoint = latestServer.endpoint;
    if (signal?.aborted) {
      return;
    }
    this.latestServerEndpoint = latestServer.endpoint;
    this.client = new ColabLanguageClient(
      this.vsLanguageClientFactory,
      latestServer,
      this.vs,
    );
    await this.client.start();
    return;
  }

  private async tearDownClient(reason: string) {
    if (!this.client) {
      return;
    }
    log.info(
      `Tearing down LanguageClient for endpoint ${this.latestServerEndpoint}: ${reason}`,
    );
    await this.client.dispose();
    this.client = undefined;
    this.latestServerEndpoint = "";
  }
}

class ColabLanguageClient implements Disposable {
  private languageClient: LanguageClient;

  constructor(
    private readonly createVSLanguageClient: VSLanguageClientFactory,
    server: ColabAssignedServer,
    private vs: typeof vscode,
  ) {
    this.languageClient = this.buildVSLanguageClient(server);
  }

  async start(): Promise<void> {
    if (!this.languageClient.needsStart()) {
      return;
    }

    await this.languageClient.start();
  }

  async dispose(): Promise<void> {
    await this.languageClient.dispose();
  }

  private buildVSLanguageClient(server: ColabAssignedServer): LanguageClient {
    const runtimeProxyInfo = server.connectionInformation;
    const url = new URL(runtimeProxyInfo.baseUrl.toString());
    const isLocalhost =
      url.hostname === "localhost" || url.hostname === "127.0.0.1";
    url.protocol = isLocalhost ? "ws" : "wss";
    url.pathname = "/colab/lsp";
    url.search = `?colab-runtime-proxy-token=${runtimeProxyInfo.token}`;

    log.info(
      `Setting up Colab Language Client for endpoint ${server.endpoint}`,
    );

    const socketOptions: ClientOptions = {
      rejectUnauthorized: isLocalhost ? false : true,
    };

    const socket = new WebSocket(url.toString(), socketOptions);
    socket.binaryType = "arraybuffer";
    const vs = this.vs;
    const serverOptions: ServerOptions = async () => {
      return new Promise((resolve, reject) => {
        socket.onopen = () => {
          log.debug("Language server socket opened.");
          const stream = createWebSocketStream(socket);
          const reader = stream.pipe(new ContentLengthTransformer());
          // The LanguageClient handles framing for outgoing messages.
          const writer = stream;

          stream.on("error", (err) => {
            log.error("Language server stream error:", err);
          });
          stream.on("close", () => {
            log.debug("Language server stream closed.");
          });
          resolve({
            writer,
            reader,
          });
        };
        socket.onerror = (err) => {
          log.error("Language server socket error:", err);
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
          reject(err);
        };
        socket.onclose = (event) => {
          log.info("Language server socket closed:", event);
        };
      });
    };
    const clientOptions: LanguageClientOptions = {
      documentSelector: [
        { scheme: "vscode-notebook-cell", language: "python" },
      ],
      middleware: getMiddleware(vs),
    };
    return this.createVSLanguageClient(
      "colabLanguageServer",
      "Colab Language Server",
      serverOptions,
      clientOptions,
    );
  }
}
