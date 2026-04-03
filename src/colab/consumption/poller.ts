/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Disposable, Event, EventEmitter } from 'vscode';
import { LatestCancelable } from '../../common/async';
import { Toggleable } from '../../common/toggleable';
import { AssignmentChangeEvent } from '../../jupyter/assignments';
import { ConsumptionUserInfo } from '../api';
import { ColabClient } from '../client';

const POLL_INTERVAL_MS = 1000 * 60; // 1 minute.

/**
 * Periodically polls for CCU info changes and emits an event on updates.
 *
 * Not thread-safe, but safe under typical VS Code extension usage
 * (single-threaded, no worker threads).
 */
export class ConsumptionPoller implements Toggleable, Disposable {
  readonly onDidChangeCcuInfo: Event<ConsumptionUserInfo>;
  private readonly emitter: EventEmitter<ConsumptionUserInfo>;
  private readonly worker: LatestCancelable<[]>;
  private assignmentListener?: Disposable;
  private consumptionUserInfo?: ConsumptionUserInfo;
  private timer?: NodeJS.Timeout;
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
    this.worker = new LatestCancelable(
      'ConsumptionPoller.poll',
      this.poll.bind(this),
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
    this.clearPolling();
    this.emitter.dispose();
    this.worker.cancel();
    this.isDisposed = true;
  }

  /**
   * Turns on the polling process, immediately.
   */
  on(): void {
    this.guardDisposed();
    void this.worker.run();
    this.ensurePolling();
    this.assignmentListener ??= this.assignmentChange(
      () => void this.worker.run(),
    );
  }

  /**
   * Turns off the polling process and aborts the running worker.
   */
  off(): void {
    this.guardDisposed();
    this.clearPolling();
    if (this.assignmentListener) {
      this.assignmentListener.dispose();
      this.assignmentListener = undefined;
    }
    this.worker.cancel();
  }

  private ensurePolling(): void {
    this.timer ??= setInterval(() => void this.worker.run(), POLL_INTERVAL_MS);
  }

  private clearPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
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
