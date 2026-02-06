/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Event, EventEmitter } from 'vscode';
import WebSocket from 'ws';
import { log } from '../../common/logging';
import { ColabAssignedServer } from '../../jupyter/servers';
import { COLAB_RUNTIME_PROXY_TOKEN_HEADER } from '../headers';

export interface ColabTerminalWebSocketLike extends vscode.Disposable {
  readonly onData: Event<string>;
  readonly onOpen: Event<void>;
  readonly onClose: Event<void>;
  readonly onError: Event<Error>;
  connect: () => void;
  send: (data: string) => void;
  sendResize: (cols: number, rows: number) => void;
}

/**
 * Message formats for Colab terminal WebSocket protocol.
 */
interface ColabTerminalDataMessage {
  data: string;
}

interface ColabTerminalResizeMessage {
  cols: number;
  rows: number;
}

type ColabTerminalMessage =
  | ColabTerminalDataMessage
  | ColabTerminalResizeMessage;

/**
 * WebSocket handler for connecting to Colab's TTY endpoint.
 *
 * This class manages the WebSocket connection to `/colab/tty` and handles
 * bidirectional communication with the remote terminal session.
 */
export class ColabTerminalWebSocket implements ColabTerminalWebSocketLike {
  private ws?: WebSocket;
  private disposed = false;
  private lastWsUrl?: string;
  private pendingMessages: ColabTerminalMessage[] = [];

  private readonly onDataEmitter: EventEmitter<string>;
  private readonly onOpenEmitter: EventEmitter<void>;
  private readonly onCloseEmitter: EventEmitter<void>;
  private readonly onErrorEmitter: EventEmitter<Error>;

  /**
   * Fired when data is received from the remote terminal.
   */
  readonly onData: Event<string>;

  /**
   * Fired when the WebSocket connection is established.
   */
  readonly onOpen: Event<void>;

  /**
   * Fired when the WebSocket connection is closed.
   */
  readonly onClose: Event<void>;

  /**
   * Fired when an error occurs.
   */
  readonly onError: Event<Error>;

  constructor(
    private readonly vs: typeof vscode,
    private readonly server: ColabAssignedServer,
    private readonly WebSocketClass: typeof WebSocket = WebSocket,
  ) {
    this.onDataEmitter = new this.vs.EventEmitter<string>();
    this.onOpenEmitter = new this.vs.EventEmitter<void>();
    this.onCloseEmitter = new this.vs.EventEmitter<void>();
    this.onErrorEmitter = new this.vs.EventEmitter<Error>();

    this.onData = this.onDataEmitter.event;
    this.onOpen = this.onOpenEmitter.event;
    this.onClose = this.onCloseEmitter.event;
    this.onError = this.onErrorEmitter.event;
  }

  /**
   * Throws an error if this instance has been disposed.
   *
   * @throws Error if disposed
   */
  private guardDisposed(): void {
    if (this.disposed) {
      throw new Error('ColabTerminalWebSocket is disposed');
    }
  }

  /**
   * Establishes the WebSocket connection to the Colab TTY endpoint.
   *
   * @throws Error if already connected or disposed
   */
  connect(): void {
    this.guardDisposed();

    if (this.ws) {
      throw new Error('WebSocket is already connected');
    }

    const wsUrl = this.buildWebSocketUrl();
    const options = this.buildWebSocketOptions();
    this.lastWsUrl = wsUrl;

    log.trace('Connecting to Colab terminal WebSocket:', wsUrl);

    try {
      this.ws = new this.WebSocketClass(wsUrl, options);
      this.setupWebSocketHandlers();
    } catch (error: unknown) {
      log.error('Failed to create WebSocket connection:', error);
      throw error;
    }
  }

  /**
   * Sends data to the remote terminal.
   *
   * @param data - The string data to send (e.g., user input)
   */
  send(data: string): void {
    this.guardDisposed();

    const message: ColabTerminalDataMessage = { data };
    this.sendMessage(message);
  }

  /**
   * Sends a resize message to update the terminal dimensions.
   *
   * @param cols - Number of columns
   * @param rows - Number of rows
   */
  sendResize(cols: number, rows: number): void {
    this.guardDisposed();

    const message: ColabTerminalResizeMessage = { cols, rows };
    this.sendMessage(message);
    log.trace(`Sent terminal resize: ${cols.toString()}x${rows.toString()}`);
  }

  /**
   * Closes the WebSocket connection and cleans up resources.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.pendingMessages = [];

    if (this.ws) {
      this.ws.removeAllListeners();
      if (
        this.ws.readyState === WebSocket.CONNECTING ||
        this.ws.readyState === WebSocket.OPEN
      ) {
        this.ws.close();
      }
      this.ws = undefined;
    }

    this.onDataEmitter.dispose();
    this.onOpenEmitter.dispose();
    this.onCloseEmitter.dispose();
    this.onErrorEmitter.dispose();

    log.trace('ColabTerminalWebSocket disposed');
  }

  /**
   * Builds the WebSocket URL for the Colab TTY endpoint.
   *
   * Authentication is provided via HTTP header (X-Colab-Runtime-Proxy-Token)
   */
  private buildWebSocketUrl(): string {
    const baseUrl = this.server.connectionInformation.baseUrl;
    const url = new URL(baseUrl.toString());
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = new URL('/colab/tty', url).pathname;

    return url.toString();
  }

