/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { log } from "./logging";

/**
 * Run an async worker task, canceling in-flight work with an
 * {@link AbortSignal}.
 */
export class LatestCancelable<T extends unknown[]> {
  private curAbort?: AbortController;

  constructor(
    private readonly name: string,
    private readonly worker: (...args: [...T, AbortSignal]) => Promise<void>,
  ) {}

  /**
   * Fire the worker, aborting the previous if running.
   */
  async run(...args: T): Promise<void> {
    // Abort previous.
    if (this.curAbort) {
      this.curAbort.abort();
    }

    const abort = new AbortController();
    this.curAbort = abort;

    try {
      await this.worker(...args, abort.signal);
    } catch (err: unknown) {
      if (
        abort.signal.aborted ||
        (err instanceof Error && err.name === "AbortError")
      ) {
        // Throwing an abort is expected.
      } else {
        log.error(`LatestCancelable worker error for "${this.name}"`, err);
      }
    } finally {
      // Only clear the controller if it is still the most recent one.
      if (this.curAbort === abort) {
        this.curAbort = undefined;
      }
    }
  }

  /**
   * True when there's an active worker task running.
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
