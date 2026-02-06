/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, {
  Event,
  EventEmitter,
  Pseudoterminal,
  TerminalDimensions,
} from 'vscode';
import { log } from '../../common/logging';
import { ColabTerminalWebSocketLike } from './colab-terminal-websocket';

/**
 * VS Code Pseudoterminal implementation that bridges the terminal UI
 * with the Colab terminal WebSocket.
 *
 * This class implements the Pseudoterminal interface to provide a terminal
 * experience that connects to a remote Colab terminal session instead of
 * a local shell.
 */
export class ColabPseudoterminal implements Pseudoterminal {
  readonly onDidWrite: Event<string>;
  readonly onDidClose: Event<number>;

  private readonly writeEmitter: EventEmitter<string>;
  private readonly closeEmitter: EventEmitter<number>;

  private isOpen = false;
  private isConnected = false;
  private initialDimensions?: TerminalDimensions;

  constructor(
    private readonly vs: typeof vscode,
    private readonly terminalWebSocket: ColabTerminalWebSocketLike,
  ) {
    this.writeEmitter = new this.vs.EventEmitter<string>();
    this.closeEmitter = new this.vs.EventEmitter<number>();

    this.onDidWrite = this.writeEmitter.event;
    this.onDidClose = this.closeEmitter.event;
  }

  /**
   * Called when the terminal is opened in VS Code.
   *
   * This establishes the WebSocket connection and sets up event handlers.
   *
   * @param initialDimensions - The initial terminal dimensions, if available
   */
  open(initialDimensions?: TerminalDimensions): void {
    if (this.isOpen) {
      log.warn('ColabPseudoterminal.open() called when already open');
      return;
    }

    this.isOpen = true;
    this.initialDimensions = initialDimensions;

    // Show connection status to user
    this.writeEmitter.fire(
      this.format('Connecting to Colab terminal...', {
        color: 'info',
        withLeadingNewline: false,
      }),
    );

    try {
      // Set up event handlers before connecting
      this.setupWebSocketHandlers();

      // Establish WebSocket connection
      this.terminalWebSocket.connect();
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      log.error('Failed to connect to Colab terminal:', error);
      this.writeEmitter.fire(
        this.format(
          `Error: Failed to connect to Colab terminal: ${errorMessage}`,
          {
            color: 'error',
            withLeadingNewline: true,
          },
        ),
      );
      this.terminalWebSocket.dispose();
      // Close the terminal on connection failure
      this.closeEmitter.fire(1);
    }
  }

  /**
   * Closes the terminal and cleans up resources.
   */
  close(): void {
    if (!this.isOpen) {
      return;
    }

    this.isOpen = false;
    this.isConnected = false;
    this.closeEmitter.fire(0);

    log.trace('ColabPseudoterminal closed');

    // Clean up WebSocket connection
    this.terminalWebSocket.dispose();

    // Clean up event emitters
    this.writeEmitter.dispose();
    this.closeEmitter.dispose();
  }

  /**
   * Handles user input from the terminal.
   *
   * This forwards the input data to the WebSocket to be sent to the
   * remote Colab terminal.
   *
   * @param data - The user input string
   */
  handleInput(data: string): void {
    if (!this.isConnected) {
      log.warn('Received input while WebSocket not connected');
      return;
    }

    try {
      this.terminalWebSocket.send(data);
    } catch (error: unknown) {
      log.error('Failed to send input to Colab terminal:', error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.writeEmitter.fire(
        this.format(`Error: Failed to send input: ${errorMessage}`, {
          color: 'error',
          withLeadingNewline: true,
        }),
      );
    }
  }

  /**
   * Called when the terminal dimensions change.
   *
   * This sends a resize message to the WebSocket to update the remote
   * terminal's dimensions and prevent display issues.
   *
   * @param dimensions - The new terminal dimensions
   */
  setDimensions(dimensions: TerminalDimensions): void {
    if (!this.isConnected) {
      return;
    }

    try {
      this.terminalWebSocket.sendResize(dimensions.columns, dimensions.rows);
    } catch (error: unknown) {
      log.error('Failed to send terminal resize:', error);
    }
  }

  /**
   * Sets up event handlers for WebSocket events.
   */
  private setupWebSocketHandlers(): void {
    this.terminalWebSocket.onOpen(() => {
      if (!this.isOpen) {
        return;
      }
      this.isConnected = true;
      this.writeEmitter.fire(
        this.format('Connected to Colab terminal.', {
          color: 'info',
          withLeadingNewline: true,
        }),
      );

      if (this.initialDimensions) {
        this.terminalWebSocket.sendResize(
          this.initialDimensions.columns,
          this.initialDimensions.rows,
        );
      }
    });

    // Handle data received from the remote terminal
    this.terminalWebSocket.onData((data: string) => {
      if (!this.isOpen) {
        return;
      }

      // Pass through ANSI escape sequences without modification.
      // The VS Code terminal will interpret them for colors, cursor movement,
      // etc.
      this.writeEmitter.fire(data);
    });

    // Handle WebSocket connection closed
    this.terminalWebSocket.onClose(() => {
      if (!this.isOpen) {
        return;
      }

      log.trace('WebSocket connection closed');
      this.isConnected = false;

      // Notify user of disconnection
      this.writeEmitter.fire(
        this.format('Connection to Colab terminal closed.', {
          color: 'warning',
          withLeadingNewline: true,
        }),
      );

      // Close the VS Code terminal
      this.closeEmitter.fire(0);
    });

    // Handle WebSocket errors
    this.terminalWebSocket.onError((error: Error) => {
      if (!this.isOpen) {
        return;
      }

      log.error('WebSocket error:', error);

      const errorMessage = error.message || String(error);
      this.writeEmitter.fire(
        this.format(errorMessage, { color: 'error', withLeadingNewline: true }),
      );

      // Don't automatically close on error - let the user see the error
      // and the WebSocket will fire onClose if the connection is lost
    });
  }

  private format(
    text: string,
    opts: {
      color: 'error' | 'warning' | 'info';
      withLeadingNewline: boolean;
    },
  ): string {
    const outputBuilder: string[] = [];
    if (opts.withLeadingNewline) {
      outputBuilder.push('\r\n');
    }

    switch (opts.color) {
      case 'error':
        outputBuilder.push(TerminalTextFormatCode.ERROR);
        break;
      case 'warning':
        outputBuilder.push(TerminalTextFormatCode.WARNING);
        break;
      default:
      // Do nothing
    }

    outputBuilder.push(text);
    outputBuilder.push(TerminalTextFormatCode.RESET);
    outputBuilder.push('\r\n');
    return outputBuilder.join('');
  }
}

enum TerminalTextFormatCode {
  RESET = '\x1b[0m',
  ERROR = '\x1b[31m',
  WARNING = '\x1b[33m',
}
