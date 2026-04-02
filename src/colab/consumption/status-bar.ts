/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Disposable, Event, StatusBarItem } from 'vscode';
import { log } from '../../common/logging';
import { Toggleable } from '../../common/toggleable';
import { ConsumptionUserInfo, SubscriptionTier } from '../api';

/**
 * Monitors {@link ConsumptionUserInfo} and maintains a {@link StatusBarItem}.
 */
export class ConsumptionStatusBar implements Toggleable, Disposable {
  private readonly statusBarItem: StatusBarItem;
  private readonly consumptionListener: Disposable;
  private isDisposed = false;

  /**
   * Initializes a new instance.
   *
   * @param vs - The VS Code API instance.
   * @param onDidChangeCcuInfo - Event fired when CCU info changes.
   */
  constructor(
    private readonly vs: typeof vscode,
    onDidChangeCcuInfo: Event<ConsumptionUserInfo>,
  ) {
    this.statusBarItem = this.vs.window.createStatusBarItem(
      CONSUMPTION_STATUS_BAR_ID,
      vs.StatusBarAlignment.Right,
    );
    this.statusBarItem.name = 'Colab Status';
    this.consumptionListener = onDidChangeCcuInfo((e) => {
      this.updateStatusBarItem(e);
    });
    // TODO: Triggers a CCU pull on server assignment changes.
    // Better to be implemented in ConsumptionPoller.
  }

  /**
   * Disposes of {@link ConsumptionStatusBar}, cleaning up any resources.
   */
  dispose() {
    if (this.isDisposed) {
      return;
    }
    this.consumptionListener.dispose();
    this.statusBarItem.dispose();
    this.isDisposed = true;
  }

  /**
   * Shows the status bar item.
   */
  on(): void {
    this.guardDisposed();
    log.trace('Showing consumption status bar item.');
    this.statusBarItem.show();
  }

  /**
   * Hides the status bar item.
   */
  off(): void {
    this.guardDisposed();
    log.trace('Hiding consumption status bar item.');
    this.statusBarItem.hide();
  }

  private updateStatusBarItem(info: ConsumptionUserInfo) {
    log.trace('Updating consumption status bar item with:', info);

    const rate = info.consumptionRateHourly.toFixed(2);
    this.statusBarItem.text = `$(colab-logo) ${rate}/hr`;

    let tooltip: string;
    switch (info.subscriptionTier) {
      case SubscriptionTier.PRO:
        tooltip = 'You are subscribed to Colab Pro.';
        break;
      case SubscriptionTier.PRO_PLUS:
        tooltip = 'You are subscribed to Colab Pro+.';
        break;
      default:
        tooltip = 'You are not subscribed.';
    }

    if (info.paidComputeUnitsBalance <= 0) {
      tooltip +=
        '\n\nYou currently have zero compute units available. ' +
        'Resources offered free of charge are not guaranteed.';
      if (
        info.freeCcuQuotaInfo?.remainingTokens &&
        info.consumptionRateHourly > 0
      ) {
        const approxFreeMinutesRemaining =
          Math.floor(
            ((info.freeCcuQuotaInfo.remainingTokens /
              1000 /
              info.consumptionRateHourly) *
              60) /
              10,
          ) * 10; // Quantize into 10m.
        const hours = Math.floor(approxFreeMinutesRemaining / 60);
        const minutes = approxFreeMinutesRemaining % 60;
        tooltip +=
          '\n\nAt your current usage level, your server(s) may last up to ' +
          `${hours.toFixed(0)}h${minutes.toFixed(0)}m.`;
      }
    } else {
      const balance = info.paidComputeUnitsBalance.toFixed(2);
      const sessionCount = info.assignmentsCount.toFixed(0);
      tooltip += `

Available: ${balance} compute units
Usage rate: approximately ${rate} per hour
You have ${sessionCount} active session(s).`;
    }
    this.statusBarItem.tooltip = tooltip;
  }

  private guardDisposed() {
    if (this.isDisposed) {
      throw new Error(
        'Cannot use ConsumptionStatusBar after it has been disposed',
      );
    }
  }
}

const CONSUMPTION_STATUS_BAR_ID = 'colab.consumptionStatusBar';
