/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { isPromiseLike } from '../common/async';
import { telemetry } from '.';

/**
 * A decorator that wraps a method with error tracking.
 *
 * @param _target - The target object.
 * @param _propertyKey - The property key.
 * @param descriptor - The property descriptor.
 * @returns The modified property descriptor with error tracking applied to the
 * method.
 */
export function trackErrors<
  T extends (...args: Parameters<T>) => ReturnType<T>,
>(
  _target: object,
  _propertyKey: string,
  descriptor: TypedPropertyDescriptor<T>,
): TypedPropertyDescriptor<T> {
  const originalMethod = descriptor.value;

  // Ensure the property is a function.
  if (typeof originalMethod !== 'function') {
    return descriptor;
  }

  descriptor.value = withErrorTracking(originalMethod);
  return descriptor;
}

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
