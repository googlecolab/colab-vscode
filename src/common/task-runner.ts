/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Disposable } from "vscode";

interface Config {
  /**
   * How long (in milliseconds) before timing out the task that is run at each
   * configured interval.
   */
  taskTimeoutMs: number;
  /**
   * How long (in milliseconds) to wait between task invocations.
   */
  intervalTimeoutMs: number;
}

/**
 * Policy to apply when a task is invoked while another task is already running.
 */
export enum OverrunPolicy {
  /**
   * The already running task remains untouched and subsequent task invocations
   * are skipped.
   */
  AllowToComplete,
  /**
   * The already running task is aborted and a new task is started.
   */
  AbandonAndRun,
}

/**
 * Runs a task at a regular interval, ensuring that only one task is running at
 * a time.
 */
export class SequentialTaskRunner implements Disposable {
  private inFlight?: Promise<void>;
  private inFlightAbort?: AbortController;
  private readonly timeout: NodeJS.Timeout;

  constructor(
    private readonly config: Config,
    private readonly task: (signal: AbortSignal) => Promise<void>,
    private readonly overrun: OverrunPolicy,
  ) {
    this.timeout = setInterval(() => void this.run(), config.intervalTimeoutMs);
  }

  dispose(): void {
    clearInterval(this.timeout);
    this.inFlightAbort?.abort();
  }

  private async run(): Promise<void> {
    if (this.inFlight) {
      switch (this.overrun) {
        case OverrunPolicy.AllowToComplete:
          return;
        case OverrunPolicy.AbandonAndRun:
          this.inFlightAbort?.abort();
          break;
      }
    }

    const abort = new AbortController();
    this.inFlightAbort = abort;
    const timeout = setTimeout(() => {
      abort.abort(
        `Timed out running task (timeout: ${this.config.taskTimeoutMs.toString()}ms)`,
      );
    }, this.config.taskTimeoutMs);
    try {
      this.inFlight = this.task(abort.signal);
      await this.inFlight;
    } finally {
      clearTimeout(timeout);
      this.inFlight = undefined;
    }
  }
}
