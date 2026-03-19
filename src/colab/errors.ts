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
