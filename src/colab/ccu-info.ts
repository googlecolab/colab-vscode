/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Disposable } from "vscode";
import { ColabClient } from "../colab/client";
import { OverrunPolicy, SequentialTaskRunner } from "../common/task-runner";
import { CcuInfo } from "./api";

const POLL_INTERVAL_MS = 1000 * 60 * 5; // 5 minutes.
const TASK_TIMEOUT_MS = 1000 * 10; // 10 seconds.

/**
 * Periodically polls for CCU info changes and emits an event when one occurs.
 */
export class CcuInformationManager implements Disposable {
  readonly onDidChangeCcuInfo: vscode.Event<void>;
  private readonly emitter: vscode.EventEmitter<void>;
  private _ccuInfo?: CcuInfo;
  private readonly runner: SequentialTaskRunner;

  constructor(
    private readonly vs: typeof vscode,
    private readonly client: ColabClient,
    ccuInfo?: CcuInfo,
  ) {
    this._ccuInfo = ccuInfo;
    this.emitter = new this.vs.EventEmitter<void>();
    this.onDidChangeCcuInfo = this.emitter.event;
    this.runner = new SequentialTaskRunner(
      { intervalTimeoutMs: POLL_INTERVAL_MS, taskTimeoutMs: TASK_TIMEOUT_MS },
      (signal) => this.updateCcuInfo(signal),
      OverrunPolicy.AbandonAndRun,
    );
  }

  dispose(): void {
    this.runner.dispose();
  }

  /**
   * Getter for the current CCU information.
   */
  get ccuInfo() {
    return this._ccuInfo;
  }

  /**
   * Updates with new CCU info and emits an event when there is a change.
   */
  private async updateCcuInfo(signal: AbortSignal): Promise<void> {
    const ccuInfo = await this.client.getCcuInfo(signal);
    if (JSON.stringify(ccuInfo) === JSON.stringify(this.ccuInfo)) {
      return;
    }

    this._ccuInfo = ccuInfo;
    this.emitter.fire();
  }

  /**
   * Initializes {@link CcuInformationManager} with the current value obtained
   * by fetching it from the client.
   */
  static async initialize(
    vs: typeof vscode,
    client: ColabClient,
  ): Promise<CcuInformationManager> {
    const info = await client.getCcuInfo();
    return new CcuInformationManager(vs, client, info);
  }
}
