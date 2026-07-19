/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response } from 'node-fetch';

/**
 * Wrapper for errors thrown from issuing requests.
 */
export class ColabRequestError extends Error {
  /**
   * Initializes a new instance
   *
   * @param request - The request that triggered the error
   * @param response - The response that contains the error
   * @param responseBody - The text from the body of the response, if available.
   */
  constructor(
    readonly request: Request,
    readonly response: Response,
    readonly responseBody?: string,
  ) {
    super(
      `Failed to issue request ${request.method} ${request.url}: ${response.statusText}` +
        (responseBody ? `\nResponse body: ${responseBody}` : ''),
    );
  }
}

/** Error thrown when the user has too many assignments. */
export class TooManyAssignmentsError extends Error {}

/** Error thrown when the requested machine accelerator is unavailable. */
export class AcceleratorUnavailableError extends Error {
  /**
   * Initializes a new instance.
   *
   * @param requested - The name of the requested accelerator.
   */
  constructor(readonly requested: string) {
    super(`Requested accelerator "${requested}" is unavailable`);
  }
}

/** Error thrown when the user has been denylisted. */
export class DenylistedError extends Error {}

/** Error thrown when the user has insufficient quota. */
export class InsufficientQuotaError extends Error {}

/** Error thrown when the request resource cannot be found. */
export class NotFoundError extends Error {}
