/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fetch, { Request, RequestInit, Response } from 'node-fetch';
import { z } from 'zod';
import { DriveFileMetadata, DriveFileMetadataSchema } from './api';
import { fetchAndParse } from './fetch-utils';
import {
  buildFetchChain,
  createAcceptJsonMiddleware,
  createAuthMiddleware,
  createErrorMiddleware,
} from './middleware';

const FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';

/**
 * A client for interacting with the Google Drive API
 */
export class DriveClient {
  /**
   * Creates a new instance of DriveClient.
   *
   * @param getAccessToken - Function to retrieve the access token.
   * @param onAuthError - Callback when an auth error occurs.
   * @returns A new ColabClient instance.
   */
  static create(
    getAccessToken: () => Promise<string>,
    onAuthError: (() => Promise<void>) | undefined,
  ): DriveClient {
    return new DriveClient(
      buildFetchChain(
        [
          createAcceptJsonMiddleware(),
          createErrorMiddleware(),
          createAuthMiddleware(getAccessToken, onAuthError),
        ],
        fetch,
      ),
    );
  }

  private constructor(
    private readonly fetch: (
      url: string | Request,
      init?: RequestInit,
    ) => Promise<Response>,
  ) {}

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
    const encoder = new TextEncoder();
    const url = new URL(`${FILES_ENDPOINT}/${fileId}?alt=media`);
    const response = await fetchAndParse(
      this.fetch,
      url.toString(),
      z.unknown(),
      { method: 'GET', signal },
    );

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

    return fetchAndParse(this.fetch, url.toString(), DriveFileMetadataSchema, {
      method: 'GET',
      signal,
    });
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
