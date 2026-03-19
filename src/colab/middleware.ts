/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { Request, RequestInit, Response } from 'node-fetch';
import { ColabRequestError } from './errors';
import { ACCEPT_JSON_HEADER, AUTHORIZATION_HEADER } from './headers';

/**
 * A middleware function for fetch requests. It takes a Request and a next
 * function, and returns a Promise of a Response. The next function should be
 * called with the (potentially modified) Request to continue the chain.
 *
 * @param request - The Request object for the current fetch.
 * @param next - A function that takes a Request and returns a Promise of a
 * Response. Call this to continue the middleware chain.
 * @returns A Promise that resolves to a Response.
 */
export type FetchMiddleware = (
  request: Request,
  next: (req: Request) => Promise<Response>,
) => Promise<Response>;

/**
 * Builds a fetch chain from a list of middlewares and a base fetch function.
 *
 * @param middlewares - The middlewares to compose.
 * @param baseFetch - The base fetch function.
 * @returns A composed fetch function.
 */
export function buildFetchChain(
  middlewares: FetchMiddleware[],
  baseFetch: (url: string | Request, init?: RequestInit) => Promise<Response>,
): (url: string | Request, init?: RequestInit) => Promise<Response> {
  return async (url: string | Request, init?: RequestInit) => {
    const initialRequest = new Request(url, init);

    const dispatch = async (index: number, req: Request): Promise<Response> => {
      if (index === middlewares.length) {
        return baseFetch(req);
      }
      return middlewares[index](req, (nextReq) => dispatch(index + 1, nextReq));
    };

    return dispatch(0, initialRequest);
  };
}

/**
 * Creates a middleware that adds the Accept header for JSON.
 *
 * @returns A FetchMiddleware.
 */
export function createAcceptJsonMiddleware(): FetchMiddleware {
  return async (req, next) => {
    req.headers.set(ACCEPT_JSON_HEADER.key, ACCEPT_JSON_HEADER.value);
    return next(req);
  };
}

/**
 * Creates a middleware that handles and throws ColabRequestErrors for
 * non-ok responses.
 *
 * @returns A FetchMiddleware.
 */
export function createErrorMiddleware(): FetchMiddleware {
  return async (req, next) => {
    const response = await next(req);
    if (!response.ok) {
      let errorBody;
      try {
        errorBody = await response.text();
      } catch {
        // Ignore errors reading the body
      }
      throw new ColabRequestError(req, response, errorBody);
    }
    return response;
  };
}

/**
 * Creates a middleware that adds an authorization header and handles 401s.
 *
 * @param getAccessToken - The function to get the access token.
 * @param onAuthError - The callback to invoke when an authentication error
 * occurs.
 * @returns A FetchMiddleware.
 */
export function createAuthMiddleware(
  getAccessToken: () => Promise<string>,
  onAuthError?: () => Promise<void>,
): FetchMiddleware {
  return async (req, next) => {
    // Attempt 1
    const clonedReq1 = req.clone();
    const token1 = await getAccessToken();
    clonedReq1.headers.set(AUTHORIZATION_HEADER.key, `Bearer ${token1}`);
    const response1 = await next(clonedReq1);

    if (response1.status === 401 && onAuthError) {
      await onAuthError();
      // Attempt 2
      const clonedReq2 = req.clone();
      const token2 = await getAccessToken();
      clonedReq2.headers.set(AUTHORIZATION_HEADER.key, `Bearer ${token2}`);
      return next(clonedReq2);
    }

    return response1;
  };
}
