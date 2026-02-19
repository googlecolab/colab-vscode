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
import { ConsumptionUserInfo } from '../api';
import { ColabClient } from '../client';

const POLL_INTERVAL_MS = 1000 * 60 * 5; // 5 minutes.
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
  private ccuInfo?: ConsumptionUserInfo;
  private runner: SequentialTaskRunner;
  private isDisposed = false;

  constructor(
    private readonly vs: typeof vscode,
    private readonly client: ColabClient,
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

  dispose(): void {
    this.runner.dispose();
    this.isDisposed = true;
  }

  /**
   * Turns on the polling process, immediately.
   */
  on(): void {
    this.assertNotDisposed();
    this.runner.start(StartMode.Immediately);
  }

  /**
   * Turns off the polling process.
   */
  off(): void {
    this.assertNotDisposed();
    this.runner.stop();
  }

  /**
   * Checks the latests CCU info and emits an event when there is a change.
   */
  private async poll(signal?: AbortSignal): Promise<void> {
    const ccuInfo = await this.client.getConsumptionUserInfo(signal);
    if (JSON.stringify(ccuInfo) === JSON.stringify(this.ccuInfo)) {
      return;
    }

    this.ccuInfo = ccuInfo;
    this.emitter.fire(this.ccuInfo);
  }

  private assertNotDisposed(): void {
    if (this.isDisposed) {
      throw new Error('ConsumptionPoller is disposed');
    }
  }
}
