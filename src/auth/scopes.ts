/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Minimum required scope set for executing a runtime */
export const REQUIRED_SCOPES = [
  'profile',
  'email',
  'https://www.googleapis.com/auth/colaboratory',
] as const;

/** Scopes required to use the drive integration */
export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
] as const;

/** Set of all scopes that are permitted to be used by this extension */
export const ALLOWED_SCOPES = new Set<string>([
  ...REQUIRED_SCOPES,
  ...DRIVE_SCOPES,
]);

/** Returns true if the provided scopes are all supported */
export function areScopesAllowed(scopes?: readonly string[]): boolean {
  if (!scopes) return true;

  return scopes.every((scope) => ALLOWED_SCOPES.has(scope));
}

/** Function to check if scopesToCheck has AT LEAST every scope in scopes */
export function hasScopes(
  scopesToCheck: readonly string[],
  scopes: readonly string[],
): boolean {
  return scopes.every((r) => scopesToCheck.includes(r));
}

export function matchesRequiredScopes(scopes: readonly string[]): boolean {
  return (
    scopes.length === REQUIRED_SCOPES.length &&
    REQUIRED_SCOPES.every((r) => scopes.includes(r))
  );
}

export function upgradeScopes(scopes: readonly string[]): string[] {
  return Array.from(new Set([...scopes, ...REQUIRED_SCOPES]).values());
}
