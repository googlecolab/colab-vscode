import { UUID } from "crypto";
import fetch, { Headers } from "node-fetch";
import vscode from "vscode";
import { RuntimeProxyInfo, Variant } from "../colab/api";
import { ColabClient } from "../colab/client";
import {
  COLAB_SERVERS,
  ColabAssignedServer,
  ColabJupyterServer,
  ColabServerDescriptor,
} from "./servers";
import { ServerStorage } from "./storage";

/**
 * Header key for the runtime proxy token.
 */
const COLAB_RUNTIME_PROXY_TOKEN_HEADER = "X-Colab-Runtime-Proxy-Token";

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
   * Retrieves a list of available servers that can be assigned.
   *
   * @returns A list of available servers.
   */
  async availableServers(): Promise<ColabServerDescriptor[]> {
    const ccuInfo = await this.client.ccuInfo();
    const eligibleGpus = new Set(ccuInfo.eligibleGpus);
    const ineligibleGpus = new Set(ccuInfo.ineligibleGpus);
    // TODO: TPUs are currently not supported by the CCU Info API.
    return Array.from(COLAB_SERVERS.values()).filter((server) => {
      if (server.variant !== Variant.GPU) {
        return true;
      }
      // Check both to make introducing new accelerators safer.
      const eligibleGpu =
        server.accelerator && eligibleGpus.has(server.accelerator);
      const ineligibleGpu =
        server.accelerator && ineligibleGpus.has(server.accelerator);
      // TODO: Provide a ⚠️ warning for the servers which are ineligible.

      return eligibleGpu && !ineligibleGpu;
    });
  }

  /**
   * Retrieves the list of servers that have been assigned.
   *
   * @returns A list of assigned servers. Connection information is included
   * and can be refreshed by calling {@link refreshConnection}.
   */
  async assignedServers(): Promise<ColabAssignedServer[]> {
    return (await this.storage.get()).map((server) => ({
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
   * @param id The ID of the server to assign.
   * @param descriptor The server descriptor used as a template for the server
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
   * @param server The server to refresh.
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
   * @param toAssign The server to assign or refresh.
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
      assignment.runtimeProxyInfo,
    );
    await this.storage.store(server);
    this.assignmentsChange.fire();
    return server;
  }

  private serverWithConnectionInfo(
    server: ColabJupyterServer,
    proxyInfo?: RuntimeProxyInfo,
  ): ColabAssignedServer {
    const { url, token } = proxyInfo ?? {};
    if (!url || !token) {
      throw new Error("Unable to obtain connection information for server.");
    }
    const headers: Record<string, string> =
      server.connectionInformation?.headers ?? {};
    headers[COLAB_RUNTIME_PROXY_TOKEN_HEADER] = token;

    return {
      id: server.id,
      label: server.label,
      variant: server.variant,
      accelerator: server.accelerator,
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
 */
function colabProxyFetch(
  token: string,
): (
  info: fetch.RequestInfo,
  init?: fetch.RequestInit,
) => Promise<fetch.Response> {
  return async (info: fetch.RequestInfo, init?: fetch.RequestInit) => {
    if (!init) {
      init = {};
    }
    const headers = new Headers(init.headers);
    headers.append(COLAB_RUNTIME_PROXY_TOKEN_HEADER, token);
    init.headers = headers;

    return fetch(info, init);
  };
}
