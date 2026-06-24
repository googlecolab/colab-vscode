/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from 'vscode';
import { log } from './logging';

/**
 * Run an async worker task, canceling in-flight work with an
 * {@link AbortSignal}.
 */
export class LatestCancelable<T extends unknown[], R = void> {
  private curAbort?: AbortController;

  /**
   * Initializes a new instance.
   *
   * @param name - The entity name.
   * @param worker - The worker function or process.
   */
  constructor(
    private readonly name: string,
    private readonly worker: (...args: [...T, AbortSignal]) => Promise<R>,
  ) {}

  /**
   * Fire the worker, aborting the previous if running.
   *
   * @param args - The arguments provided to the worker.
   * @returns The result of the worker, or undefined if the worker was aborted
   * or threw an error.
   */
  async run(...args: T): Promise<R | undefined> {
    // Abort previous.
    if (this.curAbort) {
      this.curAbort.abort();
    }

    const abort = new AbortController();
    this.curAbort = abort;

    try {
      return await this.worker(...args, abort.signal);
    } catch (err: unknown) {
      if (
        abort.signal.aborted ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        // Throwing an abort is expected.
      } else {
        log.error(`LatestCancelable worker error for "${this.name}"`, err);
      }
      return undefined;
    } finally {
      // Only clear the controller if it is still the most recent one.
      if (this.curAbort === abort) {
        this.curAbort = undefined;
      }
    }
  }

  /**
   * True when there's an active worker task running.
   *
   * @returns True if a worker task is currently running and has not been
   * aborted.
   */
  isRunning(): boolean {
    return !!this.curAbort && !this.curAbort.signal.aborted;
  }

  /**
   * Cancels an in-flight worker task if one is running.
   */
  cancel(): void {
    this.curAbort?.abort();
  }
}

/**
 * Checks if an unknown value is {@link PromiseLike}.
 *
 * @param value - The input value.
 * @returns True if the value is {@link PromiseLike}, false otherwise.
 */
export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * A promise that can have its underlying resources (like timers or listeners)
 * cleaned up.
 */
export interface DisposablePromise<T> extends vscode.Disposable {
  /** The underlying promise that can be awaited. */
  promise: Promise<T>;
}

/**
 * Creates a promise that rejects after a specified timeout.
 * Returns a disposable to clear the timer.
 *
 * @param ms - The delay duration in milliseconds.
 * @param message - The error message for the timeout.
 * @returns A disposable promise that rejects after the specified timeout.
 */
export function waitForTimeout(
  ms: number,
  message: string,
): DisposablePromise<never> {
  let timeoutId: NodeJS.Timeout;
  const promise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });

  return {
    promise,
    dispose: () => {
      clearTimeout(timeoutId);
    },
  };
}
