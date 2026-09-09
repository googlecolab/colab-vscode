/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Error names that mark work as abandoned rather than broken.
 *
 * `AbortError` comes from {@link AbortSignal}, `Canceled` is the name
 * `vscode.CancellationError` carries at runtime, `CancellationError` is that
 * same class' modern name (and the name {@link UserCancelledError} adopts), and
 * `InputFlowAction` is raised when a multi-step quick pick is dismissed.
 *
 * Matching on the name rather than the class keeps this check free of any
 * runtime dependency on the `vscode` module.
 */
const CANCELLATION_ERROR_NAMES: ReadonlySet<string> = new Set([
  'AbortError',
  'Canceled',
  'CancellationError',
  'InputFlowAction',
]);

/**
 * An error signalling that the user deliberately abandoned an operation.
 */
export class UserCancelledError extends Error {
  /**
   * Reported to telemetry as the error name, and recognized by
   * {@link isCancellation}. Deliberately matches `vscode.CancellationError` so
   * one check classifies both.
   */
  override name = 'CancellationError' as const;
}

/**
 * Reports whether an error represents cancelled or abandoned work.
 *
 * @param err - The error to classify.
 * @returns True when the error is a cancellation, false otherwise.
 */
export function isCancellation(err: unknown): boolean {
  return err instanceof Error && CANCELLATION_ERROR_NAMES.has(err.name);
}
