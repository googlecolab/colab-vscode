/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * API types for interacting with Google Drive's APIs.
 */

import { z } from 'zod';

/**
 * Drive file metadata.
 *
 * This is a small subset of the full object that is returned.
 */
export const DriveFileMetadataSchema = z.object({
  name: z.string(),
});

/**
 * The type for Drive file metadata.
 */
export type DriveFileMetadata = z.infer<typeof DriveFileMetadataSchema>;
