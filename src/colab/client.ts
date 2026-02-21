/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { UUID } from 'crypto';
import * as https from 'https';
import fetch, { Headers, Request, RequestInit, Response } from 'node-fetch';
import { z } from 'zod';
import { traceMethod } from '../common/logging/decorators';
import { JupyterClient } from '../jupyter/client';
import { Session } from '../jupyter/client/generated';
import { uuidToWebSafeBase64 } from '../utils/uuid';
import {
  Assignment,
  AuthType,
  Variant,
  GetAssignmentResponse,
  AssignmentSchema,
  GetAssignmentResponseSchema,
  UserInfo,
  UserInfoSchema,
  ConsumptionUserInfo,
  ConsumptionUserInfoSchema,
  PostAssignmentResponse,
  Outcome,
  PostAssignmentResponseSchema,
  ListedAssignmentsSchema,
  ListedAssignment,
  RuntimeProxyToken,
  RuntimeProxyTokenSchema,
  Shape,
  SessionSchema,
  CredentialsPropagationResult,
  CredentialsPropagationResultSchema,
  ExperimentStateSchema,
  ExperimentState,
  isHighMemOnlyAccelerator,
} from './api';
import {
  ACCEPT_JSON_HEADER,
  AUTHORIZATION_HEADER,
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_TUNNEL_HEADER,
  COLAB_XSRF_TOKEN_HEADER,
} from './headers';

const XSSI_PREFIX = ")]}'\n";
const TUN_ENDPOINT = '/tun/m';

// To discriminate the type of GET assignment responses.
interface AssignmentToken extends GetAssignmentResponse {
  kind: 'to_assign';
}

// To discriminate the type of GET assignment responses.
interface AssignedAssignment extends Assignment {
  kind: 'assigned';
}

// Options for assign method.
interface AssignParams {
  variant: Variant;
  accelerator?: string;
  shape?: Shape;
  version?: string;
}

// Options for issueRequest method.
interface IssueRequestOptions {
  requireAccessToken?: boolean;
}

/**
 * A client for interacting with the Colab APIs.
 */
export class ColabClient {
  private readonly httpsAgent?: https.Agent;

  constructor(
    private readonly colabDomain: URL,
    private readonly colabGapiDomain: URL,
    private getAccessToken: () => Promise<string>,
    private readonly onAuthError?: () => Promise<void>,
  ) {
    // TODO: Temporary workaround to allow self-signed certificates
    // in local development.
    if (colabDomain.hostname === 'localhost') {
      this.httpsAgent = new https.Agent({ rejectUnauthorized: false });
    }
  }

  /**
   * Gets the current user information.
   *
   * @param signal - Optional {@link AbortSignal} to cancel the request.
   */
  async getUserInfo(signal?: AbortSignal): Promise<UserInfo> {
    return await this.issueRequest(
      new URL('v1/user-info', this.colabGapiDomain),
      { method: 'GET', signal },
      UserInfoSchema,
    );
  }

  /**
   * Gets the current user with Colab Compute Units (CCU) information.
   *
   * @param signal - Optional {@link AbortSignal} to cancel the request.
   */
  async getConsumptionUserInfo(
    signal?: AbortSignal,
  ): Promise<ConsumptionUserInfo> {
    const url = new URL('v1/user-info', this.colabGapiDomain);
    url.searchParams.append('get_ccu_consumption_info', 'true');
    return await this.issueRequest(
      url,
      { method: 'GET', signal },
      ConsumptionUserInfoSchema,
    );
  }

  /**
   * Returns the existing machine assignment if one exists, or creates one if it
   * does not.
   *
   * @param notebookHash - Represents a web-safe base-64 encoded SHA256 digest.
   * This value should always be a string of length 44.
   * @param params - The assignment parameters {@link AssignParams}
   * like variant, accelerator, shape and version.
   * @param signal - Optional {@link AbortSignal} to cancel the request.
   * @returns The assignment which is assigned to the user.
   * @throws TooManyAssignmentsError if the user has too many assignments.
   * @throws InsufficientQuotaError if the user lacks the quota to assign.
   * @throws DenylistedError if the user has been banned.
   */
  async assign(
    notebookHash: UUID,
    params: AssignParams,
    signal?: AbortSignal,
  ): Promise<{ assignment: Assignment; isNew: boolean }> {
    const assignment = await this.getAssignment(notebookHash, params, signal);
    switch (assignment.kind) {
      case 'assigned': {
        // Not required, but we want to remove the type field we use internally
        // to discriminate the union of types returned from getAssignment.
        const { kind: _, ...rest } = assignment;
        return { assignment: rest, isNew: false };
      }
      case 'to_assign': {
        let res: PostAssignmentResponse;
        try {
          res = await this.postAssignment(
            notebookHash,
            assignment.xsrfToken,
            params,
            signal,
          );
        } catch (error) {
          // Check for Precondition Failed
          if (
            error instanceof ColabRequestError &&
            error.response.status === 412
          ) {
            throw new TooManyAssignmentsError(error.message);
          }
          throw error;
        }

        switch (res.outcome) {
          case Outcome.QUOTA_DENIED_REQUESTED_VARIANTS:
          case Outcome.QUOTA_EXCEEDED_USAGE_TIME:
            throw new InsufficientQuotaError(
              'You have insufficient quota to assign this server.',
            );
          case Outcome.DENYLISTED:
            // TODO: Consider adding a mechanism to send feedback as part of an
            // appeal.
            throw new DenylistedError(
              'This account has been blocked from accessing Colab servers due to suspected abusive activity. This does not impact access to other Google products. Review the [usage limitations](https://research.google.com/colaboratory/faq.html#limitations-and-restrictions).',
            );
          case Outcome.UNDEFINED_OUTCOME:
          case Outcome.SUCCESS:
          case undefined:
            return {
              assignment: AssignmentSchema.parse(res),
              isNew: true,
            };
        }
      }
    }
  }

