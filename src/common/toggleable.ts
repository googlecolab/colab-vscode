/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * An entity which can be turned "on" and "off".
 */
export interface Toggleable {
  /**
   * Turn on the toggle.
   */
  on(): void;

  /**
   * Turn off the toggle.
   */
  off(): void;
}
