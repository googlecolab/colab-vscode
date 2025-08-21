/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from "vscode";
import { CcuInfo, SubscriptionTier } from "./api";
import { ColabClient } from "./client";
import { openColabSignup } from "./commands/external";

const WARN_WHEN_LESS_THAN_MINUTES = 30;
const DEFAULT_SNOOZE_MINUTES = 10;

/**
 * The type of notification the notifier dispatches.
 */
type Notify =
  | typeof vscode.window.showErrorMessage
  | typeof vscode.window.showWarningMessage;

/**
 * Monitors Colab Compute Units (CCU) balance and consumption rate, notifying
 * the user when their CCU-s are depleted or running low.
 */
export class ConsumptionNotifier implements vscode.Disposable {
  private ccuListener: vscode.Disposable;
  private snoozeError = false;
  private snoozeWarn = false;
  private errorTimeout?: NodeJS.Timeout;
  private warnTimeout?: NodeJS.Timeout;

  constructor(
    private readonly vs: typeof vscode,
    private readonly colab: ColabClient,
    onDidChangeCcuInfo: vscode.Event<CcuInfo>,
    private readonly snoozeMinutes: number = DEFAULT_SNOOZE_MINUTES,
  ) {
    this.ccuListener = onDidChangeCcuInfo((e) => this.notifyCcuConsumption(e));
  }

  dispose() {
    this.ccuListener.dispose();
    clearTimeout(this.errorTimeout);
    clearTimeout(this.warnTimeout);
  }

  /**
   * When applicable, notifies the user about their Colab Compute Units (CCU).
   *
   * Gives the user an action to sign up, upgrade or purchase more CCU-s (link
   * to the signup page).
   */
  protected async notifyCcuConsumption(e: CcuInfo): Promise<void> {
    const paidMinutesLeft = (e.currentBalance / e.consumptionRateHourly) * 60;
    const freeMinutesLeft = calculateRoughMinutesLeft(e);
    // Quantize to 10 minutes.
    const totalMinutesLeft = ((paidMinutesLeft + freeMinutesLeft) / 10) * 10;
    if (totalMinutesLeft > WARN_WHEN_LESS_THAN_MINUTES) {
      return;
    }

    const notification = this.buildNotification(totalMinutesLeft);
    if (!notification) {
      return;
    }

    const action = notification.notify(
      notification.message,
      await this.getTierRelevantAction(paidMinutesLeft > 0),
    );
    this.setSnoozeTimeout(notification.notify);
    if (await action) {
      openColabSignup(this.vs);
    }
  }

  private buildNotification(totalMinutesLeft: number):
    | {
        message: string;
        notify: Notify;
      }
    | undefined {
    let notify: Notify;
    let message: string;

    // Completely ran out.
    if (totalMinutesLeft <= 0) {
      if (this.snoozeError) {
        return undefined;
      }
      message = "Colab Compute Units (CCU) depleted!";
      notify = this.vs.window.showErrorMessage;
    } else {
      // Close to running out.
      if (this.snoozeWarn) {
        return undefined;
      }
      message = `Low Colab Compute Units (CCU) balance! ${totalMinutesLeft.toString()} minutes left.`;
      notify = this.vs.window.showWarningMessage;
    }

    return { message, notify };
  }

  private async getTierRelevantAction(
    hasPaidBalance: boolean,
  ): Promise<SignupAction> {
    const tier = await this.colab.getSubscriptionTier();
    switch (tier) {
      case SubscriptionTier.NONE:
        return hasPaidBalance
          ? SignupAction.PURCHASE_MORE_CCU
          : SignupAction.SIGNUP_FOR_COLAB;
      case SubscriptionTier.PRO:
        return SignupAction.UPGRADE_TO_PRO_PLUS;
      case SubscriptionTier.PRO_PLUS:
        return SignupAction.PURCHASE_MORE_CCU;
    }
  }

  private setSnoozeTimeout(notifyType: Notify) {
    const snoozeMs = this.snoozeMinutes * 60 * 1000;

    if (notifyType === this.vs.window.showErrorMessage) {
      this.snoozeError = true;
      if (this.errorTimeout) {
        clearTimeout(this.errorTimeout);
      }
      this.errorTimeout = setTimeout(() => {
        this.snoozeError = false;
      }, snoozeMs);
    } else {
      this.snoozeWarn = true;
      if (this.warnTimeout) {
        clearTimeout(this.warnTimeout);
      }
      this.warnTimeout = setTimeout(() => {
        this.snoozeWarn = false;
      }, snoozeMs);
    }
  }
}

function calculateRoughMinutesLeft(ccuInfo: CcuInfo): number {
  const freeQuota = ccuInfo.freeCcuQuotaInfo;
  if (!freeQuota) {
    return 0;
  }
  // Free quota is in mill-CCUs.
  const freeCcu = freeQuota.remainingTokens / 1000;
  return Math.floor((freeCcu / ccuInfo.consumptionRateHourly) * 60);
}

enum SignupAction {
  SIGNUP_FOR_COLAB = "Sign Up for Colab",
  UPGRADE_TO_PRO_PLUS = "Upgrade to Pro+",
  PURCHASE_MORE_CCU = "Purchase More CCUs",
}
