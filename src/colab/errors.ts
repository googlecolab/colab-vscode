/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response } from 'node-fetch';

/**
 * Cap on the response body carried in an error message.
 *
 * Bodies can be entire HTML error pages, and the message is reported verbatim
 * to telemetry.
 */
const MAX_BODY_CHARS = 512;

/**
 * Drops the query string, which can carry notebook hashes and auth hints.
 *
 * @param url - The URL to redact.
 * @returns The URL without its query string.
 */
function redactUrl(url: string): string {
  return url.split(/[?#]/)[0];
}

/**
 * Shortens a response body for inclusion in an error message.
 *
 * @param body - The response body.
 * @returns The body, truncated if it exceeds {@link MAX_BODY_CHARS}.
 */
function truncate(body: string): string {
  return body.length <= MAX_BODY_CHARS
    ? body
    : `${body.slice(0, MAX_BODY_CHARS)}... (${String(body.length)} chars total)`;
}

/**
 * Wrapper for errors thrown from issuing requests.
 */
export class ColabRequestError extends Error {
  override name = 'ColabRequestError' as const;

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
      `Failed to issue request ${request.method} ${redactUrl(request.url)}: ${response.statusText}` +
        (responseBody ? `\nResponse body: ${truncate(responseBody)}` : ''),
    );
  }
}

/** Error thrown when the user has too many assignments. */
export class TooManyAssignmentsError extends Error {
  override name = 'TooManyAssignmentsError' as const;
}

/** Error thrown when the requested machine accelerator is unavailable. */
export class AcceleratorUnavailableError extends Error {
  override name = 'AcceleratorUnavailableError' as const;

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
export class DenylistedError extends Error {
  override name = 'DenylistedError' as const;
}

/** Error thrown when the user has insufficient quota. */
export class InsufficientQuotaError extends Error {
  override name = 'InsufficientQuotaError' as const;
}

/** Error thrown when the request resource cannot be found. */
export class NotFoundError extends Error {
  override name = 'NotFoundError' as const;
}

/** Error thrown when a long-running operation fails. */
export class LongRunningOperationError extends Error {
  override name = 'LongRunningOperationError' as const;

  /**
   * Initializes a new instance.
   *
   * @param operationName - Long-running operation name.
   * @param code - Status error code.
   * @param message - Status error message.
   * @param reason - Status error reason.
   */
  constructor(
    readonly operationName = 'unknown',
    readonly code = 0,
    message = '',
    readonly reason = 'UNKNOWN',
  ) {
    super(
      `Operation ${operationName} failed with error ${String(code)}: ${message} (reason: ${reason})`,
    );
  }
}

/** Error thrown when WaitOperation times out. */
export class WaitOperationTimeoutError extends Error {
  override name = 'WaitOperationTimeoutError' as const;

  /**
   * Initializes a new instance.
   *
   * @param operationId - Long-running operation ID.
   * @param timeout - Timeout duration.
   */
  constructor(
    readonly operationId: string,
    readonly timeout: string,
  ) {
    super(`Operation ${operationId} timed out after ${timeout}`);
  }
}
