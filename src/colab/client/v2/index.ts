/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { log } from '../../../common/logging';
import { telemetry } from '../../../telemetry';
import { AUTHORIZATION_HEADER, COLAB_CLIENT_AGENT_HEADER } from '../../headers';
import { SubscriptionTier as CommonSubscriptionTier } from '../../types';
import {
  ColaboratoryApi,
  Configuration as ColabConfig,
  ErrorContext,
  FetchParams,
  Middleware,
  RequestContext,
  ResponseContext,
  SubscriptionTier,
} from './generated/colab';
import {
  ColaboratoryApi as OperationsApi,
  Configuration as OperationsConfig,
} from './generated/operations';

/** A client to interact with public Colab API. */
export interface ColabApiClient {
  /**
   * A client instance to access the Colab APIs
   */
  colab: ColaboratoryApi;

  /**
   * A client instance to access the Operations APIs.
   */
  operations: OperationsApi;
}

/**
 * Creates a new {@link ColabApiClient} instance.
 *
 * @param basePath - Base URL for Colab API.
 * @param getAccessToken - Function to retrieve access token.
 * @param onAuthError - Optional function to handle authentication errors.
 * @returns A new {@link ColabApiClient} instance.
 */
export function createColabApiClient(
  basePath: string,
  getAccessToken: () => Promise<string>,
  onAuthError?: () => Promise<void>,
): ColabApiClient {
  return new ColabApiClientImpl(basePath, getAccessToken, onAuthError);
}

/**
 * Normalizes the API {@link SubscriptionTier} to the common
 * {@link CommonSubscriptionTier}.
 *
 * @param tier - Subscription tier returned from public Colab API.
 * @returns Normalized common subscription tier value.
 */
export function normalizeSubscriptionTier(
  tier?: SubscriptionTier,
): CommonSubscriptionTier {
  if (!tier) {
    throw new Error('Subscription tier is undefined');
  }

  switch (tier) {
    case SubscriptionTier.SubscriptionTierFree:
      return CommonSubscriptionTier.NONE;
    case SubscriptionTier.SubscriptionTierPro:
      return CommonSubscriptionTier.PRO;
    case SubscriptionTier.SubscriptionTierProPlus:
      return CommonSubscriptionTier.PRO_PLUS;
    default:
      throw new Error(`Unknown subscription tier: ${tier}`);
  }
}

class ColabApiClientImpl implements ColabApiClient {
  private readonly colabApi: ColaboratoryApi;
  private readonly operationsApi: OperationsApi;

  constructor(
    basePath: string,
    getAccessToken: () => Promise<string>,
    onAuthError?: () => Promise<void>,
  ) {
    const middleware = [
      new AuthMiddleware(getAccessToken),
      new ErrorMiddleware(onAuthError),
    ];
    this.colabApi = new ColaboratoryApi(
      new ColabConfig({ basePath, headers: HEADERS, middleware }),
    );
    this.operationsApi = new OperationsApi(
      new OperationsConfig({ basePath, headers: HEADERS, middleware }),
    );
  }

  get colab() {
    return this.colabApi;
  }

  get operations() {
    return this.operationsApi;
  }
}

const HEADERS = {
  [COLAB_CLIENT_AGENT_HEADER.key]: COLAB_CLIENT_AGENT_HEADER.value,
} as const;

class AuthMiddleware implements Middleware {
  constructor(private readonly getAccessToken: () => Promise<string>) {}

  async pre(context: RequestContext): Promise<FetchParams> {
    const headers = new Headers(context.init.headers);
    const token = await this.getAccessToken();
    if (token) {
      headers.set(AUTHORIZATION_HEADER.key, `Bearer ${token}`);
      context.init.headers = headers;
    }
    return context;
  }
}

class ErrorMiddleware implements Middleware {
  constructor(private readonly onAuthError?: () => Promise<void>) {}

  async post(context: ResponseContext): Promise<void> {
    if (!context.response.ok) {
      if (context.response.status === 401 && this.onAuthError) {
        await this.onAuthError();
      }
      telemetry.logError(context.response);
      log.warn(
        `Error response received by ${context.init.method ?? ''} ${context.url}:`,
        context.response,
      );
    }
  }

  onError(context: ErrorContext): Promise<void> {
    telemetry.logError(context.error);
    log.error(
      `Error thrown during request ${context.init.method ?? ''} ${context.url}:`,
      context.error,
    );
    return Promise.resolve();
  }
}