  /**
   * Unassigns the specified machine assignment.
   *
   * @param endpoint - The endpoint to unassign.
   * @param signal - Optional {@link AbortSignal} to cancel the request.
   */
  async unassign(endpoint: string, signal?: AbortSignal): Promise<void> {
    const url = new URL(
      `${TUN_ENDPOINT}/unassign/${endpoint}`,
      this.colabDomain,
    );
    const { token } = await this.issueRequest(
      url,
      { method: 'GET', signal },
      z.object({ token: z.string() }),
    );
    await this.issueRequest(url, {
      method: 'POST',
      headers: { [COLAB_XSRF_TOKEN_HEADER.key]: token },
      signal,
    });
  }

  /**
   * Refreshes the connection for the given endpoint.
   *
   * @param endpoint - The server endpoint to refresh the connection for.
   * @param signal - Optional {@link AbortSignal} to cancel the request.
   * @returns The refreshed runtime proxy information.
   */
  async refreshConnection(
    endpoint: string,
    signal?: AbortSignal,
  ): Promise<RuntimeProxyToken> {
    const url = new URL('v1/runtime-proxy-token', this.colabGapiDomain);
    url.searchParams.append('endpoint', endpoint);
    url.searchParams.append('port', '8080');
    return await this.issueRequest(
      url,
      { method: 'GET', signal },
      RuntimeProxyTokenSchema,
    );
  }

  /**
   * Lists all assignments.
   *
   * @param signal - Optional {@link AbortSignal} to cancel the request.
   * @returns The list of assignments.
   */
  async listAssignments(signal?: AbortSignal): Promise<ListedAssignment[]> {
    const assignments = await this.issueRequest(
      new URL(`${TUN_ENDPOINT}/assignments`, this.colabDomain),
      { method: 'GET', signal },
      ListedAssignmentsSchema,
    );
    return assignments.assignments;
  }

  /**
   * Lists all sessions for a given server by its endpoint.
   *
   * @param endpoint - The assignment endpoint to list sessions for.
   * @param signal - Optional {@link AbortSignal} to cancel the request.
   * @returns The list of sessions.
   */
  async listSessions(
    endpoint: string,
    signal?: AbortSignal,
  ): Promise<Session[]> {
    const url = new URL(
      `${TUN_ENDPOINT}/${endpoint}/api/sessions`,
      this.colabDomain,
    );
    const headers = { [COLAB_TUNNEL_HEADER.key]: COLAB_TUNNEL_HEADER.value };

    return await this.issueRequest(
      url,
      {
        method: 'GET',
        headers,
        signal,
      },
      z.array(SessionSchema),
    );
  }

  /**
   * Propagates credentials to the backend.
   *
   * @param endpoint - The assignment endpoint to propagate credentials to.
   * @param params - Parameters for credentials propagation API.
   * @param signal - Optional {@link AbortSignal} to cancel the request.
   * @returns Whether propagation is successful. If not, an OAuth redirect URL
   *   is returned to obtain the credentials.
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
   * @param requireAccessToken - Whether to require auth for the request.
   * Defaults to false.
   * @param signal - Optional {@link AbortSignal} to cancel the request.
   * @returns The current experiment state.
   */
  async getExperimentState(
    requireAccessToken = false,
    signal?: AbortSignal,
  ): Promise<ExperimentState> {
    const url = new URL('vscode/experiment-state', this.colabDomain);
    const expState = this.issueRequest(
      url,
      { method: 'GET', signal },
      ExperimentStateSchema,
      { requireAccessToken },
    );
    return expState;
  }

  private async getAssignment(
    notebookHash: UUID,
    params: AssignParams,
    signal?: AbortSignal,
  ): Promise<AssignmentToken | AssignedAssignment> {
    const url = this.buildAssignUrl(notebookHash, params);
    const response = await this.issueRequest(
      url,
      { method: 'GET', signal },
      z.union([GetAssignmentResponseSchema, AssignmentSchema]),
    );
    if ('xsrfToken' in response) {
      return { ...response, kind: 'to_assign' };
    } else {
      return { ...response, kind: 'assigned' };
    }
  }

