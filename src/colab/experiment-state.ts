/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Disposable } from 'vscode';
import { log } from '../common/logging';
import { OverrunPolicy, SequentialTaskRunner } from '../common/task-runner';
import { Toggleable } from '../common/toggleable';
import {
  ExperimentFlag,
  ExperimentFlagValue,
  EXPERIMENT_FLAG_DEFAULT_VALUES,
} from './api';
import { ColabClient } from './client';

/**
 * Gets the value of an experiment flag.
 *
 * @param flag - The experiment flag to get.
 * @returns The value of the experiment flag.
 */
export function getFlag(flag: ExperimentFlag): ExperimentFlagValue {
  return flags.get(flag) ?? EXPERIMENT_FLAG_DEFAULT_VALUES[flag];
}

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes.
const REFRESH_TIMEOUT_MS = 30 * 1000; // 30 seconds.

/**
 * Provides experiment state information from the Colab backend.
 */
export class ExperimentStateProvider implements Toggleable, Disposable {
  private readonly refreshPoller: SequentialTaskRunner;
  private isAuthorized = false;
  private isDisposed = false;

  /**
   * Initializes a new instance.
   *
   * @param client - The API client instance.
   */
  constructor(private readonly client: ColabClient) {
    // Reset experiment flags.
    flags = new Map<ExperimentFlag, ExperimentFlagValue>();
    this.refreshPoller = new SequentialTaskRunner(
      {
        intervalTimeoutMs: REFRESH_INTERVAL_MS,
        taskTimeoutMs: REFRESH_TIMEOUT_MS,
        // Nothing to cleanup, abandon immediately.
        abandonGraceMs: 0,
      },
      {
        name: ExperimentStateProvider.name,
        run: async (signal: AbortSignal) => {
          await this.getExperimentState(this.isAuthorized, signal);
        },
      },
      OverrunPolicy.AbandonAndRun,
    );
  }

  /**
   * Disposes of the provider, cleaning up any resources.
   */
  dispose() {
    if (this.isDisposed) {
      return;
    }
    this.refreshPoller.dispose();
    this.isDisposed = true;
  }

  /**
   * Turns on experiment state polling.
   */
  on(): void {
    this.guardDisposed();
    this.isAuthorized = true;
    this.ensurePollingAndRunOnce();
  }

  /**
   * Turns off experiment state polling.
   */
  off(): void {
    this.guardDisposed();
    this.isAuthorized = false;
    this.ensurePollingAndRunOnce();
  }

  private ensurePollingAndRunOnce(): void {
    this.refreshPoller.start();
    this.refreshPoller.runNow();
  }

  private guardDisposed() {
    if (this.isDisposed) {
      throw new Error(
        'Cannot use ExperimentStateProvider after it has been disposed',
      );
    }
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
        log.trace(
          `Experiment state updated while ${requireAccessToken ? 'authorized' : 'not authorized'}:`,
          Object.fromEntries(flags),
        );
      }
    } catch (e: unknown) {
      log.error('Failed to update experiment state:', e);
    }
  }
}

/**
 * Sets the value of an experiment flag for testing.
 *
 * @param flag - The experiment flag name.
 * @param value - The input value.
 */
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
