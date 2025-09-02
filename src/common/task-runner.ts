/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Disposable } from "vscode";

export interface Config {
  /**
   * How long (in milliseconds) before timing out the task that is run at each
   * configured interval.
   */
  readonly taskTimeoutMs: number;
  /**
   * How long (in milliseconds) to wait between task invocations.
   */
  readonly intervalTimeoutMs: number;
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
 * Specifies when the task runner should start its first run.
 */
export enum StartMode {
  /** Start the task immediately. */
  Immediately,
  /** Start the task after the configured {@link Config.intervalTimeoutMs}. */
  Scheduled,
}

/**
 * Runs a task at a regular interval, ensuring that only one task is running at
 * a time.
 *
 * When disposed, this class stops any scheduled intervals and aborts any
 * in-flight task.
 */
export class SequentialTaskRunner implements Disposable {
  private inFlight?: Promise<void>;
  private inFlightAbort?: AbortController;
  private taskInterval?: NodeJS.Timeout;

  constructor(
    private readonly config: Config,
    private readonly task: (signal: AbortSignal) => Promise<void>,
    private readonly overrun: OverrunPolicy,
  ) {}

  dispose(): void {
    this.stop();
  }

  /**
   * Starts running, using the provided configuration.
   *
   * If already started, does nothing.
   *
   * @param mode - When to start the first task. Defaults to
   * {@link StartMode.Scheduled}.
   */
  start(mode: StartMode = StartMode.Scheduled): void {
    if (this.taskInterval) {
      return;
    }
    if (mode === StartMode.Immediately) {
      void this.run();
    }
    this.taskInterval = setInterval(
      () => void this.run(),
      this.config.intervalTimeoutMs,
    );
  }

  /**
   * Stops running.
   *
   * If an execution is in-flight, it is aborted. If already stopped, does
   * nothing.
   */
  stop(): void {
    clearInterval(this.taskInterval);
    this.taskInterval = undefined;
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
      this.inFlightAbort = undefined;
    }
  }
}
