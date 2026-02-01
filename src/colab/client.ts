/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { UUID } from 'crypto';
import * as https from 'https';
import fetch, { Request, RequestInit, Headers } from 'node-fetch';
import { z } from 'zod';
import { traceMethod } from '../common/logging/decorators';
import { JupyterClient } from '../jupyter/client';
import { Session } from '../jupyter/client/generated';
import { uuidToWebSafeBase64 } from '../utils/uuid';
import {
  Assignment,
  CcuInfo,
  Variant,
  GetAssignmentResponse,
  CcuInfoSchema,
  AssignmentSchema,
  GetAssignmentResponseSchema,
  UserInfoSchema,
  SubscriptionTier,
  PostAssignmentResponse,
  Outcome,
  PostAssignmentResponseSchema,
  ListedAssignmentsSchema,
  ListedAssignment,
  RuntimeProxyInfo,
  RuntimeProxyInfoSchema,
  Shape,
  SessionSchema,
  CredentialsPropagationResult,
  CredentialsPropagationResultSchema,
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

/**
 * A client for interacting with the Colab APIs.
 */
export class ColabClient {
  private readonly httpsAgent?: https.Agent;

  constructor(
    private readonly colabDomain: URL,
    private readonly colabGapiDomain: URL,
    private getAccessToken: () => Promise<string>,
  ) {
    // TODO: Temporary workaround to allow self-signed certificates
    // in local development.
    if (colabDomain.hostname === 'localhost') {
      this.httpsAgent = new https.Agent({ rejectUnauthorized: false });
    }
  }

  /**
   * Gets the user's subscription tier.
   *
   * @param signal - Optional {@link AbortSignal} to cancel the request.
   * @returns The user's subscription tier.
   */
  async getSubscriptionTier(signal?: AbortSignal): Promise<SubscriptionTier> {
    const userInfo = await this.issueRequest(
      new URL('v1/user-info', this.colabGapiDomain),
      { method: 'GET', signal },
      UserInfoSchema,
    );
    return userInfo.subscriptionTier;
  }

  /**
   * Gets the current Colab Compute Units (CCU) information.
   *
   * @param signal - Optional {@link AbortSignal} to cancel the request.
   * @returns The current CCU information.
   */
  async getCcuInfo(signal?: AbortSignal): Promise<CcuInfo> {
    return this.issueRequest(
      new URL(`${TUN_ENDPOINT}/ccu-info`, this.colabDomain),
      { method: 'GET', signal },
      CcuInfoSchema,
    );
  }

  /**
   * Returns the existing machine assignment if one exists, or creates one if it
   * does not.
   *
   * @param notebookHash - Represents a web-safe base-64 encoded SHA256 digest.
   * This value should always be a string of length 44.
   * @param variant - The machine variant to assign.
   * @param accelerator - The accelerator to assign.
   * @param signal - Optional {@link AbortSignal} to cancel the request.
   * @returns The assignment which is assigned to the user.
   * @throws TooManyAssignmentsError if the user has too many assignments.
   * @throws InsufficientQuotaError if the user lacks the quota to assign.
   * @throws DenylistedError if the user has been banned.
   */
  async assign(
    notebookHash: UUID,
    variant: Variant,
    accelerator?: string,
    shape?: Shape,
    signal?: AbortSignal,
  ): Promise<{ assignment: Assignment; isNew: boolean }> {
    const assignment = await this.getAssignment(
      notebookHash,
      variant,
      accelerator,
      shape,
      signal,
    );
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
            variant,
            accelerator,
            shape,
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
  ): Promise<RuntimeProxyInfo> {
    const url = new URL(
      `${TUN_ENDPOINT}/runtime-proxy-token`,
      this.colabDomain,
    );
    url.searchParams.append('endpoint', endpoint);
    url.searchParams.append('port', '8080');
    return await this.issueRequest(
      url,
      {
        method: 'GET',
        headers: { [COLAB_TUNNEL_HEADER.key]: COLAB_TUNNEL_HEADER.value },
        signal,
      },
      RuntimeProxyInfoSchema,
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
      authType: 'dfs_ephemeral' | 'auth_user_ephemeral';
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

  private async getAssignment(
    notebookHash: UUID,
    variant: Variant,
    accelerator?: string,
    shape?: Shape,
    signal?: AbortSignal,
  ): Promise<AssignmentToken | AssignedAssignment> {
    const url = this.buildAssignUrl(notebookHash, variant, accelerator, shape);
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
    variant: Variant,
    accelerator?: string,
    shape?: Shape,
    signal?: AbortSignal,
  ): Promise<PostAssignmentResponse> {
    const url = this.buildAssignUrl(notebookHash, variant, accelerator, shape);
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
    variant: Variant,
    accelerator?: string,
    shape?: Shape,
  ): URL {
    const url = new URL(`${TUN_ENDPOINT}/assign`, this.colabDomain);
    url.searchParams.append('nbh', uuidToWebSafeBase64(notebookHash));
    if (variant !== Variant.DEFAULT) {
      url.searchParams.append('variant', variant);
    }
    if (accelerator) {
      url.searchParams.append('accelerator', accelerator);
    }
    const shapeURLParam = mapShapeToURLParam(shape ?? Shape.STANDARD);
    if (shapeURLParam) {
      url.searchParams.append('shape', shapeURLParam);
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
  ): Promise<unknown> {
    // The Colab API requires the authuser parameter to be set.
    if (endpoint.hostname === this.colabDomain.hostname) {
      endpoint.searchParams.append('authuser', '0');
    }
    const token = await this.getAccessToken();
    const requestHeaders = new Headers(init.headers);
    requestHeaders.set(ACCEPT_JSON_HEADER.key, ACCEPT_JSON_HEADER.value);
    requestHeaders.set(AUTHORIZATION_HEADER.key, `Bearer ${token}`);
    requestHeaders.set(
      COLAB_CLIENT_AGENT_HEADER.key,
      COLAB_CLIENT_AGENT_HEADER.value,
    );
    const request = new Request(endpoint, {
      ...init,
      headers: requestHeaders,
      agent: this.httpsAgent,
    });
    const response = await fetch(request);
    if (!response.ok) {
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
    if (!schema) {
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
