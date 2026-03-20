/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import * as https from 'https';
import fetch, { Headers, Request, RequestInit, Response } from 'node-fetch';
import { z } from 'zod';
import { ACCEPT_JSON_HEADER, AUTHORIZATION_HEADER } from './headers';

/**
 * Options for the issueRequest methods
 */
export interface IssueRequestOptions {
  /** Whether or not to include the access token in the request. Defaults to true. */
  requireAccessToken?: boolean;
}

const XSSI_PREFIX = ")]}'\n";

/**
 * A reusable request transporter that handles authentication, common headers,
 * retries, and schema validation.
 */
export class Transport {
  /**
   * Initializes a new instance.
   *
   * @param getAccessToken - Function to retrieve the access token.
   * @param onAuthError - Callback invoked on authentication error.
   * @param httpsAgent - HttpAgent to make the request.
   */
  constructor(
    private readonly getAccessToken: () => Promise<string>,
    private readonly onAuthError?: () => Promise<void>,
    private readonly httpsAgent?: https.Agent,
  ) {}

  /**
   * Issues a request to the given endpoint, adding the necessary headers and
   * handling errors.
   *
   * @param endpoint - The endpoint to issue the request to.
   * @param init - The request init to use for the fetch.
   * @param options - The additional options for the request.
   * @returns A promise that resolves when the request is complete.
   */
  async issueRequest(
    endpoint: URL,
    init: RequestInit,
    options?: IssueRequestOptions,
  ): Promise<void> {
    await this.performFetch(endpoint, init, options);
  }

  /**
   * Issues a request to the given endpoint, adding the necessary headers and
   * handling errors and parses the response to the provided schema.
   *
   * @param endpoint - The endpoint to issue the request to.
   * @param init - The request init to use for the fetch.
   * @param schema - The schema to validate the response against.
   * @param options - The additional options for the request.
   * @returns A promise that resolves the parsed response when the request is
   * complete.
   */
  async issueRequestAndParse<T extends z.ZodType>(
    endpoint: URL,
    init: RequestInit,
    schema: T,
    options?: IssueRequestOptions,
  ): Promise<z.infer<T>> {
    const response = await this.performFetch(endpoint, init, options);
    const body = await response.text();
    return schema.parse(JSON.parse(stripXssiPrefix(body)));
  }

  private async performFetch(
    endpoint: URL,
    init: RequestInit,
    { requireAccessToken = true }: IssueRequestOptions = {},
  ): Promise<Response> {
    let response: Response | undefined;
    let request: Request | undefined;
    const requestHeaders = new Headers(init.headers);
    requestHeaders.set(ACCEPT_JSON_HEADER.key, ACCEPT_JSON_HEADER.value);

    // Make up to 2 attempts to issue the request in case of an
    // authentication error i.e. if the first attempt fails with a 401,
    for (let attempt = 0; attempt < 2; attempt++) {
      if (requireAccessToken) {
        const token = await this.getAccessToken();
        requestHeaders.set(AUTHORIZATION_HEADER.key, `Bearer ${token}`);
      }

      request = new Request(endpoint, {
        ...init,
        headers: requestHeaders,
        agent: this.httpsAgent,
      });
      response = await fetch(request);
      if (response.ok) {
        break;
      }

      // If it's a 401 and we have an auth error handler, try to recover.
      // But don't retry if this is already our last attempt.
      if (response.status === 401 && this.onAuthError && attempt < 1) {
        await this.onAuthError();
      } else {
        break;
      }
    }

    if (!response || !request) {
      throw new Error('Request failed to execute.');
    }

    if (!response.ok) {
      let errorBody;
      try {
        errorBody = await response.text();
      } catch {
        // Ignore errors reading the body
      }
      throw new ColabRequestError(request, response, errorBody);
    }

    return response;
  }
}

/**
 * Strips the XSSI prefix from the provided string.
 *
 * @param s - A string that may or may not start with the XSSI prefix.
 * @returns The input string with the XSSI prefix removed, if it was present.
 * Otherwise, returns the input string unchanged.
 */
function stripXssiPrefix(s: string): string {
  if (!s.startsWith(XSSI_PREFIX)) {
    return s;
  }
  return s.slice(XSSI_PREFIX.length);
}

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
    readonly request: fetch.Request,
    readonly response: fetch.Response,
    readonly responseBody?: string,
  ) {
    super(
      `Failed to issue request ${request.method} ${request.url}: ${response.statusText}` +
        (responseBody ? `\nResponse body: ${responseBody}` : ''),
    );
  }
}
