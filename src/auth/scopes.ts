/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Minimum required scope set for assigning and using a Colab server */
export const REQUIRED_SCOPES = [
  'profile',
  'email',
  'https://www.googleapis.com/auth/colaboratory',
] as const;

/** Scopes required to use the Drive integration */
export const DRIVE_SCOPES = [
  ...REQUIRED_SCOPES,
  'https://www.googleapis.com/auth/drive.file',
] as const;

/** Set of all scopes that are permitted to be used by this extension */
export const ALLOWED_SCOPES: ReadonlySet<string> = new Set<string>([
  ...REQUIRED_SCOPES,
  ...DRIVE_SCOPES,
]);

/**
 * Returns true if the provided scopes are all supported.
 *
 * @param scopes - The scopes to check, or undefined if no scopes are provided.
 * @returns True if all provided scopes are allowed, false otherwise.
 */
export function areScopesAllowed(scopes?: readonly string[]): boolean {
  if (!scopes) return true;

  return scopes.every((scope) => ALLOWED_SCOPES.has(scope));
}
