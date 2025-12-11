/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLevel, log, LogLevel } from '.';

/**
 * A decorator that traces the entry and exit (or error) of a method.
 */
export function traceMethod(
  target: object,
  propertyKey: string,
  descriptor: PropertyDescriptor,
): PropertyDescriptor {
  const originalMethod: unknown = descriptor.value;

  // Ensure the property is a function.
  if (typeof originalMethod !== 'function') {
    return descriptor;
  }

  // Wrap the original method.
  descriptor.value = function (this: unknown, ...args: unknown[]) {
    // Short-circuit if log level is not Trace.
    const currentLevel = getLevel();
    if (currentLevel === LogLevel.Off) {
      return originalMethod.apply(this, args) as unknown;
    }

    const className = target.constructor.name;
    const targetPrefix = `${className}.${propertyKey}`;

    try {
      log.trace(`${targetPrefix} called with`, ...args);
    } catch (err: unknown) {
      log.trace('Error in trace decorator (entry)', err);
    }

    let result: unknown;
    try {
      result = originalMethod.apply(this, args);
    } catch (error) {
      // Log synchronous errors.
      try {
        log.trace(`${targetPrefix} threw error (sync)`, error);
      } catch (e) {
        log.trace('Error in trace decorator (sync error)', e);
      }
      // Re-throw the original error.
      throw error;
    }

    // Chain logging the async result/error.
    if (isPromiseLike(result)) {
      log.trace(`${targetPrefix} returned a Promise`);
      return result.then(
        (resolvedValue: unknown) => {
          try {
            log.trace(
              `${targetPrefix} Promise resolved, args and error:`,
              ...args,
              resolvedValue,
            );
          } catch (e) {
            log.trace('Error in trace decorator (resolve)', e);
          }
          return resolvedValue;
        },
        (error: unknown) => {
          try {
            log.trace(
              `${targetPrefix} Promise rejected, args and error:`,
              ...args,
              error,
            );
          } catch (e) {
            log.trace('Error in trace decorator (reject)', e);
          }
          throw error;
        },
      );
    }

    // A sync result which can simply log and return.
    try {
      log.trace(`${targetPrefix} returned (sync)`, result);
    } catch (e) {
      log.trace('Error in trace decorator (sync return)', e);
    }
    return result;
  };

  return descriptor;
}

/**
 * Checks if an unknown value is {@link PromiseLike}.
 */
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
