/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { ColabClient } from './client';

/**
 * A client for interacting with Google Drive
 */
export class DriveProvider {
  constructor(private readonly colabClient: ColabClient) {}

  async getDriveFileName(fileId: string): Promise<string> {
    const metadata = await this.colabClient.getDriveFileMetadata(fileId);
    return metadata.name;
  }

  async getDriveFileContent(fileId: string): Promise<Uint8Array> {
    return this.colabClient.fetchDriveFileContent(fileId);
  }
}
