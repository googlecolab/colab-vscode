/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as http from "http";
import vscode from "vscode";

const FAILED_TO_GET_PORT = new Error("Failed to acquire server port");

/**
 * Handles the various events and requests for the loopback server.
 */
export interface LoopbackHandler {
  /**
   * Handles incoming requests to the loopback server. This function is called
   * for each request received by the server.
   *
   * @param req - The incoming HTTP request.
   * @param res - The HTTP response object to send a response back to the
   * client.
   */
  handleRequest: (req: http.IncomingMessage, res: http.ServerResponse) => void;

  /**
   * Handles errors that occur during server operation. This function is
   * called when an error occurs in the server, such as a request handling
   * error or a server error.
   *
   * @param err - The error that occurred.
   */
  handleError?: (err: Error) => void;

  /**
   * Handles the server close event. This function is called when the
   * server is closed, either due to an error or when the server is disposed.
   */
  handleClose?: () => void;
}

/**
 * An ephemeral local server that listens for OAuth callback requests.
 *
 * Callers are expected to call `start()` to begin listening for requests,
 * and `dispose()` to clean up the server when it is no longer needed.
 */
export class LoopbackServer implements vscode.Disposable {
  private listen?: Promise<number>;
  private readonly server: http.Server;
  private isDisposed = false;

  constructor(private readonly handler: LoopbackHandler) {
    this.server = http.createServer();
    this.server.on("request", (req, res) => {
      handler.handleRequest(req, res);
    });
    this.server.on("error", (err) => {
      if (this.handler.handleError) {
        this.handler.handleError(err);
      }
    });
    this.server.on("close", () => {
      if (this.handler.handleClose) {
        this.handler.handleClose();
      }
    });
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    if (!this.server.listening) {
      return;
    }
    this.server.close((err) => {
      if (err) {
        console.error("Error closing server:", err);
      }
    });
  }

  /**
   * Starts the loopback server and begins listening for requests.
   *
   * @returns A promise that resolves to the port number the server is listening
   * on. If the server fails to start or the port cannot be determined, it
   * rejects with an error.
   */
  async start(): Promise<number> {
    if (this.isDisposed) {
      throw new Error("Local server has already been disposed");
    }
    if (this.listen) {
      return this.listen;
    }
    this.listen = new Promise<number>((resolve, reject) => {
      this.server.listen(0, "127.0.0.1", () => {
        const address = this.server.address();
        // A string is only ever returned when listening on a pipe or Unix
        // domain socket, which isn't the case here. Regardless, the check is
        // included to safely handle the address as an AddressInfo type.
        if (address && typeof address !== "string") {
          resolve(address.port);
        } else {
          reject(FAILED_TO_GET_PORT);
        }
      });
    });
    return this.listen;
  }
}
