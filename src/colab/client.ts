import { UUID } from "crypto";
import * as https from "https";
import fetch, { Request } from "node-fetch";
import { AuthenticationSession } from "vscode";
import { z } from "zod";
import { uuidToWebSafeBase64 } from "../utils/uuid";
import {
  Assignment,
  CCUInfo,
  Variant,
  Accelerator,
  GetAssignmentResponse,
  CCUInfoSchema,
  AssignmentSchema,
  GetAssignmentResponseSchema,
} from "./api";

const XSSI_PREFIX = ")]}'\n";
const XSRF_HEADER_KEY = "X-Goog-Colab-Token";
const CCU_INFO_ENDPOINT = "/tun/m/ccu-info?authuser=0";
const ASSIGN_ENDPOINT = "/tun/m/assign?authuser=0";

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
    private session: () => Promise<AuthenticationSession>,
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
  async ccuInfo(): Promise<CCUInfo> {
    return this.issueRequest(
      new URL(CCU_INFO_ENDPOINT, this.domain),
      "GET",
      CCUInfoSchema,
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
  ): Promise<Assignment> {
    const assignment = await this.getAssignment(
      notebookHash,
      variant,
      accelerator,
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
        );
      }
    }
  }

  private async getAssignment(
    notebookHash: UUID,
    variant: Variant,
    accelerator?: Accelerator,
  ): Promise<AssignmentToken | AssignedAssignment> {
    const url = this.buildAssignUrl(notebookHash, variant, accelerator);
    const response = await this.issueRequest(
      url,
      "GET",
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
  ): Promise<Assignment> {
    const url = this.buildAssignUrl(notebookHash, variant, accelerator);
    return this.issueRequest(url, "POST", AssignmentSchema, [
      [XSRF_HEADER_KEY, xsrfToken],
    ]);
  }

  private buildAssignUrl(
    notebookHash: UUID,
    variant: Variant,
    accelerator?: Accelerator,
  ): URL {
    const url = new URL(ASSIGN_ENDPOINT, this.domain);
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
    method: "GET" | "POST",
    schema: T,
    headers?: fetch.HeadersInit,
  ): Promise<z.infer<T>> {
    const authSession = await this.session();
    const requestHeaders = new fetch.Headers(headers);
    requestHeaders.set("Accept", "application/json");
    requestHeaders.set("Authorization", `Bearer ${authSession.accessToken}`);
    const request = new Request(endpoint, {
      method,
      headers: requestHeaders,
      agent: this.httpsAgent,
    });
    const response = await fetch(request);
    if (!response.ok) {
      throw new Error(
        `Failed to ${method} ${endpoint.toString()}: ${response.statusText}`,
      );
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
