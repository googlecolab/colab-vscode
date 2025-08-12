/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { UUID } from "crypto";
import * as https from "https";
import fetch, { Request, RequestInit, Headers } from "node-fetch";
import { z } from "zod";
import { ColabAssignedServer } from "../jupyter/servers";
import { uuidToWebSafeBase64 } from "../utils/uuid";
import {
  Assignment,
  CcuInfo,
  Variant,
  Accelerator,
  GetAssignmentResponse,
  CcuInfoSchema,
  AssignmentSchema,
  GetAssignmentResponseSchema,
  AssignmentsSchema,
  KernelSchema,
  Kernel,
  SessionSchema,
  Session,
  UserInfoSchema,
  SubscriptionTier,
} from "./api";
import {
  ACCEPT_JSON_HEADER,
  AUTHORIZATION_HEADER,
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
  COLAB_TUNNEL_HEADER,
  COLAB_XSRF_TOKEN_HEADER,
} from "./headers";

const XSSI_PREFIX = ")]}'\n";
const TUN_ENDPOINT = "/tun/m";

// To discriminate the type of GET assignment responses.
interface AssignmentToken extends GetAssignmentResponse {
  kind: "to_assign";
}

// To discriminate the type of GET assignment responses.
interface AssignedAssignment extends Assignment {
  kind: "assigned";
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
    if (colabDomain.hostname === "localhost") {
      this.httpsAgent = new https.Agent({ rejectUnauthorized: false });
    }
  }

  /**
   * Gets the user's subscription tier.
   *
   * @returns The user's subscription tier.
   */
  async getSubscriptionTier(signal?: AbortSignal): Promise<SubscriptionTier> {
    const userInfo = await this.issueRequest(
      new URL("v1/user-info", this.colabGapiDomain),
      { method: "GET", signal },
      UserInfoSchema,
    );
    return userInfo.subscriptionTier;
  }

  /**
   * Gets the current Colab Compute Units (CCU) information.
   *
   * @returns The current CCU information.
   */
  async getCcuInfo(signal?: AbortSignal): Promise<CcuInfo> {
    return this.issueRequest(
      new URL(`${TUN_ENDPOINT}/ccu-info`, this.colabDomain),
      { method: "GET", signal },
      CcuInfoSchema,
    );
  }

  /**
   * Returns the existing machine assignment if one exists, or creates one if it
   * does not.
   *
   * @param notebookHash - Represents a web-safe base-64 encoded SHA256 digest. This value should always be a string of length 44 (see: http://go/so/13378815).
   * @param variant - The machine variant to assign.
   * @param accelerator - The accelerator to assign.
   * @returns The assignment which is assigned to the user.
   */
  async assign(
    notebookHash: UUID,
    variant: Variant,
    accelerator?: Accelerator,
    signal?: AbortSignal,
  ): Promise<{ assignment: Assignment; isNew: boolean }> {
    const assignment = await this.getAssignment(
      notebookHash,
      variant,
      accelerator,
      signal,
    );
    switch (assignment.kind) {
      case "assigned": {
        // Not required, but we want to remove the type field we use internally
        // to discriminate the union of types returned from getAssignment.
        const { kind: _, ...rest } = assignment;
        return { assignment: rest, isNew: false };
      }
      case "to_assign": {
        return {
          assignment: await this.postAssignment(
            notebookHash,
            assignment.xsrfToken,
            variant,
            accelerator,
            signal,
          ),
          isNew: true,
        };
      }
    }
  }

  /**
   * Unassigns the specified machine assignment.
   *
   * @param endpoint - The endpoint to unassign.
   */
  async unassign(endpoint: string, signal?: AbortSignal): Promise<void> {
    const url = new URL(
      `${TUN_ENDPOINT}/unassign/${endpoint}`,
      this.colabDomain,
    );
    const { token } = await this.issueRequest(
      url,
      { method: "GET", signal },
      z.object({ token: z.string() }),
    );
    await this.issueRequest(url, {
      method: "POST",
      headers: { [COLAB_XSRF_TOKEN_HEADER.key]: token },
      signal,
    });
  }

  /**
   * Lists all assignments.
   *
   * @returns The list of assignments.
   */
  async listAssignments(signal?: AbortSignal): Promise<Assignment[]> {
    const assignments = await this.issueRequest(
      new URL(`${TUN_ENDPOINT}/assignments`, this.colabDomain),
      { method: "GET", signal },
      AssignmentsSchema,
    );
    return assignments.assignments;
  }

  /**
   * Lists all kernels for a given endpoint.
   *
   * @param endpoint - The assigned endpoint to list kernels for.
   * @returns The list of kernels.
   */
  async listKernels(
    server: ColabAssignedServer,
    signal?: AbortSignal,
  ): Promise<Kernel[]> {
    const url = new URL(
      "api/kernels",
      server.connectionInformation.baseUrl.toString(),
    );
    return await this.issueRequest(
      url,
      {
        method: "GET",
        headers: {
          [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]:
            server.connectionInformation.token,
        },
        signal,
      },
      z.array(KernelSchema),
    );
  }

  /**
   * Lists all sessions for a given endpoint.
   *
   * @param endpoint - The assigned endpoint to list sessions for.
   * @returns The list of sessions.
   */
  async listSessions(
    server: ColabAssignedServer,
    signal?: AbortSignal,
  ): Promise<Session[]> {
    const url = new URL(
      "api/sessions",
      server.connectionInformation.baseUrl.toString(),
    );
    return await this.issueRequest(
      url,
      {
        method: "GET",
        headers: {
          [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]:
            server.connectionInformation.token,
        },
        signal,
      },
      z.array(SessionSchema),
    );
  }

  /**
   * Deletes the given session
   *
   * @param endpoint - The endpoint to delete the session from.
   * @param sessionId - The ID of the session to delete.
   */
  async deleteSession(
    server: ColabAssignedServer,
    sessionId: string,
    signal?: AbortSignal,
  ) {
    const url = new URL(
      `api/sessions/${sessionId}`,
      server.connectionInformation.baseUrl.toString(),
    );
    return await this.issueRequest(url, {
      method: "DELETE",
      headers: {
        [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]:
          server.connectionInformation.token,
      },
      signal,
    });
  }

  /**
   * Sends a keep-alive ping to the given endpoint.
   *
   * @param endpoint - The assigned endpoint to keep alive.
   */
  async sendKeepAlive(endpoint: string, signal?: AbortSignal): Promise<void> {
    await this.issueRequest(
      new URL(`${TUN_ENDPOINT}/${endpoint}/keep-alive/`, this.colabDomain),
      {
        method: "GET",
        headers: { [COLAB_TUNNEL_HEADER.key]: COLAB_TUNNEL_HEADER.value },
        signal,
      },
    );
  }

  private async getAssignment(
    notebookHash: UUID,
    variant: Variant,
    accelerator?: Accelerator,
    signal?: AbortSignal,
  ): Promise<AssignmentToken | AssignedAssignment> {
    const url = this.buildAssignUrl(notebookHash, variant, accelerator);
    const response = await this.issueRequest(
      url,
      { method: "GET", signal },
      z.union([GetAssignmentResponseSchema, AssignmentSchema]),
    );
    if ("xsrfToken" in response) {
      return { ...response, kind: "to_assign" };
    } else {
      return { ...response, kind: "assigned" };
    }
  }

  private async postAssignment(
    notebookHash: UUID,
    xsrfToken: string,
    variant: Variant,
    accelerator?: Accelerator,
    signal?: AbortSignal,
  ): Promise<Assignment> {
    const url = this.buildAssignUrl(notebookHash, variant, accelerator);
    try {
      return await this.issueRequest(
        url,
        {
          method: "POST",
          headers: { [COLAB_XSRF_TOKEN_HEADER.key]: xsrfToken },
          signal,
        },
        AssignmentSchema,
      );
    } catch (error) {
      // Check for Precondition Failed
      if (error instanceof ColabRequestError && error.response.status === 412) {
        throw new TooManyAssignmentsError(error.message);
      }
      throw error;
    }
  }

  private buildAssignUrl(
    notebookHash: UUID,
    variant: Variant,
    accelerator?: Accelerator,
  ): URL {
    const url = new URL(`${TUN_ENDPOINT}/assign`, this.colabDomain);
    url.searchParams.append("nbh", uuidToWebSafeBase64(notebookHash));
    if (variant !== Variant.DEFAULT) {
      url.searchParams.append("variant", variant);
    }
    if (accelerator) {
      url.searchParams.append("accelerator", accelerator);
    }
    return url;
  }

  private async issueRequest<T extends z.ZodType<unknown>>(
    endpoint: URL,
    init: RequestInit,
    schema?: T,
  ): Promise<z.infer<T>> {
    // The Colab API requires the authuser parameter to be set.
    if (endpoint.hostname === this.colabDomain.hostname) {
      endpoint.searchParams.append("authuser", "0");
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

/** Error thrown when the user has too many assignments. */
export class TooManyAssignmentsError extends Error {}

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
        (responseBody ? `\nResponse body: ${responseBody}` : ""),
    );
    this.request = request;
    this.response = response;
    this.responseBody = responseBody;
  }
}