  /**
   * Builds the WebSocket client options including headers.
   */
  private buildWebSocketOptions(): WebSocket.ClientOptions {
    const token = this.server.connectionInformation.token;
    const connectionHeaders = this.server.connectionInformation.headers ?? {};

    return {
      headers: {
        ...connectionHeaders,
        // Ensure the runtime proxy token is always present.
        [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]: token,
      },
    };
  }

  /**
   * Sets up event handlers for the WebSocket connection.
   */
  private setupWebSocketHandlers(): void {
    if (!this.ws) {
      return;
    }

    this.ws.on('open', () => {
      log.trace('Colab terminal WebSocket connected');
      if (this.disposed) {
        return;
      }
      this.flushPendingMessages();
      this.onOpenEmitter.fire();
    });

    this.ws.on('message', (data: WebSocket.RawData) => {
      if (this.disposed) {
        return;
      }

      try {
        const message =
          typeof data === 'string' ? data : (data as Buffer).toString();
        this.handleMessage(message);
      } catch (error: unknown) {
        log.error('Error handling WebSocket message:', error);
        this.onErrorEmitter.fire(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      log.trace(
        `Colab terminal WebSocket closed: ${code.toString()} ${reason.toString()}`,
      );
      if (!this.disposed) {
        this.ws = undefined;
        this.onCloseEmitter.fire();
      }
    });

    this.ws.on('error', (error: Error) => {
      log.error(
        'Colab terminal WebSocket error:',
        error,
        this.lastWsUrl ? `url=${this.lastWsUrl}` : '',
      );
      if (!this.disposed) {
        this.onErrorEmitter.fire(error);
      }
    });

    this.ws.on('unexpected-response', (_request, response) => {
      if (this.disposed) {
        return;
      }

      const statusCode = response.statusCode ?? 0;
      const statusMessage = response.statusMessage ?? '';
      const url = this.lastWsUrl ?? '(unknown)';

      // Try to read a small amount of the response body for debugging.
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      response.on('data', (chunk: Buffer) => {
        if (totalBytes >= 2048) {
          return;
        }
        chunks.push(chunk);
        totalBytes += chunk.length;
      });
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8').trim();
        if (body.length) {
          log.error(
            'Colab terminal WebSocket unexpected response:',
            statusCode.toString(),
            statusMessage,
            `url=${url}`,
            `body=${body}`,
          );
        } else {
          log.error(
            'Colab terminal WebSocket unexpected response:',
            statusCode.toString(),
            statusMessage,
            `url=${url}`,
          );
        }
      });

      this.onErrorEmitter.fire(
        new Error(
          `Unexpected server response: ${statusCode.toString()} (${statusMessage})`,
        ),
      );
    });
  }

  /**
   * Handles incoming messages from the WebSocket.
   *
   * Expected format: `{"data": string}` for terminal output
   */
  private handleMessage(rawMessage: string): void {
    let message: unknown;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      log.warn('Received non-JSON message from Colab terminal:', rawMessage);
      return;
    }

    if (this.isDataMessage(message)) {
      this.onDataEmitter.fire(message.data);
    } else {
      log.trace('Received unhandled message format:', message);
    }
  }

  /**
   * Type guard for data messages.
   */
  private isDataMessage(message: unknown): message is ColabTerminalDataMessage {
    return (
      typeof message === 'object' &&
      message !== null &&
      'data' in message &&
      typeof (message as ColabTerminalDataMessage).data === 'string'
    );
  }

  /**
   * Sends a message through the WebSocket.
   */
  private sendMessage(message: ColabTerminalMessage): void {
    try {
      const payload = JSON.stringify(message);
      if (!this.ws) {
        log.error('Cannot send message: WebSocket is not created');
        return;
      }
      if (this.ws.readyState === WebSocket.CONNECTING) {
        this.pendingMessages.push(message);
        return;
      }
      if (this.ws.readyState !== WebSocket.OPEN) {
        log.error('Cannot send message: WebSocket is not open');
        return;
      }
      this.ws.send(payload);
    } catch (error: unknown) {
      log.error('Failed to send WebSocket message:', error);
      this.onErrorEmitter.fire(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  private flushPendingMessages(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    if (!this.pendingMessages.length) {
      return;
    }
    const pending = this.pendingMessages;
    this.pendingMessages = [];
    for (const message of pending) {
      this.sendMessage(message);
    }
  }
}