  private async postAssignment(
    notebookHash: UUID,
    xsrfToken: string,
    params: AssignParams,
    signal?: AbortSignal,
  ): Promise<PostAssignmentResponse> {
    const url = this.buildAssignUrl(notebookHash, params);
    return await this.issueRequest(
      url,
      {
        method: 'POST',
        headers: { [COLAB_XSRF_TOKEN_HEADER.key]: xsrfToken },
        signal,
      },
      PostAssignmentResponseSchema,
    );
  }

  private buildAssignUrl(
    notebookHash: UUID,
    { variant, accelerator, shape, version }: AssignParams,
  ): URL {
    const url = new URL(`${TUN_ENDPOINT}/assign`, this.colabDomain);
    url.searchParams.append('nbh', uuidToWebSafeBase64(notebookHash));
    if (variant !== Variant.DEFAULT) {
      url.searchParams.append('variant', variant);
    }
    if (accelerator) {
      url.searchParams.append('accelerator', accelerator);
    }
    const shapeURLParam = mapShapeToURLParam(
      // High mem only accelerators only have one shape option
      isHighMemOnlyAccelerator(accelerator)
        ? Shape.STANDARD
        : (shape ?? Shape.STANDARD),
    );
    if (shapeURLParam) {
      url.searchParams.append('shape', shapeURLParam);
    }
    if (version) {
      url.searchParams.append('runtime_version_label', version);
    }
    return url;
  }

  /**
   * Issues a request to the given endpoint, adding the necessary headers and
   * handling errors.
   *
   * @param endpoint - The endpoint to issue the request to.
   * @param init - The request init to use for the fetch.
   * @param schema - The schema to validate the response against.
   * @returns A promise that resolves the parsed response when the request is
   * complete.
   */
  private async issueRequest<T extends z.ZodType>(
    endpoint: URL,
    init: RequestInit,
    schema: T,
    options?: IssueRequestOptions,
  ): Promise<z.infer<T>>;

  /**
   * Issues a request to the given endpoint, adding the necessary headers and
   * handling errors.
   *
   * @param endpoint - The endpoint to issue the request to.
   * @param init - The request init to use for the fetch.
   * @returns A promise that resolves when the request is complete.
   */
  private async issueRequest(endpoint: URL, init: RequestInit): Promise<void>;

  private async issueRequest(
    endpoint: URL,
    init: RequestInit,
    schema?: z.ZodType,
    { requireAccessToken = true }: IssueRequestOptions = {},
  ): Promise<unknown> {
    // The Colab API requires the authuser parameter to be set.
    if (endpoint.hostname === this.colabDomain.hostname) {
      endpoint.searchParams.append('authuser', '0');
    }

    let response: Response | undefined;
    let request: Request | undefined;
    const requestHeaders = new Headers(init.headers);
    requestHeaders.set(ACCEPT_JSON_HEADER.key, ACCEPT_JSON_HEADER.value);
    requestHeaders.set(
      COLAB_CLIENT_AGENT_HEADER.key,
      COLAB_CLIENT_AGENT_HEADER.value,
    );

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

      if (response.status === 401 && this.onAuthError) {
        await this.onAuthError();
      } else {
        let errorBody;
        try {
          errorBody = await response.text();
        } catch {
          // Ignore errors reading the body
        }
        throw new ColabRequestError({
          request,
          response,
          responseBody: errorBody,
        });
      }
    }

    if (!schema || !response) {
      return;
    }

    const body = await response.text();

    return schema.parse(JSON.parse(stripXssiPrefix(body)));
  }
}

export interface PersistentJupyterClient extends JupyterClient, Disposable {}

/** Error thrown when the user has too many assignments. */
export class TooManyAssignmentsError extends Error {}

/** Error thrown when the user has been denylisted. */
export class DenylistedError extends Error {}

/** Error thrown when the user has insufficient quota. */
export class InsufficientQuotaError extends Error {}

/** Error thrown when the request resource cannot be found. */
export class NotFoundError extends Error {}

/**
 * If present, strip the XSSI busting prefix from v.
 */
function stripXssiPrefix(v: string): string {
  if (!v.startsWith(XSSI_PREFIX)) {
    return v;
  }
  return v.slice(XSSI_PREFIX.length);
}

class ColabRequestError extends Error {
  readonly request: fetch.Request;
  readonly response: fetch.Response;
  readonly responseBody?: string;

  constructor({
    request,
    response,
    responseBody,
  }: {
    request: fetch.Request;
    response: fetch.Response;
    responseBody?: string;
  }) {
    super(
      `Failed to issue request ${request.method} ${request.url}: ${response.statusText}` +
        (responseBody ? `\nResponse body: ${responseBody}` : ''),
    );
    this.request = request;
    this.response = response;
    this.responseBody = responseBody;
  }
}

function mapShapeToURLParam(shape: Shape): string | undefined {
  switch (shape) {
    case Shape.HIGHMEM:
      return 'hm';
    default:
      return undefined;
  }
}
