/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { log } from '../../../common/logging';
import { telemetry } from '../../../telemetry';
import { AUTHORIZATION_HEADER, COLAB_CLIENT_AGENT_HEADER } from '../../headers';
import {
  ColaboratoryApi,
  Configuration as ColabConfig,
  ErrorContext,
  FetchParams,
  Key,
  Middleware,
  RequestContext,
  ResponseContext,
} from './generated/colab';
import {
  ColaboratoryApi as OperationsApi,
  Configuration as OperationsConfig,
} from './generated/operations';

/** A client to interact with public Colab API. */
export class ColabApiClient {
  private readonly colabApi: ColaboratoryApi;
  private readonly operationsApi: OperationsApi;

  /**
   * Creates a new ColabApiClient instance.
   *
   * @param basePath - Base URL for Colab API.
   * @param getAccessToken - Function to retrieve access token.
   * @param onAuthError - Optional function to handle authentication errors.
   */
  constructor(
    basePath: string,
    getAccessToken: () => Promise<string>,
    onAuthError?: () => Promise<void>,
  ) {
    const headers = {
      [COLAB_CLIENT_AGENT_HEADER.key]: COLAB_CLIENT_AGENT_HEADER.value,
    };
    const middleware = [
      new AuthMiddleware(getAccessToken),
      new ErrorMiddleware(onAuthError),
    ];
    this.colabApi = new ColaboratoryApi(
      new ColabConfig({ basePath, headers, middleware }),
    );
    this.operationsApi = new OperationsApi(
      new OperationsConfig({ basePath, headers, middleware }),
    );
  }

  /**
   * Gets the Subscription API.
   *
   * @returns Subscription API.
   */
  get subscription() {
    return {
      get: () => this.colabApi.getSubscription(),
    };
  }

  /**
   * Gets the RuntimeSpecs API.
   *
   * @returns RuntimeSpecs API.
   */
  get runtimeSpecs() {
    return {
      list: async () => {
        const response = await this.colabApi.listRuntimeSpecs();
        return response.runtimeSpecs ?? [];
      },
    };
  }

  /**
   * Gets the Runtimes API.
   *
   * @returns Runtimes API.
   */
  get runtimes() {
    return {
      get: (id: string) => this.colabApi.getRuntime({ runtime: id }),
      list: async () => {
        const response = await this.colabApi.listRuntimes();
        return response.runtimes ?? [];
      },
      create: (runtimeSpec: Key, runtimeId?: string, requestId?: string) =>
        this.colabApi.createRuntime({
          runtime: { runtimeSpec },
          runtimeId,
          requestId,
        }),
      delete: (id: string) => this.colabApi.deleteRuntime({ runtime: id }),
    };
  }

  /**
   * Gets the Operations API.
   *
   * @returns Operations API.
   */
  get operations() {
    return {
      get: (id: string) =>
        this.operationsApi.getOperation({ operationsId: id }),
    };
  }
}

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
