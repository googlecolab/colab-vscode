/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { isPromiseLike } from '../common/async';
import { telemetry } from '.';

/**
 * A higher-order function that wraps a target function to log uncaught errors,
 * supporting both sync and async execution.
 *
 * @param fn - The function to wrap with error tracking.
 * @returns A new function that wraps the original function with error tracking.
 */
export function withErrorTracking<
  T extends (...args: Parameters<T>) => ReturnType<T>,
>(fn: T): T {
  return function (this: unknown, ...args: Parameters<T>): ReturnType<T> {
    let result: ReturnType<T>;
    try {
      result = fn.apply(this, args);
    } catch (error: unknown) {
      telemetry.logError(error);
      throw error;
    }

    if (isPromiseLike(result)) {
      return Promise.resolve(result).catch((error: unknown) => {
        telemetry.logError(error);
        throw error;
      }) as ReturnType<T>;
    }

    return result;
  } as T;
}
