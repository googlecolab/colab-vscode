/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { telemetry } from '.';

/**
 * Creates a process-level error handler that only logs errors originating from
 * the given extension path. This prevents capturing errors from other
 * extensions running in the same extension host process.
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
    if (error.stack.includes(extensionPath)) {
      telemetry.logError(error);
    }
  };
}
