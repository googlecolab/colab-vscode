/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Disposable, Event, EventEmitter } from 'vscode';
import { LatestCancelable } from '../../common/async';
import {
  OverrunPolicy,
  SequentialTaskRunner,
  StartMode,
} from '../../common/task-runner';
import { Toggleable } from '../../common/toggleable';
import { AssignmentChangeEvent } from '../../jupyter/assignments';
import { ConsumptionUserInfo } from '../api';
import { ColabClient } from '../client';

const POLL_INTERVAL_MS = 1000 * 60; // 1 minute.
const TASK_TIMEOUT_MS = 1000 * 10; // 10 seconds.

/**
 * Periodically polls for CCU info changes and emits an event on updates.
 *
 * Not thread-safe, but safe under typical VS Code extension usage
 * (single-threaded, no worker threads).
 */
export class ConsumptionPoller implements Toggleable, Disposable {
  readonly onDidChangeCcuInfo: Event<ConsumptionUserInfo>;
  private readonly emitter: EventEmitter<ConsumptionUserInfo>;
  private readonly assignmentListener: Disposable;
  private consumptionUserInfo?: ConsumptionUserInfo;
  private runner: SequentialTaskRunner;
  private isAuthorized = false;
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
    assignmentChange: Event<AssignmentChangeEvent>,
  ) {
    this.emitter = new this.vs.EventEmitter<ConsumptionUserInfo>();
    this.onDidChangeCcuInfo = this.emitter.event;

    const cancelablePoll = new LatestCancelable(
      'ConsumptionPoller.poll',
      this.poll.bind(this),
    );
    this.assignmentListener = assignmentChange(() => void cancelablePoll.run());
    this.runner = new SequentialTaskRunner(
      {
        intervalTimeoutMs: POLL_INTERVAL_MS,
        taskTimeoutMs: TASK_TIMEOUT_MS,
        // Nothing to cleanup, abandon immediately.
        abandonGraceMs: 0,
      },
      {
        name: ConsumptionPoller.name,
        run: cancelablePoll.run.bind(cancelablePoll),
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
    this.assignmentListener.dispose();
    this.emitter.dispose();
    this.runner.dispose();
    this.isDisposed = true;
  }

  /**
   * Turns on the polling process, immediately.
   */
  on(): void {
    this.guardDisposed();
    this.isAuthorized = true;
    this.runner.start(StartMode.Immediately);
  }

  /**
   * Turns off the polling process.
   */
  off(): void {
    this.guardDisposed();
    this.isAuthorized = false;
    this.runner.stop();
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
    if (!this.isAuthorized) {
      return;
    }

    const consumptionUserInfo =
      await this.client.getConsumptionUserInfo(signal);
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
