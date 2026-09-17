/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as https from 'https';
import fetch, { Headers, Request, RequestInit, Response } from 'node-fetch';
import { z } from 'zod';
import { fetchAndParse } from '../../../common/fetch-utils';
import { traceMethod } from '../../../common/logging/decorators';
import {
  buildFetchChain,
  createAcceptJsonMiddleware,
  createAuthMiddleware,
  createErrorMiddleware,
} from '../../../common/middleware';
import { ColabAssignedServer } from '../../../jupyter/servers';
import { ColabRequestError } from '../../errors';
import { getFlag } from '../../experiment-state';
import {
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
  COLAB_TUNNEL_HEADER,
  COLAB_VS_CODE_APP_NAME,
  COLAB_VS_CODE_EXTENSION_VERSION,
  COLAB_XSRF_TOKEN_HEADER,
  CONTENT_TYPE_JSON_HEADER,
} from '../../headers';
import {
  AuthType,
  ConsumptionUserInfo,
  ConsumptionUserInfoSchema,
  CredentialsPropagationResult,
  CredentialsPropagationResultSchema,
  ExperimentStateSchema,
  ExperimentState,
  Resources,
  ResourcesSchema,
  AccessTokenType,
  ExperimentFlag,
  OnePlatformError,
  OnePlatformErrorSchema,
  ErrorInfoSchema,
  ErrorInfo,
} from './api';

const TUN_ENDPOINT = '/tun/m';

/**
 * A client for interacting with the Colab APIs.
 */
export class ColabClient {
  private readonly httpsAgent?: https.Agent;

  /**
   * Creates a new instance of ColabClient.
   *
   * @param colabDomain - The Colab domain URL.
   * @param colabGapiDomain - The Colab GAPI domain URL.
   * @param callerInfo - Information about the caller.
   * @param getAccessToken - Function to retrieve the access token.
   * @param onAuthError - Callback when an auth error occurs.
   * @returns A new ColabClient instance.
   */
  static create(
    colabDomain: URL,
    colabGapiDomain: URL,
    callerInfo: { appName: string; extensionVersion: string },
    getAccessToken: () => Promise<string>,
    onAuthError: (() => Promise<void>) | undefined,
  ): ColabClient {
    const baseMiddleware = [
      createAcceptJsonMiddleware(),
      createErrorMiddleware(),
    ];
    const authenticatedFetch = buildFetchChain(
      [...baseMiddleware, createAuthMiddleware(getAccessToken, onAuthError)],
      fetch,
    );
    const unauthenticatedFetch = buildFetchChain(baseMiddleware, fetch);

    return new ColabClient(
      colabDomain,
      colabGapiDomain,
      authenticatedFetch,
      unauthenticatedFetch,
      callerInfo,
    );
  }

  private constructor(
    private readonly colabDomain: URL,
    private readonly colabGapiDomain: URL,
    private readonly fetch: (
      url: string | Request,
      init?: RequestInit,
    ) => Promise<Response>,
    private readonly unauthenticatedFetch: (
      url: string | Request,
      init?: RequestInit,
    ) => Promise<Response>,
    private readonly callerInfo: {
      appName: string;
      extensionVersion: string;
    },
  ) {
    // TODO: Temporary workaround to allow self-signed certificates
    // in local development.
    if (colabDomain.hostname === 'localhost') {
      this.httpsAgent = new https.Agent({ rejectUnauthorized: false });
    }
  }

  /**
   * Gets the current user with Colab Compute Units (CCU) information.
   *
   * @param signal - Optional {@link AbortSignal} to cancel the request.
   * @returns The current user information with CCU info included.
   */
  async getConsumptionUserInfo(
    signal?: AbortSignal,
  ): Promise<ConsumptionUserInfo> {
    const url = new URL('v1/user-info', this.colabGapiDomain);
    url.searchParams.set('get_ccu_consumption_info', 'true');
    return await this.issueRequest(
      url,
      { method: 'GET', signal },
      ConsumptionUserInfoSchema,
    );
  }

