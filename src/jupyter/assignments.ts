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
  Accelerator,
  Assignment,
  RuntimeProxyInfo,
  Variant,
  variantToMachineType,
} from "../colab/api";
import {
  ColabClient,
  DenylistedError,
  InsufficientQuotaError,
  TooManyAssignmentsError,
} from "../colab/client";
import {
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
} from "../colab/headers";
import {
  COLAB_SERVERS,
  ColabAssignedServer,
  ColabJupyterServer,
  ColabServerDescriptor,
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
  async getAvailableServerDescriptors(): Promise<ColabServerDescriptor[]> {
    const ccuInfo = await this.client.getCcuInfo();
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
  async hasAssignedServer(): Promise<boolean> {
    await this.reconcileAssignedServers();
    return (await this.storage.list()).length > 0;
  }

  /**
   * Retrieves the list of servers that have been assigned.
   *
   * @returns A list of assigned servers. Connection information is included
   * and can be refreshed by calling {@link refreshConnection}.
   */
  async getAssignedServers(): Promise<ColabAssignedServer[]> {
    await this.reconcileAssignedServers();
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
   * @param descriptor - The server descriptor used as a template for the server
   * being assigned.
   * @returns The assigned server.
   */
  async assignServer(
    descriptor: ColabServerDescriptor,
  ): Promise<ColabAssignedServer> {
    const id = randomUUID();
    let assignment: Assignment;
    try {
      ({ assignment } = await this.client.assign(
        id,
        descriptor.variant,
        descriptor.accelerator,
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
   * Refreshes the connection information for a server.
   *
   * @param id - The ID of the assigned server to refresh.
   * @returns The server with updated connection information: its token and
   * fetch implementation.
   * @throws If there is no assigned server with the given ID.
   */
  async refreshConnection(id: UUID): Promise<ColabAssignedServer> {
    await this.reconcileAssignedServers();
    const server = await this.storage.get(id);
    if (!server) {
      throw new Error("Server is not assigned.");
    }
    const newConnectionInfo = await this.client.refreshConnection(
      server.endpoint,
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
  async setHasAssignedServerContext(): Promise<void> {
    await this.vs.commands.executeCommand(
      "setContext",
      "colab.hasAssignedServer",
      await this.hasAssignedServer(),
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
  async unassignServer(server: ColabAssignedServer): Promise<void> {
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
      (await this.client.listSessions(server)).map((session) =>
        this.client.deleteSession(server, session.id),
      ),
    );
    await this.client.unassign(server.endpoint);
  }

  async getDefaultLabel(
    variant: Variant,
    accelerator?: Accelerator,
  ): Promise<string> {
    const servers = await this.getAssignedServers();
    const a =
      accelerator && accelerator !== Accelerator.NONE ? ` ${accelerator}` : "";
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

  private async signalChange(e: AssignmentChangeEvent): Promise<void> {
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
}

enum AssignmentsExceededActions {
  REMOVE_SERVER = "Remove Server",
  REMOVE_SERVER_COLAB_WEB = "Remove Server at Colab Web",
}

const LEARN_MORE = "Learn More";

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
