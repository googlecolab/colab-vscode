/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { TimeoutError } from './task-runner';

/**
 * Number of poll intervals to sit out after a run of failures.
 *
 * @param failures - Consecutive failures so far, at least one.
 * @param maxIntervals - Maximum number of intervals to skip.
 * @returns The number of intervals to skip before trying again.
 */
export function calculateBackoffIntervals(
  failures: number,
  maxIntervals: number,
): number {
  const base = Math.min(2 ** (failures - 1), maxIntervals);
  const jittered = Math.round(base * (0.5 + Math.random()));
  return Math.min(Math.max(jittered, 1), maxIntervals);
}

/**
 * Reports whether a failed poll says anything about the network.
 *
 * The runner aborts polls it has superseded or disposed, which is routine. A
 * timeout is different: the request really is hanging and we should back off.
 *
 * @param signal - The signal the poll ran under.
 * @returns True when the failure should count towards the backoff.
 */
export function countsAsNetworkFailure(signal?: AbortSignal): boolean {
  return !signal?.aborted || signal.reason instanceof TimeoutError;
}
