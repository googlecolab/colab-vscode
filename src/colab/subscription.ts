import vscode, { Disposable } from "vscode";
import { ColabClient } from "../colab/client";
import { OverrunPolicy, SequentialTaskRunner } from "../common/task-runner";
import { SubscriptionTier } from "./api";

const POLL_INTERVAL_MS = 1000 * 60 * 5; // 5 minutes.
const TASK_TIMEOUT_MS = 1000 * 10; // 10 seconds.

/**
 * The event emitted when the subscription tier changes.
 */
export interface SubscriptionTierChange {
  /** The old subscription tier. */
  from: SubscriptionTier;
  /** The new subscription tier. */
  to: SubscriptionTier;
}

/**
 * Periodically polls for the user's subscription tier.
 */
export class SubscriptionWatcher implements Disposable {
  /** Event emitted when there's been a change to the user's subscription tier. */
  readonly onDidChangeTier: vscode.Event<SubscriptionTierChange>;
  private readonly emitter: vscode.EventEmitter<SubscriptionTierChange>;
  private _tier: SubscriptionTier;
  private readonly runner: SequentialTaskRunner;

  constructor(
    private readonly vs: typeof vscode,
    private readonly client: ColabClient,
    initialTier: SubscriptionTier,
  ) {
    this.emitter = new this.vs.EventEmitter<SubscriptionTierChange>();
    this.onDidChangeTier = this.emitter.event;
    this._tier = initialTier;
    this.runner = new SequentialTaskRunner(
      { intervalTimeoutMs: POLL_INTERVAL_MS, taskTimeoutMs: TASK_TIMEOUT_MS },
      (signal) => this.updateSubscriptionTier(signal),
      OverrunPolicy.AbandonAndRun,
    );
  }

  dispose(): void {
    this.runner.dispose();
  }

  /** The current subscription tier. */
  get tier() {
    return this._tier;
  }

  private async updateSubscriptionTier(signal: AbortSignal): Promise<void> {
    const from = this._tier;
    const to = await this.client.getSubscriptionTier(signal);
    if (from === to) {
      return;
    }

    this._tier = to;
    this.emitter.fire({ from, to });
  }
}
