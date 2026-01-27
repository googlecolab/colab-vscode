/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter, Disposable } from 'vscode';
import WebSocket from 'ws';
import { ColabAssignedServer } from '../../jupyter/servers';
import { COLAB_RUNTIME_PROXY_TOKEN_HEADER } from '../headers';
import { log } from '../../common/logging';

/**
 * Message formats for Colab TTY WebSocket protocol.
 */
interface ColabTtyDataMessage {
  data: string;
}

interface ColabTtyResizeMessage {
  cols: number;
  rows: number;
}

type ColabTtyMessage = ColabTtyDataMessage | ColabTtyResizeMessage;

/**
 * WebSocket handler for connecting to Colab's TTY endpoint.
 *
 * This class manages the WebSocket connection to `/colab/tty` and handles
 * bidirectional communication with the remote terminal session.
 */
export class ColabTtyWebSocket implements Disposable {
  private ws?: WebSocket;
  private disposed = false;
  private lastWsUrl?: string;
  private pendingMessages: ColabTtyMessage[] = [];

  private readonly _onData = new EventEmitter<string>();
  private readonly _onOpen = new EventEmitter<void>();
  private readonly _onClose = new EventEmitter<void>();
  private readonly _onError = new EventEmitter<Error>();

  /**
   * Fired when data is received from the remote terminal.
   */
  public readonly onData = this._onData.event;

  /**
   * Fired when the WebSocket connection is established.
   */
  public readonly onOpen = this._onOpen.event;

  /**
   * Fired when the WebSocket connection is closed.
   */
  public readonly onClose = this._onClose.event;

  /**
   * Fired when an error occurs.
   */
  public readonly onError = this._onError.event;

  constructor(
    private readonly server: ColabAssignedServer,
    private readonly WebSocketClass: typeof WebSocket = WebSocket,
  ) {}

  /**
   * Establishes the WebSocket connection to the Colab TTY endpoint.
   *
   * @throws Error if already connected or disposed
   */
  public connect(): void {
    if (this.disposed) {
      throw new Error('ColabTtyWebSocket is disposed');
    }

    if (this.ws) {
      throw new Error('WebSocket is already connected');
    }

    const wsUrl = this.buildWebSocketUrl();
    const options = this.buildWebSocketOptions();
    this.lastWsUrl = wsUrl;

    log.trace('Connecting to Colab TTY WebSocket:', wsUrl);

    try {
      this.ws = new this.WebSocketClass(wsUrl, options);
      this.setupWebSocketHandlers();
    } catch (error) {
      log.error('Failed to create WebSocket connection:', error);
      throw error;
    }
  }

  /**
   * Sends data to the remote terminal.
   *
   * @param data The string data to send (e.g., user input)
   */
  public send(data: string): void {
    this.guardDisposed();

    const message: ColabTtyDataMessage = { data };
    this.sendMessage(message);
  }

  /**
   * Sends a resize message to update the terminal dimensions.
   *
   * @param cols Number of columns
   * @param rows Number of rows
   */
  public sendResize(cols: number, rows: number): void {
    this.guardDisposed();

    const message: ColabTtyResizeMessage = { cols, rows };
    this.sendMessage(message);
    log.trace(`Sent terminal resize: ${cols}x${rows}`);
  }

  /**
   * Closes the WebSocket connection and cleans up resources.
   */
  public dispose(): void {
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

    this._onData.dispose();
    this._onOpen.dispose();
    this._onClose.dispose();
    this._onError.dispose();

    log.trace('ColabTtyWebSocket disposed');
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
      log.trace('Colab TTY WebSocket connected');
      if (this.disposed) {
        return;
      }
      this.flushPendingMessages();
      this._onOpen.fire();
    });

    this.ws.on('message', (data: WebSocket.RawData) => {
      if (this.disposed) {
        return;
      }

      try {
        const message =
          typeof data === 'string' ? data : (data as Buffer).toString();
        this.handleMessage(message);
      } catch (error) {
        log.error('Error handling WebSocket message:', error);
        this._onError.fire(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      log.trace(`Colab TTY WebSocket closed: ${code} ${reason.toString()}`);
      if (!this.disposed) {
        this.ws = undefined;
        this._onClose.fire();
      }
    });

    this.ws.on('error', (error: Error) => {
      log.error(
        'Colab TTY WebSocket error:',
        error,
        this.lastWsUrl ? `url=${this.lastWsUrl}` : '',
      );
      if (!this.disposed) {
        this._onError.fire(error);
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
            `Colab TTY WebSocket unexpected response: ${statusCode.toString()} ${statusMessage} url=${url} body=${body}`,
          );
        } else {
          log.error(
            `Colab TTY WebSocket unexpected response: ${statusCode.toString()} ${statusMessage} url=${url}`,
          );
        }
      });

      this._onError.fire(
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
    } catch (error) {
      log.warn('Received non-JSON message from Colab TTY:', rawMessage);
      return;
    }

    if (this.isDataMessage(message)) {
      this._onData.fire(message.data);
    } else {
      log.trace('Received unhandled message format:', message);
    }
  }

  /**
   * Type guard for data messages.
   */
  private isDataMessage(message: unknown): message is ColabTtyDataMessage {
    return (
      typeof message === 'object' &&
      message !== null &&
      'data' in message &&
      typeof (message as ColabTtyDataMessage).data === 'string'
    );
  }

  /**
   * Sends a message through the WebSocket.
   */
  private sendMessage(message: ColabTtyMessage): void {
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
    } catch (error) {
      log.error('Failed to send WebSocket message:', error);
      this._onError.fire(
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

  /**
   * Guards against using a disposed instance.
   */
  private guardDisposed(): void {
    if (this.disposed) {
      throw new Error('ColabTtyWebSocket is disposed');
    }
  }
}
