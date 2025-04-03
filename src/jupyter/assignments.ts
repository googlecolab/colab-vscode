import { UUID } from "crypto";
import fetch, {
  Headers,
  Request,
  RequestInfo,
  RequestInit,
  Response,
} from "node-fetch";
import vscode from "vscode";
import { Accelerator, Assignment, Variant } from "../colab/api";
import { ColabClient } from "../colab/client";
import {
  COLAB_SERVERS,
  ColabAssignedServer,
  ColabJupyterServer,
  ColabServerDescriptor,
} from "./servers";
import { ServerStorage } from "./storage";

/**
 * The header key for the Colab runtime proxy token.
 */
const COLAB_RUNTIME_PROXY_TOKEN_HEADER = "X-Colab-Runtime-Proxy-Token";

/**
 * The header key for the Colab client agent.
 */
const COLAB_CLIENT_AGENT_HEADER = "X-Colab-Client-Agent";

/**
 * The client agent value for requests originating from VS Code.
 */
const VSCODE_CLIENT_AGENT = "vscode";

export class AssignmentManager implements vscode.Disposable {
  /**
   * Event that fires when the server assignments change.
   */
  onDidAssignmentsChange: vscode.Event<void>;

  private readonly assignmentsChange: vscode.EventEmitter<void>;

  constructor(
    private readonly vs: typeof vscode,
    private readonly client: ColabClient,
    private readonly storage: ServerStorage,
  ) {
    this.assignmentsChange = new vs.EventEmitter<void>();
    this.onDidAssignmentsChange = this.assignmentsChange.event;
  }

  dispose() {
    this.assignmentsChange.dispose();
  }

  /**
   * Retrieves a list of available server descriptors that can be assigned.
   *
   * @returns A list of available server descriptors.
   */
  async getAvailableServerDescriptors(): Promise<ColabServerDescriptor[]> {
    const ccuInfo = await this.client.ccuInfo();
    const eligibleGpus = new Set(ccuInfo.eligibleGpus);
    const ineligibleGpus = new Set(ccuInfo.ineligibleGpus);
    const eligibleTpus = new Set(ccuInfo.eligibleTpus);
    const ineligibleTpus = new Set(ccuInfo.ineligibleTpus);
    return Array.from(COLAB_SERVERS.values()).filter((server) => {
      switch (server.variant) {
        case Variant.DEFAULT:
          return true;
        case Variant.GPU:
          return isAcceleratorAvailable(server.accelerator, {
            eligible: eligibleGpus,
            ineligible: ineligibleGpus,
          });
        case Variant.TPU:
          return isAcceleratorAvailable(server.accelerator, {
            eligible: eligibleTpus,
            ineligible: ineligibleTpus,
          });
      }
    });
  }

  /**
   * Reconciles the managed list of assigned servers with those that Colab knows
   * about.
   *
   * Note that it's possible Colab has assignments which did not originate from
   * VS Code. Naturally, those cannot be "reconciled". They are not added to the
   * managed list of assigned servers. In other words, assignments originating
   * from Colab-web will not show in VS Code.
   */
  async reconcileAssignedServers(): Promise<void> {
    const stored = await this.storage.list();
    if (stored.length === 0) {
      return;
    }
    const live = new Set(
      (await this.client.listAssignments()).map((a) => a.endpoint),
    );
    const reconciled = stored.filter((s) => live.has(s.endpoint));
    if (stored.length === reconciled.length) {
      return;
    }

    await this.storage.clear();
    await this.storage.store(reconciled);
    this.assignmentsChange.fire();
  }

  /**
   * Retrieves the list of servers that have been assigned.
   *
   * @returns A list of assigned servers. Connection information is included
   * and can be refreshed by calling {@link refreshConnection}.
   */
  async getAssignedServers(): Promise<ColabAssignedServer[]> {
    return (await this.storage.list()).map((server) => ({
      ...server,
      connectionInformation: {
        ...server.connectionInformation,
        fetch: colabProxyFetch(server.connectionInformation.token),
      },
    }));
  }

