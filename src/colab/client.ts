import { UUID } from "crypto";
import * as https from "https";
import fetch, { Request, RequestInit } from "node-fetch";
import { z } from "zod";
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
} from "./api";

const XSSI_PREFIX = ")]}'\n";
const XSRF_HEADER_KEY = "X-Goog-Colab-Token";
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
 * A client for interacting with the Colab backend.
 */
export class ColabClient {
  private readonly httpsAgent?: https.Agent;

  constructor(
    private readonly domain: URL,
    private readonly getAccessToken: () => Promise<string>,
  ) {
    // TODO: Temporary workaround to allow self-signed certificates
    // in local development.
    if (domain.hostname === "localhost") {
      this.httpsAgent = new https.Agent({ rejectUnauthorized: false });
    }
  }

  /**
   * Fetches the current Cloud Compute Units (CCU) information.
   *
   * @returns The current CCU information.
   */
  async ccuInfo(signal?: AbortSignal): Promise<CcuInfo> {
    return this.issueRequest(
      new URL(`${TUN_ENDPOINT}/ccu-info`, this.domain),
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
  ): Promise<Assignment> {
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
        return rest;
      }
      case "to_assign": {
        return await this.postAssignment(
          notebookHash,
          assignment.token,
          variant,
          accelerator,
          signal,
        );
      }
    }
  }

  /**
   * Lists all assignments.
   *
   * @returns The list of assignments.
   */
  async listAssignments(signal?: AbortSignal): Promise<Assignment[]> {
    const assignments = await this.issueRequest(
      new URL(`${TUN_ENDPOINT}/assignments`, this.domain),
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
  async listKernels(endpoint: string, signal?: AbortSignal): Promise<Kernel[]> {
    return await this.issueRequest(
      new URL(`${TUN_ENDPOINT}/${endpoint}/api/kernels`, this.domain),
      { method: "GET", signal },
      z.array(KernelSchema),
    );
  }

  /**
   * Sends a keep-alive ping to the given endpoint.
   *
   * @param endpoint - The assigned endpoint to keep alive.
   */
  async keepAlive(endpoint: string, signal?: AbortSignal): Promise<void> {
    await this.issueRequest(
      new URL(`${TUN_ENDPOINT}/${endpoint}/keep-alive/`, this.domain),
      { method: "GET", signal },
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
    if ("token" in response) {
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
    return this.issueRequest(
      url,
      {
        method: "POST",
        headers: { [XSRF_HEADER_KEY]: xsrfToken },
        signal,
      },
      AssignmentSchema,
    );
  }

  private buildAssignUrl(
    notebookHash: UUID,
    variant: Variant,
    accelerator?: Accelerator,
  ): URL {
    const url = new URL(`${TUN_ENDPOINT}/assign`, this.domain);
    url.searchParams.append("nbh", uuidToWebSafeBase64(notebookHash));
    if (variant !== Variant.DEFAULT) {
      url.searchParams.append("variant", variant.toString());
    }
    if (accelerator) {
      url.searchParams.append("accelerator", accelerator.toString());
    }
    return url;
  }

  private async issueRequest<T extends z.ZodType<unknown>>(
    endpoint: URL,
    init: RequestInit,
    schema?: T,
  ): Promise<z.infer<T>> {
    endpoint.searchParams.append("authuser", "0");
    const token = await this.getAccessToken();
    const requestHeaders = new fetch.Headers(init.headers);
    requestHeaders.set("Accept", "application/json");
    requestHeaders.set("Authorization", `Bearer ${token}`);
    const request = new Request(endpoint, {
      ...init,
      headers: requestHeaders,
      agent: this.httpsAgent,
    });
    const response = await fetch(request);
    if (!response.ok) {
      throw new Error(
        `Failed to issue request to ${endpoint.toString()}: ${response.statusText}`,
      );
    }
    if (!schema) {
      return;
    }

    const body = await response.text();

    return schema.parse(JSON.parse(stripXssiPrefix(body)));
  }
}

/**
 * If present, strip the XSSI busting prefix from v.
 */
function stripXssiPrefix(v: string): string {
  if (!v.startsWith(XSSI_PREFIX)) {
    return v;
  }
  return v.slice(XSSI_PREFIX.length);
}
