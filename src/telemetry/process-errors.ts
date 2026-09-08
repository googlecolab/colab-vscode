/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { InputFlowAction } from '../common/multi-step-quickpick';
import { telemetry } from '.';

/**
 * A set of error names that represent cancelled or abandoned work.
 *
 * These are normal control flow. E.g. a user dismissing a picker or a poll
 * being superseded. Errors with these names are not reported to the telemetry
 * service as they are not indicative of a problem with the extension.
 */
const CANCELLATION_ERROR_NAMES = new Set([
  'AbortError',
  'Canceled',
  'CancellationError',
]);

/**
 * Creates a process-level error handler that only logs errors originating from
 * the given extension path. This prevents capturing errors from other
 * extensions running in the same extension host process. Cancellations are
 * normal control flow and are never reported.
 *
 * @param extensionPath - The absolute filesystem path to the extension root.
 * @returns An error handler suitable for use with `process.on`.
 */
export function createProcessErrorHandler(
  extensionPath: string,
): (error: unknown) => void {
  return (error: unknown) => {
    if (!(error instanceof Error) || !error.stack) {
      return;
    }
    if (isCancellation(error)) {
      return;
    }
    if (error.stack.includes(extensionPath)) {
      telemetry.logError(error);
    }
  };
}

/**
 * Reports whether an error represents cancelled or abandoned work.
 *
 * @param error - The error to classify.
 * @returns True when the error is a cancellation, false otherwise.
 */
function isCancellation(error: Error): boolean {
  return (
    error instanceof InputFlowAction || CANCELLATION_ERROR_NAMES.has(error.name)
  );
}
