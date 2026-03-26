/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fetch, { Request, RequestInit, Response } from 'node-fetch';
import { fetchAndParse } from '../common/fetch-utils';
import {
  buildFetchChain,
  createAcceptJsonMiddleware,
  createAuthMiddleware,
  createErrorMiddleware,
} from '../common/middleware';
import { DriveFileMetadata, DriveFileMetadataSchema } from './api';

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
   * @returns A new DriveClient instance.
   */
  static create(
    getAccessToken: () => Promise<string>,
    onAuthError: (() => Promise<void>) | undefined,
  ): DriveClient {
    const baseMiddleware = [
      createErrorMiddleware(),
      createAuthMiddleware(getAccessToken, onAuthError),
    ];
    const jsonMiddleware = [...baseMiddleware, createAcceptJsonMiddleware()];
    const blobFetch = buildFetchChain(baseMiddleware, fetch);
    const jsonFetch = buildFetchChain(jsonMiddleware, fetch);
    return new DriveClient(blobFetch, jsonFetch);
  }

  private constructor(
    private readonly blobFetch: (
      url: string | Request,
      init?: RequestInit,
    ) => Promise<Response>,
    private readonly jsonFetch: (
      url: string | Request,
      init?: RequestInit,
    ) => Promise<Response>,
  ) {}

  /**
   * Retrieves the content of a file from Google Drive.
   *
   * TODO: Convert to a stream to better support larger files as
   * response.arrayBuffer() loads the entire file into memory at once.
   * The tricky part here is that VsCode Web does not accept streams.
   *
   * @param fileId - The ID of the Drive file.
   * @param signal - Optional {@link AbortSignal} to cancel the request.
   * @returns A promise that resolves to the file content as a Uint8Array.
   */
  async getDriveFileContent(
    fileId: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const url = new URL(`${FILES_ENDPOINT}/${fileId}?alt=media`);
    const response = await this.blobFetch(url.toString(), {
      method: 'GET',
      signal,
    });

    return new Uint8Array(await response.arrayBuffer());
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

  /**
   * Retrieves the metadata for a file from Google Drive.
   *
   * @param id - The ID of the Drive file.
   * @param signal - Optional {@link AbortSignal} to cancel the request.
   * @returns A promise that resolves to the file metadata.
   */
  private async getDriveFileMetadata(
    id: string,
    signal?: AbortSignal,
  ): Promise<DriveFileMetadata> {
    const url = new URL(`${FILES_ENDPOINT}/${id}`);
    url.searchParams.append('fields', 'name');

    return fetchAndParse(
      this.jsonFetch,
      url.toString(),
      DriveFileMetadataSchema,
      {
        method: 'GET',
        signal,
      },
    );
  }
}
