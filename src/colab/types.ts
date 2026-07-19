/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Common API types for interacting with Colab backend.
 */

export enum SubscriptionTier {
  NONE = 0,
  PRO = 1,
  PRO_PLUS = 2,
}

export enum Variant {
  DEFAULT = 'DEFAULT',
  GPU = 'GPU',
  TPU = 'TPU',
}

export enum Shape {
  STANDARD = 0,
  HIGHMEM = 1,
  // VERYHIGHMEM (2) is deprecated.
}
