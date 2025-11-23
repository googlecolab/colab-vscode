/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID, UUID } from "crypto";
import fetch, {
  Headers,
  Request,
  RequestInfo,
  RequestInit,
  Response,
} from "node-fetch";
import vscode from "vscode";
import {
  Assignment,
  RuntimeProxyInfo,
  Variant,
  variantToMachineType,
} from "../colab/api";
import {
  ColabClient,
  DenylistedError,
  InsufficientQuotaError,
  NotFoundError,
  TooManyAssignmentsError,
} from "../colab/client";
import {
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
} from "../colab/headers";
import {
  ColabAssignedServer,
  ColabRemoteServer,
  ColabJupyterServer,
  ColabServerDescriptor,
  DEFAULT_CPU_SERVER,
  isInstanceOfColabAssignedServer,
} from "./servers";
import { ServerStorage } from "./storage";

/**
 * An {@link vscode.Event} which fires when a {@link ColabAssignedServer} is
 * added, removed, or changed.
 */
export interface AssignmentChangeEvent {
  /**
   * The {@link ColabAssignedServer | servers} that have been added.
   */
  readonly added: readonly ColabAssignedServer[];

  /**
   * The {@link ColabAssignedServer | servers} that have been removed.
   */
  readonly removed: readonly {
    server: ColabAssignedServer;
    userInitiated: boolean;
  }[];

  /**
   * The {@link ColabAssignedServer | servers} that have been changed.
   */
  readonly changed: readonly ColabAssignedServer[];
}

export class AssignmentManager implements vscode.Disposable {
  /**
   * Event that fires when the server assignments change.
   */
  readonly onDidAssignmentsChange: vscode.Event<AssignmentChangeEvent>;