  /**
   * Assigns a server.
   *
   * @param id - The ID of the server to assign.
   * @param descriptor - The server descriptor used as a template for the server
   * being assigned.
   * @returns The assigned server.
   */
  async assignServer(
    id: UUID,
    descriptor: ColabServerDescriptor,
  ): Promise<ColabAssignedServer> {
    return this.assignOrRefresh({
      id,
      label: descriptor.label,
      variant: descriptor.variant,
      accelerator: descriptor.accelerator,
    });
  }

  /**
   * Refreshes the connection information for a server.
   *
   * @param server - The server to refresh.
   * @returns The server with updated connection information: its token and
   * fetch implementation.
   */
  async refreshConnection(
    server: ColabJupyterServer,
  ): Promise<ColabAssignedServer> {
    return this.assignOrRefresh(server);
  }

  /**
   * Assigns a new server or refreshes the connection information for an
   * existing server.
   *
   * @param toAssign - The server to assign or refresh.
   * @returns The assigned server.
   */
  private async assignOrRefresh(
    toAssign: ColabJupyterServer,
  ): Promise<ColabAssignedServer> {
    const assignment = await this.client.assign(
      toAssign.id,
      toAssign.variant,
      toAssign.accelerator,
    );
    const server = this.serverWithConnectionInfo(
      {
        id: toAssign.id,
        label: toAssign.label,
        variant: assignment.variant,
        accelerator: assignment.accelerator,
      },
      assignment,
    );
    await this.storage.store([server]);
    this.assignmentsChange.fire();
    return server;
  }

  private serverWithConnectionInfo(
    server: ColabJupyterServer,
    assignment: Assignment,
  ): ColabAssignedServer {
    const { url, token } = assignment.runtimeProxyInfo ?? {};
    if (!url || !token) {
      throw new Error("Unable to obtain connection information for server.");
    }
    const headers: Record<string, string> =
      server.connectionInformation?.headers ?? {};
    headers[COLAB_RUNTIME_PROXY_TOKEN_HEADER] = token;
    headers[COLAB_CLIENT_AGENT_HEADER] = VSCODE_CLIENT_AGENT;

    return {
      id: server.id,
      label: server.label,
      variant: server.variant,
      accelerator: server.accelerator,
      endpoint: assignment.endpoint,
      connectionInformation: {
        baseUrl: this.vs.Uri.parse(url),
        token,
        headers,
        fetch: colabProxyFetch(token),
      },
    };
  }
}

/**
 * Creates a fetch function that adds the Colab runtime proxy token as a header.
 *
 * Fixes an issue where `fetch` Request objects are not recognized by
 * `node-fetch`, causing them to be treated as URLs instead. This happens
 * because `node-fetch` checks for a specific internal symbol that standard
 * Fetch API requests lack. See:
 * https://github.com/node-fetch/node-fetch/discussions/1598.
 *
 * To work around this, we create a new `Request` instance to ensure
 * compatibility.
 */
function colabProxyFetch(
  token: string,
): (info: RequestInfo, init?: RequestInit) => Promise<Response> {
  return async (info: RequestInfo, init?: RequestInit) => {
    if (isRequest(info)) {
      // Ensure compatibility with `node-fetch`
      info = new Request(info.url, info);
    }

    init ??= {};
    const headers = new Headers(init.headers);
    headers.append(COLAB_RUNTIME_PROXY_TOKEN_HEADER, token);
    headers.append(COLAB_CLIENT_AGENT_HEADER, VSCODE_CLIENT_AGENT);
    init.headers = headers;

    return fetch(info, init);
  };
}

function isRequest(info: RequestInfo): info is Request {
  return typeof info !== "string" && !("href" in info);
}

// TODO: Provide a ⚠️ warning for the servers which are ineligible.
function isAcceleratorAvailable(
  accelerator: Accelerator | undefined,
  availability: {
    eligible: Set<Accelerator>;
    ineligible?: Set<Accelerator>;
  },
): boolean {
  if (!accelerator) {
    return false;
  }
  return (
    !availability.ineligible?.has(accelerator) &&
    availability.eligible.has(accelerator)
  );
}
