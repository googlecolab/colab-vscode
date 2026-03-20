/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';
import { DRIVE_SCOPES } from '../auth/scopes';
import { DriveFileMetadata, DriveFileMetadataSchema } from './api';
import { Transport } from './transport';

const FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';

/**
 * A client for interacting with the Google Drive API
 */
export class DriveClient {
  /**
   * Initializes a new instance.
   *
   * @param transport - The transport layer used to issue network requests.
   */
  constructor(private readonly transport: Transport) {}

  /**
   * Retrieves the content of a file from Google Drive.
   *
   * @param fileId - The ID of the Drive file.
   * @param signal - Optional {@link AbortSignal} to cancel the request.
   * @returns A promise that resolves to the file content as a Uint8Array.
   */
  async getDriveFileContent(
    fileId: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const response = await this.transport.issueRequestAndParse(
      new URL(`${FILES_ENDPOINT}/${fileId}?alt=media`),
      { method: 'GET', signal },
      z.unknown(),
      { scopes: DRIVE_SCOPES },
    );
    const encoder = new TextEncoder();
    return encoder.encode(JSON.stringify(response));
  }

  /**
   * Retrieves the metadata for a file from Google Drive.
   *
   * @param id - The ID of the Drive file.
   * @param signal - Optional {@link AbortSignal} to cancel the request.
   * @returns A promise that resolves to the file metadata.
   */
  async getDriveFileMetadata(
    id: string,
    signal?: AbortSignal,
  ): Promise<DriveFileMetadata> {
    const url = new URL(`${FILES_ENDPOINT}/${id}`);
    url.searchParams.append('fields', 'name');

    const response = await this.transport.issueRequestAndParse(
      url,
      { method: 'GET', signal },
      DriveFileMetadataSchema,
      { scopes: DRIVE_SCOPES },
    );
    return response;
  }

  /**
   * Retrieves the name of a file from Google Drive.
   *
   * @param fileId - The ID of the Drive file.
   * @param signal - Optional {@link AbortSignal} to cancel the request.
   * @returns A promise that resolves to the file name.
   */
  async getDriveFileName(
    fileId: string,
    signal?: AbortSignal,
  ): Promise<string> {
    return (await this.getDriveFileMetadata(fileId, signal)).name;
  }
}
