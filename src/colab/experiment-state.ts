/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from 'vscode';
import { log } from '../common/logging';
import { AsyncToggle } from '../common/toggleable';
import {
  ExperimentFlag,
  ExperimentFlagValue,
  EXPERIMENT_FLAG_DEFAULT_VALUES,
} from './api';
import { ColabClient } from './client';

/** Gets the value of an experiment flag.
 *
 * @param flag - The experiment flag to get.
 * @returns The value of the experiment flag.
 */
export function getFlag(flag: ExperimentFlag): ExperimentFlagValue {
  return flags.get(flag) ?? EXPERIMENT_FLAG_DEFAULT_VALUES[flag];
}

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 10 minutes.

/**
 * Provides experiment state information from the Colab backend.
 */
export class ExperimentStateProvider
  extends AsyncToggle
  implements vscode.Disposable
{
  private isAuthorized = false;
  private refreshInterval?: NodeJS.Timeout;
  private isDisposed = false;

  constructor(private readonly client: ColabClient) {
    super();
    // Reset experiment flags.
    flags = new Map<ExperimentFlag, ExperimentFlagValue>();
    this.getExperimentState = this.getExperimentState.bind(this);
  }

  dispose() {
    this.isDisposed = true;
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }
  }

  /** Called when user is authorized */
  protected override async turnOn(signal: AbortSignal): Promise<void> {
    this.isAuthorized = true;
    await this.getExperimentState(this.isAuthorized, signal);
    this.ensurePolling();
  }

  /** Called when user is un-authorized */
  protected override async turnOff(signal: AbortSignal): Promise<void> {
    this.isAuthorized = false;
    await this.getExperimentState(this.isAuthorized, signal);
    this.ensurePolling();
  }

  private ensurePolling() {
    if (this.isDisposed || this.refreshInterval) {
      return;
    }
    this.refreshInterval = setInterval(() => {
      void this.getExperimentState(this.isAuthorized);
    }, REFRESH_INTERVAL_MS);
  }

  private async getExperimentState(
    requireAccessToken: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      const result = await this.client.getExperimentState(
        requireAccessToken,
        signal,
      );
      if (result.experiments) {
        flags = result.experiments;
        log.trace('Experiment state updated:', Object.fromEntries(flags));
      }
    } catch (e: unknown) {
      log.error('Failed to update experiment state:', e);
    }
  }
}

/** Sets the value of an experiment flag for testing. */
function setFlagForTest(
  flag: ExperimentFlag,
  value: ExperimentFlagValue,
): void {
  const newFlags = new Map(flags);
  newFlags.set(flag, value);
  flags = newFlags;
}

/** Resets the experiment flags for testing. */
function resetFlagsForTest(): void {
  flags = new Map();
}

let flags: ReadonlyMap<ExperimentFlag, ExperimentFlagValue> = new Map<
  ExperimentFlag,
  ExperimentFlagValue
>();

export const TEST_ONLY = {
  setFlagForTest,
  resetFlagsForTest,
  REFRESH_INTERVAL_MS,
};
