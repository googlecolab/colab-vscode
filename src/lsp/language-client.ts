/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Duplex } from "stream";
import vscode, { Disposable } from "vscode";
import type {
  LanguageClientOptions,
  ServerOptions,
  LanguageClient,
  DocumentSelector,
  StreamInfo,
} from "vscode-languageclient/node";
import { WebSocket, createWebSocketStream } from "ws";
import { log } from "../common/logging";
import { ColabAssignedServer } from "../jupyter/servers";
import { ContentLengthTransformer } from "./content-length-transformer";
import {
  filterNonIPythonDiagnostics as filterDiags,
  filterNonIPythonWorkspaceDiagnostics as filterWorkspaceDiags,
} from "./middleware";

/**
 * The document selector for Python notebook cells.
 */
const PYTHON_NOTEBOOK: DocumentSelector = [
  {
    scheme: "vscode-notebook-cell",
    language: "python",
  },
];

/**
 * Factory function for creating new {@link LanguageClient}s.
 */
export type LanguageClientFactory = (
  id: string,
  name: string,
  serverOptions: ServerOptions,
  clientOptions: LanguageClientOptions,
) => LanguageClient;

type WebSocketFactory = (url: string) => WebSocket;
type StreamFactory = (socket: WebSocket) => Duplex;

/**
 * A language client to the configured server.
 *
 * Must call {@link ColabLanguageClient.start | start} to begin receiving
 * diagnostics. Callers should then call
 * {@link ColabLanguageClient.dispose | dispose} when they no longer need the
 * client.
 */
export class ColabLanguageClient implements Disposable {
  private languageClient?: LanguageClient;

  constructor(
    private vs: typeof vscode,
    private readonly server: ColabAssignedServer,
    private readonly createClient: LanguageClientFactory,
    private readonly createSocket: WebSocketFactory = (url) =>
      new WebSocket(url),
    private readonly createStream: StreamFactory = (socket) =>
      createWebSocketStream(socket),
  ) {
    this.languageClient = this.buildClient();
  }

  /**
   * Starts the language client if it needs starting.
   *
   * Cannot be started if {@link ColabLanguageClient.dispose | dispose} has been
   * called.
   */
  async start(): Promise<void> {
    if (!this.languageClient) {
      throw new Error("Cannot start after being disposed");
    }

    if (!this.languageClient.needsStart()) {
      return;
    }

    await this.languageClient.start();
    log.info(`Started a Colab Language Client for ${this.server.label}`);
  }

  async dispose(): Promise<void> {
    if (!this.languageClient) {
      return;
    }
    await this.languageClient.dispose();
    this.languageClient = undefined;
    log.info(`Removed the Colab Language Client for ${this.server.label}`);
  }

  private buildClient(): LanguageClient {
    const serverOptions = this.getServerOptions();
    const clientOptions = this.getClientOptions();

    return this.createClient(
      "colabLanguageServer",
      "Colab Language Server",
      serverOptions,
      clientOptions,
    );
  }

  private getServerOptions(): ServerOptions {
    return async () => {
      const url = this.buildLanguageServerUrl();
      const socket = this.createSocket(url.toString());
      socket.binaryType = "arraybuffer";
      return this.createSocketConnection(socket);
    };
  }

  private getClientOptions(): LanguageClientOptions {
    return {
      documentSelector: PYTHON_NOTEBOOK,
      middleware: {
        provideDiagnostics: (d, p, t, n) => {
          return filterDiags(this.vs, d, p, t, n);
        },
        provideWorkspaceDiagnostics: (r, t, p, n) => {
          return filterWorkspaceDiags(this.vs, r, t, p, n);
        },
      },
    };
  }

  private buildLanguageServerUrl(): URL {
    const c = this.server.connectionInformation;
    const url = new URL(c.baseUrl.toString());
    url.protocol = "wss";
    url.pathname = "/colab/lsp";
    url.search = `?colab-runtime-proxy-token=${c.token}`;
    return url;
  }

  /**
   * Creates the websocket connection. Pipes the stream to transform messages to
   * the required/expected format and logs relevant events.
   */
  private createSocketConnection(socket: WebSocket): Promise<StreamInfo> {
    return new Promise<{
      writer: NodeJS.WritableStream;
      reader: NodeJS.ReadableStream;
    }>((resolve, reject) => {
      socket.onopen = () => {
        log.debug("Language server socket opened.");
        const stream = this.createStream(socket);
        const reader = stream.pipe(new ContentLengthTransformer());
        const writer = stream;

        stream.on("error", (err) => {
          log.error("Language server stream error", err);
        });
        stream.on("close", () => {
          log.debug("Language server stream closed");
        });
        resolve({
          writer,
          reader,
        });
      };
      socket.onerror = (err) => {
        log.error("Language server socket error", err);
        const e =
          err.error instanceof Error
            ? err.error
            : new Error(`Socket error: ${err.message}`);
        reject(e);
      };
      socket.onclose = (event) => {
        log.info("Language server socket closed", event);
        reject(new Error("Language server socket closed unexpectedly"));
      };
    });
  }
}
