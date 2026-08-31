/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { UUID } from 'crypto';

/**
 * Type guard to check if a value is a valid UUID. Ensures the string follows
 * the UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 *
 * @param value - The value to check.
 * @returns True if the value is a valid UUID, otherwise false.
 */
export function isUUID(value: string): value is UUID {
  const uuidRegex =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  return uuidRegex.test(value);
}
