/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, RequestInit, Response } from 'node-fetch';
import { z } from 'zod';

/**
 * Issues a fetch request and parses the JSON response body according to the
 * provided Zod schema.
 *
 * @param fetch - The fetch implementation to use for network requests.
 * @param url - The URL to fetch.
 * @param schema - The Zod schema to parse the response with.
 * @param init - The request init options.
 * @returns The parsed response.
 */
export async function fetchAndParseZod<T extends z.ZodType>(
  fetch: (url: string | Request, init?: RequestInit) => Promise<Response>,
  url: string | Request,
  schema: T,
  init?: RequestInit
): Promise<z.infer<T>> {
  const response = await fetch(url, init);
  const body = await response.text();
  return schema.parse(JSON.parse(body));
}
