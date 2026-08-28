/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Disposable, Event, EventEmitter } from 'vscode';
import {
  OverrunPolicy,
  SequentialTaskRunner,
  StartMode,
  TimeoutError,
} from '../../common/task-runner';
import { Toggleable } from '../../common/toggleable';
import { AssignmentChangeEvent } from '../../jupyter/assignments';
import { ColabClient } from '../client/v1';
import { ConsumptionUserInfo } from '../client/v1/api';

const POLL_INTERVAL_MS = 1000 * 60; // 1 minute.
const TASK_TIMEOUT_MS = 1000 * 10; // 10 seconds.
/**
 * Ceiling on the consecutive intervals skipped while backing off, so a user who
 * is simply offline issues ~4 requests an hour rather than 60.
 */
const MAX_BACKOFF_INTERVALS = 15;

/**
 * Number of poll intervals to sit out after a run of failures.
 *
 * @param failures - Consecutive failures so far, at least one.
 * @returns The number of intervals to skip before trying again.
 */
function backoffIntervals(failures: number): number {
  const base = Math.min(2 ** (failures - 1), MAX_BACKOFF_INTERVALS);
  const jittered = Math.round(base * (0.5 + Math.random()));
  return Math.min(Math.max(jittered, 1), MAX_BACKOFF_INTERVALS);
}

/**
 * Reports whether a failed poll says anything about the network.
 *
 * The runner aborts polls it has superseded or disposed, which is routine. A
 * timeout is different: the request really is hanging and we should back off.
 *
 * @param signal - The signal the poll ran under.
 * @returns True when the failure should count towards the backoff.
 */
function countsAsFailure(signal?: AbortSignal): boolean {
  return !signal?.aborted || signal.reason instanceof TimeoutError;
}

/**
 * Periodically polls for CCU info changes and emits an event on updates.
 *
 * Not thread-safe, but safe under typical VS Code extension usage
 * (single-threaded, no worker threads).
 */
export class ConsumptionPoller implements Toggleable, Disposable {
  readonly onDidChangeCcuInfo: Event<ConsumptionUserInfo>;
  private readonly emitter: EventEmitter<ConsumptionUserInfo>;
  private readonly runner: SequentialTaskRunner;
  private assignmentListener?: Disposable;
  private consumptionUserInfo?: ConsumptionUserInfo;
  private consecutiveFailures = 0;
  private intervalsToSkip = 0;
  private isDisposed = false;

  /**
   * Initializes a new instance.
   *
   * @param vs - The VS Code API instance.
   * @param client - The API client instance.
   * @param assignmentChange - The Assignment change event.
   */
  constructor(
    private readonly vs: typeof vscode,
    private readonly client: ColabClient,
    private readonly assignmentChange: Event<AssignmentChangeEvent>,
  ) {
    this.emitter = new this.vs.EventEmitter<ConsumptionUserInfo>();
    this.onDidChangeCcuInfo = this.emitter.event;
    this.runner = new SequentialTaskRunner(
      {
        intervalTimeoutMs: POLL_INTERVAL_MS,
        taskTimeoutMs: TASK_TIMEOUT_MS,
        // Nothing to cleanup, abandon immediately.
        abandonGraceMs: 0,
      },
      {
        name: 'ConsumptionPoller',
        run: this.poll.bind(this),
      },
      OverrunPolicy.AbandonAndRun,
    );
  }

  /**
   * Disposes of the notifier, cleaning up any resources.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.assignmentListener?.dispose();
    this.runner.dispose();
    this.emitter.dispose();
    this.isDisposed = true;
  }

  /**
   * Turns on the polling process, immediately.
   */
  on(): void {
    this.guardDisposed();
    this.runner.start(StartMode.Immediately);
    this.assignmentListener ??= this.assignmentChange(() => {
      // Assignment changes move CCU rates, so we bail on the backoff.
      this.intervalsToSkip = 0;
      this.runner.runNow();
    });
  }

  /**
   * Turns off the polling process.
   */
  off(): void {
    this.guardDisposed();
    this.runner.stop();
    this.consecutiveFailures = 0;
    this.intervalsToSkip = 0;
    if (this.assignmentListener) {
      this.assignmentListener.dispose();
      this.assignmentListener = undefined;
    }
  }

  private guardDisposed(): void {
    if (this.isDisposed) {
      throw new Error(
        'Cannot use ConsumptionPoller after it has been disposed',
      );
    }
  }

  /**
   * Checks the latests CCU info and emits an event when there is a change.
   *
   * @param signal - The cancellation signal.
   */
  private async poll(signal?: AbortSignal): Promise<void> {
    if (this.isDisposed) {
      return;
    }
    if (this.intervalsToSkip > 0) {
      this.intervalsToSkip--;
      return;
    }

    let consumptionUserInfo: ConsumptionUserInfo;
    try {
      consumptionUserInfo = await this.client.getConsumptionUserInfo(signal);
    } catch (err: unknown) {
      if (countsAsFailure(signal)) {
        this.consecutiveFailures++;
        this.intervalsToSkip = backoffIntervals(this.consecutiveFailures);
      }
      throw err;
    }
    this.consecutiveFailures = 0;

    if (
      JSON.stringify(consumptionUserInfo) ===
      JSON.stringify(this.consumptionUserInfo)
    ) {
      return;
    }

    this.consumptionUserInfo = consumptionUserInfo;
    this.emitter.fire(this.consumptionUserInfo);
  }
}

export const TEST_ONLY = {
  POLL_INTERVAL_MS,
  TASK_TIMEOUT_MS,
  MAX_BACKOFF_INTERVALS,
};
