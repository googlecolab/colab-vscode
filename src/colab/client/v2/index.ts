/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'assert';
import createClient, { Middleware } from 'openapi-fetch';
import { log } from '../../../common/logging';
import { telemetry } from '../../../telemetry';
import { ColabRequestError } from '../../errors';
import { AUTHORIZATION_HEADER, COLAB_CLIENT_AGENT_HEADER } from '../../headers';
import type {
  paths as colabPaths,
  components as colabComponents,
} from './generated/colab-schema';
import type {
  paths as operationsPaths,
  components as operationsComponents,
} from './generated/operations-schema';

/** Colab public API client. */
export interface ColabApiClient {
  /** Subscription API. */
  readonly subscription: {
    get: () => Promise<colabComponents['schemas']['Subscription']>;
  };

  /** Runtime Specs API. */
  readonly runtimespecs: {
    list: () => Promise<colabComponents['schemas']['RuntimeSpec'][]>;
  };

  /** Runtimes API. */
  readonly runtimes: {
    get: (id: string) => Promise<colabComponents['schemas']['Runtime']>;
    list: () => Promise<colabComponents['schemas']['Runtime'][]>;
    create: (
      spec: colabComponents['schemas']['Key'],
      runtimeId?: string,
      requestId?: string,
    ) => Promise<colabComponents['schemas']['CreateRuntimeOperation']>;
    delete: (id: string) => Promise<void>;
  };

  /** Operations API. */
  readonly operations: {
    get: (id: string) => Promise<operationsComponents['schemas']['Operation']>;
  };
}

/** A client for interacting with the Colab API. */
class ColabApiClientImpl implements ColabApiClient {
  private readonly colabClient: createClient.Client<colabPaths>;
  private readonly operationsClient: createClient.Client<operationsPaths>;

  /**
   * Creates a new ColabApiClient instance.
   *
   * @param baseUrl - Base URL for Colab API.
   * @param getAccessToken - Function to retrieve access token.
   * @param onAuthError - Optional function to handle authentication errors.
   */
  constructor(
    baseUrl: string,
    getAccessToken: () => Promise<string>,
    onAuthError?: () => Promise<void>,
  ) {
    const authMiddleware = getAuthMiddleware(getAccessToken);
    const errorHandlingMiddleware = getErrorHandlingMiddleware(onAuthError);

    this.colabClient = createClient<colabPaths>({ baseUrl });
    this.colabClient.use(
      authMiddleware,
      customHeadersMiddleware,
      errorHandlingMiddleware,
    );

    this.operationsClient = createClient<operationsPaths>({ baseUrl });
    this.operationsClient.use(
      authMiddleware,
      customHeadersMiddleware,
      errorHandlingMiddleware,
    );
  }

  get subscription() {
    return {
      get: async() => {
        const { data } = await this.colabClient.GET('/v1beta/subscription');
        assert(data);
        return data;
      }
    };
  }

  get runtimespecs() {
    return {
      list: async () => {
        const { data } = await this.colabClient.GET('/v1beta/runtimespecs');
        assert(data?.runtimeSpecs);
        return data.runtimeSpecs;
      }
    }
  }

  /**
   * Lists the available runtime specs for the authenticated user.
   *
   * @returns A promise that resolves to the list of runtime specs.
   */
  async listRuntimeSpecs(): Promise<
    colabComponents['schemas']['ListRuntimeSpecsResponse'] | undefined
  > {
    const { data } = await this.colabClient.GET('/v1beta/runtimespecs');
    return data;
  }

  /**
   * Lists the runtimes assigned to the authenticated user.
   *
   * @returns A promise that resolves to the list of runtimes.
   */
  async listRuntimes(): Promise<
    colabComponents['schemas']['ListRuntimesResponse'] | undefined
  > {
    const { data } = await this.colabClient.GET('/v1beta/runtimes');
    return data;
  }

  /**
   * Gets the runtime with the specified ID.
   *
   * @param id - Runtime ID.
   * @returns A promise that resolves to the runtime.
   */
  async getRuntime(
    id: string,
  ): Promise<colabComponents['schemas']['Runtime'] | undefined> {
    const { data } = await this.colabClient.GET('/v1beta/runtimes/{runtime}', {
      params: {
        path: {
          runtime: id,
        },
      },
    });
    return data;
  }

  /**
   * Creates a new runtime for the authenticated user.
   *
   * @param spec - Runtime spec to use for the new runtime.
   * @param runtimeId - Optional runtime ID to use for the new runtime.
   * @param requestId - Optional request ID to ensure idempotency.
   * @returns A promise that resolves to a create runtime long-running
   * operation.
   */
  async createRuntime(
    spec: colabComponents['schemas']['Key'],
    runtimeId?: string,
    requestId?: string,
  ): Promise<colabComponents['schemas']['CreateRuntimeOperation'] | undefined> {
    const { data } = await this.colabClient.POST('/v1beta/runtimes', {
      params: {
        query: { runtimeId, requestId },
      },
      body: {
        runtimeSpec: spec,
      },
    });
    return data;
  }

  /**
   * Deletes the runtime with the specified name.
   *
   * @param id - ID of the runtime to be deleted.
   */
  async deleteRuntime(id: string): Promise<void> {
    await this.colabClient.DELETE('/v1beta/runtimes/{runtime}', {
      params: {
        path: {
          runtime: id,
        },
      },
    });
  }

  /**
   * Gets the long-running operation with the specified ID.
   *
   * @param id - Operation ID.
   * @returns A promise that resolves to the operation.
   */
  async getOperation(
    id: string,
  ): Promise<operationsComponents['schemas']['Operation'] | undefined> {
    const { data } = await this.operationsClient.GET(
      '/v1/operations/{operationsId}',
      {
        params: {
          path: {
            operationsId: id,
          },
        },
      },
    );
    return data;
  }
}

const customHeadersMiddleware: Middleware = {
  onRequest({ request }) {
    request.headers.set(
      COLAB_CLIENT_AGENT_HEADER.key,
      COLAB_CLIENT_AGENT_HEADER.value,
    );
    return request;
  },
};

function getAuthMiddleware(getAccessToken: () => Promise<string>): Middleware {
  return {
    async onRequest({ request }) {
      const token = await getAccessToken();
      if (!token) {
        // Don't modify request if access token is empty.
        return undefined;
      }

      request.headers.set(AUTHORIZATION_HEADER.key, `Bearer ${token}`);
      return request;
    },
  };
}

function getErrorHandlingMiddleware(
  onAuthError?: () => Promise<void>,
): Middleware {
  return {
    async onResponse({ request, response }) {
      if (!response.ok) {
        // Invoke onAuthError on 401 Unauthorized
        if (response.status === 401 && onAuthError) {
          await onAuthError();
        }

        // Throw non-OK response as ColabRequestError
        const err = new ColabRequestError(
          request,
          response,
          await response.text(),
        );
        telemetry.logError(err);
        log.warn('Colab API request failed:', err);
        throw err;
      }
    },
    onError({ request, error }) {
      telemetry.logError(error);
      log.error(
        `Non-status error thrown during request ${request.method} ${request.url}:`,
        error,
      );
    },
  };
}
