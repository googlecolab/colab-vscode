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
  private readonly runner: SequentialTaskRunner;
  private assignmentListener?: Disposable;
  private consumptionUserInfo?: ConsumptionUserInfo;
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
        name: ConsumptionPoller.name,
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
    this.assignmentListener ??= this.assignmentChange(
      this.runner.runNow.bind(this.runner),
    );
  }

  /**
   * Turns off the polling process.
   */
  off(): void {
    this.guardDisposed();
    this.runner.stop();
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

export const TEST_ONLY = {
  POLL_INTERVAL_MS,
  TASK_TIMEOUT_MS,
};