  /**
   * Gets the resources (RAM and disk usage) for a given server by its endpoint.
   *
   * @param server - The assigned server to get resources for.
   * @param signal - Optional {@link AbortSignal} to cancel the request.
   * @returns The resources information.
   */
  async getResources(
    server: ColabAssignedServer,
    signal?: AbortSignal,
  ): Promise<Resources> {
    const url = new URL(
      'api/colab/resources',
      server.connectionInformation.baseUrl.toString(),
    );
    const headers = {
      [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]:
        server.connectionInformation.token,
    };

    return await this.issueRequest(
      url,
      {
        method: 'GET',
        headers,
        signal,
      },
      ResourcesSchema,
    );
  }

  /**
   * Propagates credentials to the backend.
   *
   * @param endpoint - The assignment endpoint to propagate credentials to.
   * @param params - Parameters for credentials propagation API.
   * @param signal - Optional {@link AbortSignal} to cancel the request.
   * @returns Whether propagation is successful. If not, an OAuth redirect URL
   * is returned to obtain the credentials.
   */
  async propagateCredentials(
    endpoint: string,
    params: {
      authType: AuthType;
      // If true, check if credentials are already propagated to the backend
      // and/or obtain an OAuth redirect URL.
      dryRun: boolean;
    },
    signal?: AbortSignal,
  ): Promise<CredentialsPropagationResult> {
    const enableOp = getFlag(ExperimentFlag.EnableOpCredentialPropagationApi);
    if (!enableOp) {
      return this.propagateCredentialsV1(endpoint, params, signal);
    }
    return this.propagateCredentialsV2(
      endpoint,
      {
        accessTokenType:
          params.authType === AuthType.DFS_EPHEMERAL
            ? AccessTokenType.DFS_EPHEMERAL
            : AccessTokenType.AUTH_USER_EPHEMERAL,
        dryRun: params.dryRun,
      },
      signal,
    );
  }

  private async propagateCredentialsV1(
    endpoint: string,
    params: {
      authType: AuthType;
      dryRun: boolean;
    },
    signal?: AbortSignal,
  ): Promise<CredentialsPropagationResult> {
    const url = new URL(
      `${TUN_ENDPOINT}/credentials-propagation/${endpoint}`,
      this.colabDomain,
    );
    url.searchParams.set('authtype', params.authType);
    url.searchParams.set('version', '2');
    url.searchParams.set('dryrun', String(params.dryRun));
    url.searchParams.set('propagate', 'true');
    url.searchParams.set('record', 'false');

    const { token } = await this.issueRequest(
      url,
      { method: 'GET', signal },
      z.object({ token: z.string() }),
    );

    return await this.issueRequest(
      url,
      {
        method: 'POST',
        headers: { [COLAB_XSRF_TOKEN_HEADER.key]: token },
        signal,
      },
      CredentialsPropagationResultSchema,
    );
  }

  private async propagateCredentialsV2(
    endpoint: string,
    params: {
      accessTokenType: AccessTokenType;
      dryRun: boolean;
    },
    signal?: AbortSignal,
  ): Promise<CredentialsPropagationResult> {
    const url = new URL(
      'v1/credential-propagation:enable',
      this.colabGapiDomain,
    );

    const payload = {
      endpoint,
      accessTokenType: params.accessTokenType,
      dryRun: params.dryRun,
      version: '2',
    };

    try {
      await this.issueRequest(url, {
        method: 'POST',
        headers: {
          [CONTENT_TYPE_JSON_HEADER.key]: CONTENT_TYPE_JSON_HEADER.value,
        },
        body: JSON.stringify(payload),
        signal,
      });
      return { success: true, unauthorizedRedirectUri: undefined };
    } catch (error: unknown) {
      const unauthorizedRedirectUri = extractUnauthorizedRedirectUri(error);
      if (!unauthorizedRedirectUri) {
        throw error;
      }
      return { success: false, unauthorizedRedirectUri };
    }
  }

  /**
   * Sends a keep-alive ping to the given endpoint.
   *
   * @param endpoint - The assigned endpoint to keep alive.
   * @param signal - Optional {@link AbortSignal} to cancel the request.
   */
  @traceMethod
  async sendKeepAlive(endpoint: string, signal?: AbortSignal): Promise<void> {
    await this.issueRequest(
      new URL(`${TUN_ENDPOINT}/${endpoint}/keep-alive/`, this.colabDomain),
      {
        method: 'GET',
        headers: { [COLAB_TUNNEL_HEADER.key]: COLAB_TUNNEL_HEADER.value },
        signal,
      },
    );
  }