  private readonly assignmentChange: vscode.EventEmitter<AssignmentChangeEvent>;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly vs: typeof vscode,
    private readonly client: ColabClient,
    private readonly storage: ServerStorage,
  ) {
    this.assignmentChange = new vs.EventEmitter<AssignmentChangeEvent>();
    this.disposables.push(this.assignmentChange);
    this.onDidAssignmentsChange = this.assignmentChange.event;
    // TODO: Remove once https://github.com/microsoft/vscode-jupyter/issues/17094 is fixed.
    this.onDidAssignmentsChange((e) => {
      void this.notifyReloadNotebooks(e);
    });
  }

  dispose() {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  /**
   * Retrieves a list of available server descriptors that can be assigned.
   *
   * @returns A list of available server descriptors.
   */
  // TODO: Consider communicating which machines are available, but not to the
  // user at their tier (in the "ineligible" list).
  async getAvailableServerDescriptors(
    signal?: AbortSignal,
  ): Promise<ColabServerDescriptor[]> {
    const ccuInfo = await this.client.getCcuInfo(signal);

    const eligibleGpus = new Set(ccuInfo.eligibleGpus);
    const gpus: ColabServerDescriptor[] = Array.from(eligibleGpus).map((e) => ({
      label: `Colab GPU ${e}`,
      variant: Variant.GPU,
      accelerator: e,
    }));

    const eligibleTpus = new Set(ccuInfo.eligibleTpus);
    const tpus: ColabServerDescriptor[] = Array.from(eligibleTpus).map((e) => ({
      label: `Colab TPU ${e}`,
      variant: Variant.TPU,
      accelerator: e,
    }));

    return [DEFAULT_CPU_SERVER, ...gpus, ...tpus];
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
  async reconcileAssignedServers(signal?: AbortSignal): Promise<void> {
    const stored = await this.storage.list();
    if (stored.length === 0) {
      return;
    }
    const live = new Set(
      (await this.client.listAssignments(signal)).map((a) => a.endpoint),
    );
    const removed: ColabAssignedServer[] = [];
    const reconciled: ColabAssignedServer[] = [];
    for (const s of stored) {
      if (live.has(s.endpoint)) {
        reconciled.push(s);
      } else {
        removed.push(s);
      }
    }
    if (stored.length === reconciled.length) {
      return;
    }

    await this.storage.clear();
    await this.storage.store(reconciled);
    await this.signalChange({
      added: [],
      removed: removed.map((s) => ({ server: s, userInitiated: false })),
      changed: [],
    });
  }

  /**
   * Returns whether or not the user has at least one assigned server.
   */
  async hasAssignedServer(signal?: AbortSignal): Promise<boolean> {
    await this.reconcileAssignedServers(signal);
    return (await this.storage.list()).length > 0;
  }

  /**
   * Retrieves the list of servers that have been assigned in VS Code.
   *
   * @returns A list of assigned servers. Connection information is included
   * and can be refreshed by calling {@link refreshConnection}.
   */
  async getAssignedServers(
    signal?: AbortSignal,
  ): Promise<ColabAssignedServer[]> {
    await this.reconcileAssignedServers(signal);
    return (await this.storage.list()).map((server) => ({
      ...server,
      connectionInformation: {
        ...server.connectionInformation,
        fetch: colabProxyFetch(server.connectionInformation.token),
      },
    }));
  }

  /**
   * Retrieves the list of servers that have been created remotely (outside VS
   * Code).
   */
  async getRemoteServers(signal?: AbortSignal): Promise<ColabRemoteServer[]> {
    const stored = new Set(
      (await this.storage.list()).map((server) => server.endpoint),
    );
    return Promise.all(
      (await this.client.listAssignments(signal))
        .filter((assignment) => !stored.has(assignment.endpoint))
        .map(async (assignment) => {
          // For any remote servers created in Colab web UI, assuming there is
          // only one session per assignment.
          const sessions = await this.client.listSessions(
            assignment.endpoint,
            signal,
          );
          return {
            sessionId: sessions[0]?.id,
            label: sessions[0]?.name || UNKNOWN_REMOTE_SERVER_NAME,
            endpoint: assignment.endpoint,
            variant: assignment.variant,
            accelerator: assignment.accelerator,
          };
        }),
    );
  }

  /**
   * Retrieves the last known assigned servers from storage.
   *
   * Note: Connection information is stripped since the servers may no longer
   * exist. Downstream usage should refresh connection information, which
   * requires reconciliation.
   *
   * @returns A list of {@link ColabJupyterServer} objects without connection
   * information.
   */
  async getLastKnownAssignedServers(): Promise<ColabJupyterServer[]> {
    // Since we can't be sure the servers still exist, we strip the connection
    // info. That forces downstream usage to refresh the connection information,
    // which requires reconciliation.
    return (await this.storage.list()).map((server) => {
      const { connectionInformation, ...rest } = server;
      return rest;
    });
  }

  /**
   * Assigns a server.
   *
   * @param descriptor - The server descriptor used as a template for the server
   * being assigned.
   * @returns The assigned server.
   */
  async assignServer(
    descriptor: ColabServerDescriptor,
    signal?: AbortSignal,
  ): Promise<ColabAssignedServer> {
    const id = randomUUID();
    let assignment: Assignment;
    try {
      ({ assignment } = await this.client.assign(
        id,
        descriptor.variant,
        descriptor.accelerator,
        signal,
      ));
    } catch (error) {
      // TODO: Consider listing assignments to check if there are too many
      // before the user goes through the assignment flow. This handling logic
      // would still be needed for the rare race condition where an assignment
      // is made (e.g. in Colab web) during the extension assignment flow.
      if (error instanceof TooManyAssignmentsError) {
        void this.notifyMaxAssignmentsExceeded();
      }
      if (error instanceof InsufficientQuotaError) {
        void this.notifyInsufficientQuota(error);
      }
      if (error instanceof DenylistedError) {
        this.notifyBanned(error);
      }
      throw error;
    }
    const server = this.toAssignedServer(
      {
        id,
        label: descriptor.label,
        variant: assignment.variant,
        accelerator: assignment.accelerator,
      },
      assignment.endpoint,
      assignment.runtimeProxyInfo,
      new Date(),
    );
    await this.storage.store([server]);
    await this.signalChange({
      added: [server],
      removed: [],
      changed: [],
    });
    return server;
  }

  /**
   * @returns the latest currently assigned server. If there are none currently
   * assigned, a new one is created and returned.
   */
  async latestOrAutoAssignServer(
    signal?: AbortSignal,
  ): Promise<ColabAssignedServer> {
    const latest = await this.latestServer(signal);
    if (latest) {
      return latest;
    }
    const alias = await this.getDefaultLabel(
      DEFAULT_CPU_SERVER.variant,
      DEFAULT_CPU_SERVER.accelerator,
    );
    const serverType: ColabServerDescriptor = {
      ...DEFAULT_CPU_SERVER,
      label: alias,
    };
    return this.assignServer(serverType, signal);
  }

  /**
   * @returns The latest currently assigned server, or undefined if there are
   * currently none assigned.
   */
  async latestServer(
    signal?: AbortSignal,
  ): Promise<ColabAssignedServer | undefined> {
    const assigned = await this.getAssignedServers(signal);
    let latest: ColabAssignedServer | undefined;
    for (const server of assigned) {
      if (!latest || server.dateAssigned > latest.dateAssigned) {
        latest = server;
      }
    }
    return latest;
  }

  /**
   * Refreshes the connection information for a server.
   *
   * @param id - The ID of the assigned server to refresh.
   * @returns The server with updated connection information: its token and
   * fetch implementation.
   * @throws {@link NotFoundError} if there is no assigned server with the given
   * ID.
   */
  async refreshConnection(
    id: UUID,
    signal?: AbortSignal,
  ): Promise<ColabAssignedServer> {
    await this.reconcileAssignedServers(signal);
    const server = await this.storage.get(id);
    if (!server) {
      throw new NotFoundError("Server is not assigned");
    }
    const newConnectionInfo = await this.client.refreshConnection(
      server.endpoint,
      signal,
    );
    const updatedServer = this.toAssignedServer(
      server,
      server.endpoint,
      newConnectionInfo,
      server.dateAssigned,
    );
    await this.storage.store([updatedServer]);
    await this.signalChange({
      added: [],
      removed: [],
      changed: [updatedServer],
    });
    return updatedServer;
  }

  /**
   * Sets a context key indicating whether or not the user has at least one
   * assigned server originating from VS Code.
   */
  async setHasAssignedServerContext(signal?: AbortSignal): Promise<void> {
    await this.vs.commands.executeCommand(
      "setContext",
      "colab.hasAssignedServer",
      await this.hasAssignedServer(signal),
    );
  }

  /**
   * Unassigns the given server.
   *
   * Deletes all kernel sessions for the specified server before
   * unassigning. Only unassigns if all session deletions succeed.
   *
   * @param server - The server to remove.
   */
  async unassignServer(
    server: ColabAssignedServer | ColabRemoteServer,
    signal?: AbortSignal,
  ): Promise<void> {
    if (isInstanceOfColabAssignedServer(server)) {
      await this.unassignVsCodeServer(server, signal);
    } else {
      await this.unassignRemoteColabServer(server, signal);
    }
  }

  async getDefaultLabel(
    variant: Variant,
    accelerator?: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const servers = await this.getAssignedServers(signal);
    const a = accelerator && accelerator !== "NONE" ? ` ${accelerator}` : "";
    const v = variantToMachineType(variant);
    const labelBase = `Colab ${v}${a}`;
    const labelRegex = new RegExp(`^${labelBase}(?:\\s\\((\\d+)\\))?$`);
    const indices = new Set(
      servers
        .map((s) => {
          const match = labelRegex.exec(s.label);
          if (!match) {
            return null;
          }
          if (!match[1]) {
            return 0;
          }
          return +match[1];
        })
        .filter((i) => i !== null),
    );
    let placeholderIdx = 0;
    // Find the first missing index. Follows standard file explorer "duplicate"
    // file naming scheme.
    while (indices.has(placeholderIdx)) {
      placeholderIdx++;
    }
    if (placeholderIdx === 0) {
      return labelBase;
    }
    return `${labelBase} (${placeholderIdx.toString()})`;
  }

  private async unassignVsCodeServer(
    server: ColabAssignedServer,
    signal?: AbortSignal,
  ): Promise<void> {
    const removed = await this.storage.remove(server.id);
    if (!removed) {
      return;
    }
    await this.signalChange({
      added: [],
      removed: [{ server, userInitiated: true }],
      changed: [],
    });
    await Promise.all(
      (await this.client.listSessions(server, signal)).map((session) =>
        this.client.deleteSession(server, session.id, signal),
      ),
    );
    await this.client.unassign(server.endpoint, signal);
  }

  private async unassignRemoteColabServer(
    server: ColabRemoteServer,
    signal?: AbortSignal,
  ): Promise<void> {
    if (server.sessionId) {
      await this.client.deleteSession(
        server.endpoint,
        server.sessionId,
        signal,
      );
    }
    await this.client.unassign(server.endpoint, signal);
  }

  private async signalChange(e: AssignmentChangeEvent): Promise<void> {
    // Since signalling a change happens after the change was actually
    // committed, we don't specify an abort signal.
    await this.setHasAssignedServerContext();
    this.assignmentChange.fire(e);
  }

  private toAssignedServer(
    server: ColabJupyterServer,
    endpoint: string,
    connectionInfo: RuntimeProxyInfo,
    dateAssigned: Date,
  ): ColabAssignedServer {
    const { url, token } = connectionInfo;
    const headers: Record<string, string> =
      server.connectionInformation?.headers ?? {};
    headers[COLAB_RUNTIME_PROXY_TOKEN_HEADER.key] = token;
    headers[COLAB_CLIENT_AGENT_HEADER.key] = COLAB_CLIENT_AGENT_HEADER.value;

    return {
      id: server.id,
      label: server.label,
      variant: server.variant,
      accelerator: server.accelerator,
      endpoint: endpoint,
      connectionInformation: {
        baseUrl: this.vs.Uri.parse(url),
        token,
        tokenExpiry: new Date(
          Date.now() + connectionInfo.tokenExpiresInSeconds * 1000,
        ),
        headers,
        fetch: colabProxyFetch(token),
      },
      dateAssigned,
    };
  }

  private async notifyMaxAssignmentsExceeded() {
    // TODO: Account for subscription tiers in actions.
    // TODO: Account for the number of assignments from the VS Code and Colab
    // UIs in the error message and actions.
    const selectedAction = await this.vs.window.showErrorMessage(
      "Unable to assign server. You have too many, remove one to continue.",
      (await this.hasAssignedServer())
        ? AssignmentsExceededActions.REMOVE_SERVER
        : AssignmentsExceededActions.REMOVE_SERVER_COLAB_WEB,
    );
    switch (selectedAction) {
      case AssignmentsExceededActions.REMOVE_SERVER:
        this.vs.commands.executeCommand("colab.removeServer");
        return;
      case AssignmentsExceededActions.REMOVE_SERVER_COLAB_WEB:
        this.vs.env.openExternal(
          this.vs.Uri.parse("https://colab.research.google.com/"),
        );
        return;
      default:
        return;
    }
  }

  // TODO: Account for subscription tiers in actions.
  private async notifyInsufficientQuota(error: InsufficientQuotaError) {
    const selectedAction = await this.vs.window.showErrorMessage(
      `Unable to assign server. ${error.message}`,
      LEARN_MORE,
    );
    if (selectedAction === LEARN_MORE) {
      this.vs.env.openExternal(
        this.vs.Uri.parse(
          "https://research.google.com/colaboratory/faq.html#resource-limits",
        ),
      );
    }
  }

  private notifyBanned(error: DenylistedError) {
    void this.vs.window.showErrorMessage(
      `Unable to assign server. ${error.message}`,
    );
  }

  private async notifyReloadNotebooks(e: AssignmentChangeEvent) {
    const numRemoved = e.removed.length;
    if (numRemoved === 0) {
      return;
    }

    const removed = e.removed.map((r) => r.server.label);
    const serverDescriptor =
      removed.length === 1
        ? `${removed[0]} was`
        : `${removed.slice(0, numRemoved - 1).join(", ")} and ${removed[numRemoved - 1]} were`;
    const viewIssue = await this.vs.window.showInformationMessage(
      `To work around [microsoft/vscode-jupyter #17094](https://github.com/microsoft/vscode-jupyter/issues/17094) - please re-open notebooks ${serverDescriptor} previously connected to.`,
      `View Issue`,
    );
    if (viewIssue) {
      this.vs.env.openExternal(
        this.vs.Uri.parse(
          "https://github.com/microsoft/vscode-jupyter/issues/17094",
        ),
      );
    }
  }
}

enum AssignmentsExceededActions {
  REMOVE_SERVER = "Remove Server",
  REMOVE_SERVER_COLAB_WEB = "Remove Server at Colab Web",
}

const LEARN_MORE = "Learn More";

const UNKNOWN_REMOTE_SERVER_NAME = "Untitled";

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
    headers.append(COLAB_RUNTIME_PROXY_TOKEN_HEADER.key, token);
    headers.append(
      COLAB_CLIENT_AGENT_HEADER.key,
      COLAB_CLIENT_AGENT_HEADER.value,
    );
    init.headers = headers;

    return fetch(info, init);
  };
}

function isRequest(info: RequestInfo): info is Request {
  return typeof info !== "string" && !("href" in info);
}

export const TEST_ONLY = {
  UNKNOWN_REMOTE_SERVER_NAME,
};
