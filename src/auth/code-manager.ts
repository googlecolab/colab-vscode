/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from "vscode";

const EXCHANGE_TIMEOUT_MS = 60_000;

/**
 * A promise that can have its underlying resources (like timers or listeners)
 * cleaned up.
 */
interface DisposablePromise<T> extends vscode.Disposable {
  promise: Promise<T>;
}

/**
 * Provides the mechanism to wait for and resolve authorization codes. This
 * class is disposable and will reject any pending operations when disposed.
 */
export class CodeManager implements vscode.Disposable {
  private readonly inFlightPromises = new Map<
    string,
    { resolve: (value: string) => void; reject: (reason: Error) => void }
  >();

  /**
   * Rejects all pending `waitForCode` promises. This should be called
   * when the class instance is no longer needed to prevent resource leaks.
   */
  dispose(): void {
    const error = new Error("Authentication provider has been disposed.");
    for (const promiseHandlers of this.inFlightPromises.values()) {
      promiseHandlers.reject(error);
    }
    this.inFlightPromises.clear();
  }

  /**
   * Waits for an authorization code corresponding to the provided nonce.
   * A nonce can only be used once.
   *
   * @param nonce - A unique string to correlate the request and response.
   * @param token - A cancellation token to cancel the request.
   * @returns A promise that resolves with the authorization code.
   */
  async waitForCode(
    nonce: string,
    token: vscode.CancellationToken,
  ): Promise<string> {
    if (this.inFlightPromises.has(nonce)) {
      throw new Error(`Already waiting for nonce: ${nonce}`);
    }

    const userCancellation = waitForCancellation(token);
    const timeout = waitForTimeout(EXCHANGE_TIMEOUT_MS);

    try {
      const codePromise = new Promise<string>((resolve, reject) => {
        this.inFlightPromises.set(nonce, { resolve, reject });
      });

      // Race the main promise against timeout and user cancellation.
      return await Promise.race([
        codePromise,
        userCancellation.promise,
        timeout.promise,
      ]);
    } finally {
      this.inFlightPromises.delete(nonce);
      userCancellation.dispose();
      timeout.dispose();
    }
  }

  /**
   * Resolves the in-flight promise corresponding to the provided nonce
   * with the provided authorization code.
   *
   * @param nonce - The unique nonce used to correlate the request and response.
   * @param code - The authorization code to resolve for the associated nonce.
   */
  resolveCode(nonce: string, code: string): void {
    const inFlight = this.inFlightPromises.get(nonce);
    if (!inFlight) {
      throw new Error("Unexpected code exchange received");
    }

    inFlight.resolve(code);
  }
}

/**
 * Creates a promise that rejects when the cancellation token is triggered.
 * Returns a disposable to remove the event listener.
 */
function waitForCancellation(
  token: vscode.CancellationToken,
): DisposablePromise<never> {
  let listener: vscode.Disposable;
  const promise = new Promise<never>((_, reject) => {
    listener = token.onCancellationRequested(() => {
      reject(new Error("Authentication was cancelled by the user."));
    });
  });

  return {
    promise,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    dispose: () => listener.dispose(),
  };
}

/**
 * Creates a promise that rejects after a specified timeout.
 * Returns a disposable to clear the timer.
 */
function waitForTimeout(ms: number): DisposablePromise<never> {
  let timeoutId: NodeJS.Timeout;
  const promise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error("Exchange timeout exceeded"));
    }, ms);
  });

  return {
    promise,
    dispose: () => {
      clearTimeout(timeoutId);
    },
  };
}