  /**
   * Gets the current experiment state.
   *
   * @param withAuth - Whether to require auth for the request. Defaults to
   * false.
   * @param signal - Optional {@link AbortSignal} to cancel the request.
   * @returns The current experiment state.
   */
  async getExperimentState(
    withAuth = false,
    signal?: AbortSignal,
  ): Promise<ExperimentState> {
    const url = new URL('vscode/experiment-state', this.colabDomain);
    const expState = this.issueRequest(
      url,
      { method: 'GET', signal },
      ExperimentStateSchema,
      withAuth,
    );
    return expState;
  }

  /**
   * Issues a request to the given endpoint, adding the necessary headers and
   * handling errors.
   *
   * @param endpoint - The endpoint to issue the request to.
   * @param init - The request init to use for the fetch.
   * @param schema - The schema to validate the response against.
   * @param withAuth - Whether to use the authenticated fetch.
   * @returns A promise that resolves the parsed response when the request is
   * complete.
   */
  private async issueRequest<T extends z.ZodType>(
    endpoint: URL,
    init: RequestInit,
    schema: T,
    withAuth?: boolean,
  ): Promise<z.infer<T>>;

  /**
   * Issues a request to the given endpoint, adding the necessary headers and
   * handling errors.
   *
   * @param endpoint - The endpoint to issue the request to.
   * @param init - The request init to use for the fetch.
   * @param schema - Unused.
   * @param withAuth - Whether to use the authenticated fetch.
   * @returns A promise that resolves when the request is complete.
   */
  private async issueRequest(
    endpoint: URL,
    init: RequestInit,
    schema?: undefined,
    withAuth?: boolean,
  ): Promise<void>;

  private async issueRequest(
    endpoint: URL,
    init: RequestInit,
    schema?: z.ZodType,
    withAuth = true,
  ): Promise<unknown> {
    // The Colab API requires the authuser parameter to be set.
    if (endpoint.hostname === this.colabDomain.hostname) {
      endpoint.searchParams.set('authuser', '0');
    }

    const requestHeaders = new Headers(init.headers);
    requestHeaders.set(
      COLAB_CLIENT_AGENT_HEADER.key,
      COLAB_CLIENT_AGENT_HEADER.value,
    );
    requestHeaders.set(COLAB_VS_CODE_APP_NAME.key, this.callerInfo.appName);
    requestHeaders.set(
      COLAB_VS_CODE_EXTENSION_VERSION.key,
      this.callerInfo.extensionVersion,
    );

    const requestInit: RequestInit = {
      ...init,
      headers: requestHeaders,
      agent: this.httpsAgent,
    };

    const fetchImpl = withAuth ? this.fetch : this.unauthenticatedFetch;

    return schema
      ? fetchAndParse(fetchImpl, endpoint.toString(), schema, requestInit)
      : fetchImpl(endpoint.toString(), requestInit).then(() => undefined);
  }
}

function extractUnauthorizedRedirectUri(error: unknown): string | undefined {
  if (
    !(error instanceof ColabRequestError) ||
    error.response.status !== 400 ||
    !error.responseBody
  ) {
    return undefined;
  }

  const errorBody: unknown = JSON.parse(error.responseBody);
  if (!isOnePlatformError(errorBody)) {
    return undefined;
  }

  const details = errorBody.error.details ?? [];
  if (
    details.length !== 1 ||
    !isErrorInfo(details[0]) ||
    details[0].reason !== 'OAUTH_CONSENT_REQUIRED'
  ) {
    return undefined;
  }
  return details[0].metadata?.unauthorized_redirect_uri;
}

function isOnePlatformError(obj: unknown): obj is OnePlatformError {
  return OnePlatformErrorSchema.safeParse(obj).success;
}

function isErrorInfo(obj: unknown): obj is ErrorInfo {
  return ErrorInfoSchema.safeParse(obj).success;
}
