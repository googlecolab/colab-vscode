/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Disposable } from "vscode";
import { log } from "./logging";

/**
 * Configuration for the {@link SequentialTaskRunner}.
 */
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
  /**
   * How long (in milliseconds) to wait for an aborted task to complete before
   * giving up.
   *
   * This is relevant for tasks that are aborted due to timeout or the
   * {@link OverrunPolicy.AbandonAndRun} policy.
   *
   * If the aborted task does not complete within this time, it is left to
   * finish in the background while a new task is started. The aborted task is
   * signaled to abort, but it is up to the task implementation to respect that
   * signal.
   */
  readonly abandonGraceMs: number;
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
 * A task to be run by the {@link SequentialTaskRunner}.
 */
export interface Task {
  /** A name for the task being run. Used as context in error messages. */
  name: string;
  /** The function to run the task. */
  run: (signal: AbortSignal) => Promise<void>;
}

/**
 * Runs a task at a regular interval, ensuring that only one task is running at
 * a time.
 *
 * When disposed, this class stops any scheduled intervals and aborts any
 * in-flight task.
 */
export class SequentialTaskRunner implements Disposable {
  private inFlight?: {
    promise: Promise<void>;
    abortCtrl: AbortController;
  };
  private taskInterval?: NodeJS.Timeout;
  // A lock used to ensure execution is sequential.
  private isRunning = false;

  constructor(
    private readonly config: Config,
    private readonly task: Task,
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
      this.run();
    }
    this.taskInterval = setInterval(() => {
      this.run();
    }, this.config.intervalTimeoutMs);
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
    this.isRunning = false;
    this.inFlight?.abortCtrl.abort(new DisposedError(this.task.name));
  }

  /**
   * A synchronous and re-entrant entry point for triggering a task run.
   */
  private run(): void {
    if (this.isRunning) {
      // A task worker is already active.
      switch (this.overrun) {
        case OverrunPolicy.AllowToComplete:
          // Do nothing, let the current task finish.
          return;
        case OverrunPolicy.AbandonAndRun:
          // Signal the active task to abort.
          //
          // The active worker's `finally` block will see this abort reason and
          // immediately start a new task.
          log.warn(`Task "${this.task.name}" abandoned for a new run`);
          this.inFlight?.abortCtrl.abort(
            new OverrunAbandonError(this.task.name),
          );
          return;
      }
    }

    // No worker is active. Acquire the lock and start one.
    this.isRunning = true;
    void this.runWorker();
  }

  /**
   * The async worker that holds the lock and executes the task. This method
   * should only be called by the synchronous {@link SequentialTaskRunner.run}
   * method, which manages the lock.
   */
  private async runWorker(): Promise<void> {
    const abort = new AbortController();
    abort.signal.addEventListener(
      "abort",
      () => {
        const reason: unknown = abort.signal.reason;
        if (reason instanceof TimeoutError) {
          log.error(reason.message);
        }
      },
      { once: true },
    );

    const timeout = setTimeout(() => {
      abort.abort(new TimeoutError(this.task.name, this.config.taskTimeoutMs));
    }, this.config.taskTimeoutMs);

    try {
      const taskPromise = this.task.run(abort.signal);
      this.inFlight = {
        promise: this.withGracefulAbort(
          taskPromise,
          abort.signal,
          this.config.abandonGraceMs,
          this.task.name,
        ),
        abortCtrl: abort,
      };

      await this.inFlight.promise;
    } catch (err: unknown) {
      // If the lock is lost while the worker runs, that's because we're
      // disposing. Avoid logging errors in that case.
      if (!this.isRunning) {
        return;
      }
      if (err instanceof NonGracefulAbandonError) {
        // Task failed to shut down cleanly after an abort.
        log.error(err.message);
      } else {
        // The task itself threw an unexpected error.
        log.error(
          `Unhandled error in background task "${this.task.name}":`,
          err,
        );
      }
    } finally {
      clearTimeout(timeout);
      this.inFlight = undefined;

      const reason: unknown = abort.signal.reason;
      if (reason instanceof OverrunAbandonError && this.isRunning) {
        // Here the task holding the lock was told to abort. Once it has, loop
        // immediately to run the new task.
        void this.runWorker();
      } else {
        // Task finished normally, by timeout, or by dispose.
        // Release the lock so a new interval can start one.
        this.isRunning = false;
      }
    }
  }

  /**
   * Wraps a task promise to provide a graceful shutdown mechanism.
   *
   * This function uses `Promise.race` to compete the `task` against an
   * `abortHandler`.
   *
   * - If `task` completes first, the race is settled, and the `finally` block
   *   on `task` removes the `abort` event listener to prevent leaks.
   * - If the `abort` signal is fired, the `onAbort` listener is triggered. It
   *   starts a `graceTimeout`. The `task` is given `graceMs` milliseconds to
   *   complete its cleanup.
   * - If `task` finishes within the grace period, its `finally` block clears
   *   the `graceTimeout`, preventing the `abortHandler` from rejecting.
   * - If `task` does not finish within the grace period, the `graceTimeout`
   *   fires, causing the `abortHandler` to reject with a
   *   `NonGracefulAbandonError`. This settles the race, signaling that the task
   *   did not shut down cleanly.
   */
  private withGracefulAbort(
    task: Promise<void>,
    signal: AbortSignal,
    graceMs: number,
    taskName: string,
  ): Promise<void> {
    const abortHandler = new Promise<void>((_, reject) => {
      const onAbort = () => {
        const graceTimeout = setTimeout(() => {
          reject(new NonGracefulAbandonError(taskName, graceMs));
        }, graceMs);

        void task.finally(() => {
          clearTimeout(graceTimeout);
        });
      };

      signal.addEventListener("abort", onAbort, { once: true });

      void task.finally(() => {
        signal.removeEventListener("abort", onAbort);
      });
    });

    return Promise.race([task, abortHandler]);
  }
}

class NonGracefulAbandonError extends Error {
  constructor(taskName: string, timeoutMs: number) {
    super(
      `Task "${taskName}" did not complete within a ${timeoutMs.toString()}ms grace period after being abandoned.`,
    );
    this.name = "NonGracefulAbandonError";
  }
}

class TimeoutError extends Error {
  constructor(taskName: string, afterMs: number) {
    super(`Task "${taskName}" timed out after ${afterMs.toString()}ms`);
    this.name = "TimeoutError";
  }
}

class OverrunAbandonError extends Error {
  constructor(taskName: string) {
    super(`Task "${taskName}" abandoned for a new run`);
    this.name = "OverrunAbandonError";
  }
}

class DisposedError extends Error {
  constructor(taskName: string) {
    super(`Task "${taskName}" aborted due to runner being disposed`);
    this.name = "DisposedError";
  }
}
