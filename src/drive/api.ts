/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * API types for interacting with Google Drive's backends.
 */

import { z } from 'zod';

export const DriveFileMetadataSchema = z.object({
  name: z.string(),
});

export type DriveFileMetadata = z.infer<typeof DriveFileMetadataSchema>;
