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

/**
 * Monitors Colab Compute Units (CCU) balance and consumption rate, notifying
 * the user when their CCU-s are depleted or running low.
 */
export class ConsumptionNotifier implements vscode.Disposable {
  private ccuListener: vscode.Disposable;

  constructor(
    private readonly vs: typeof vscode,
    private readonly colab: ColabClient,
    onDidChangeCcuInfo: vscode.Event<CcuInfo>,
  ) {
    this.ccuListener = onDidChangeCcuInfo((e) => this.notifyCcuConsumption(e));
  }

  dispose() {
    this.ccuListener.dispose();
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

    let notify:
      | typeof vscode.window.showErrorMessage
      | typeof vscode.window.showWarningMessage;
    let message: string;

    // Completely ran out.
    if (totalMinutesLeft <= 0) {
      message = "Colab Compute Units (CCU) depleted!";
      notify = this.vs.window.showErrorMessage;
    } else {
      // Close to running out.
      message = `Low Colab Compute Units (CCU) balance! ${totalMinutesLeft.toString()} minutes left.`;
      notify = this.vs.window.showWarningMessage;
    }

    const tier = await this.colab.getSubscriptionTier();
    const action = await notify(
      message,
      getTierRelevantAction(tier, paidMinutesLeft > 0),
    );
    if (action) {
      openColabSignup(this.vs);
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

function getTierRelevantAction(
  t: SubscriptionTier,
  hasPaidBalance: boolean,
): SignupAction {
  switch (t) {
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
