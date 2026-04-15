/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID, UUID } from 'crypto';
import fetch, {
  Headers,
  Request,
  RequestInfo,
  RequestInit,
  Response,
} from 'node-fetch';
import vscode, { Disposable } from 'vscode';
import {
  Assignment,
  ListedAssignment,
  RuntimeProxyToken,
  Variant,
  variantToMachineType,
  SubscriptionTier,
  Shape,
  isHighMemOnlyAccelerator,
} from '../colab/api';
import {
  AcceleratorUnavailableError,
  ColabClient,
  DenylistedError,
  InsufficientQuotaError,
  NotFoundError,
  TooManyAssignmentsError,
} from '../colab/client';
import { REMOVE_SERVER } from '../colab/commands/constants';
import {
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
} from '../colab/headers';
import { log } from '../common/logging';
import { telemetry } from '../telemetry';
import { CommandSource } from '../telemetry/api';
import { ProxiedJupyterClient } from './client';
import { colabProxyWebSocket } from './colab-proxy-websocket';
import {
  AllServers,
  ColabAssignedServer,
  ColabJupyterServer,
  ColabServerDescriptor,
  DEFAULT_CPU_SERVER,
  isColabAssignedServer,
  UnownedServer,
} from './servers';
import { ServerStorage } from './storage';

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

/**
 * Manages Colab server assignments for the extension.
 */
export class AssignmentManager implements Disposable {
  /**
   * Event that fires when the server assignments change.
   */
  readonly onDidAssignmentsChange: vscode.Event<AssignmentChangeEvent>;

  private readonly assignmentChange: vscode.EventEmitter<AssignmentChangeEvent>;
  private isDisposed = false;

  /**
   * Initializes a new instance.
   *
   * @param vs - The VS Code API instance.
   * @param client - The API client instance.
   * @param storage - The storage instance for persistence.
   */
  constructor(
    private readonly vs: typeof vscode,
    private readonly client: ColabClient,
    private readonly storage: ServerStorage,
  ) {
    this.assignmentChange = new vs.EventEmitter<AssignmentChangeEvent>();
    this.onDidAssignmentsChange = this.assignmentChange.event;
    // TODO: Remove once https://github.com/microsoft/vscode-jupyter/issues/17094 is fixed.
    this.onDidAssignmentsChange((e) => {
      void this.notifyReloadNotebooks(e);
    });
  }

  /**
   * Disposes the manager.
   */
  dispose() {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    this.assignmentChange.dispose();
  }

  /**
   * Retrieves a list of available server descriptors that can be assigned.
   *
   * @param signal - An optional {@link AbortSignal} to cancel the operation.
   * @returns A list of available server descriptors.
   */
  // TODO: Consider communicating which machines are available, but not to the
  // user at their tier (in the "ineligible" list).
  async getAvailableServerDescriptors(
    signal?: AbortSignal,
  ): Promise<ColabServerDescriptor[]> {
    this.guardDisposed();
    const userInfo = await this.client.getUserInfo(signal);

    const eligibleDescriptors: ColabServerDescriptor[] =
      userInfo.eligibleAccelerators.flatMap((acc) =>
        acc.models.map((model) => ({
          label: `Colab ${acc.variant} ${model}`,
          variant: acc.variant,
          accelerator: model,
        })),
      );

    const defaultDescriptors = [DEFAULT_CPU_SERVER, ...eligibleDescriptors];
    if (userInfo.subscriptionTier === SubscriptionTier.NONE) {
      return defaultDescriptors;
    }

    const proDescriptors = [];
    for (const descriptor of defaultDescriptors) {
      if (!isHighMemOnlyAccelerator(descriptor.accelerator)) {
        proDescriptors.push({ ...descriptor, shape: Shape.STANDARD });
      }
      proDescriptors.push({ ...descriptor, shape: Shape.HIGHMEM });
    }
    return proDescriptors;
  }

  /**
   * Reconciles the managed list of assigned servers with those that Colab knows
   * about.
   *
   * Note that it's possible Colab has assignments which did not originate from
   * VS Code. Naturally, those cannot be "reconciled". They are not added to the
   * managed list of assigned servers. In other words, assignments originating
   * from Colab-web will not show in VS Code.
   *
   * @param signal - The cancellation signal.
   */
  async reconcileAssignedServers(signal?: AbortSignal): Promise<void> {
    this.guardDisposed();
    const stored = await this.storage.list();
    if (stored.length === 0) {
      return;
    }
    const live = await this.client.listAssignments(signal);
    await this.reconcileStoredServers(stored, live);
  }

  /**
   * Returns whether or not the user has at least one assigned server.
   *
   * @param signal - The cancellation signal.
   * @returns True if the user has at least one assigned server, false
   * otherwise.
   */
  async hasAssignedServer(signal?: AbortSignal): Promise<boolean> {
    this.guardDisposed();
    await this.reconcileAssignedServers(signal);
    return (await this.storage.list()).length > 0;
  }

  /**
   * Retrieves the list of servers that have been assigned in the VS Code
   * extension.
   *
   * @returns A list of assigned servers. Connection information is included
   * and can be refreshed by calling {@link refreshConnection}.
   */
  async getServers(
    from: 'extension',
    signal?: AbortSignal,
  ): Promise<ColabAssignedServer[]>;

  /**
   * Retrieves the list of servers that have been assigned externally outside
   * the VS Code extension.
   */
  async getServers(
    from: 'external',
    signal?: AbortSignal,
  ): Promise<UnownedServer[]>;

  /**
   * Retrieves the list of all servers that are assigned both in and outside VS
   * Code.
   */
  async getServers(from: 'all', signal?: AbortSignal): Promise<AllServers>;

  /**
   * Retrieves the list of servers that have been assigned, based on the
   * provided origin.
   *
   * @param from - The origin URI.
   * @param signal - The cancellation signal.
   * @returns the collection of relevant servers based on the provided origin.
   */
  async getServers(
    from: 'extension' | 'external' | 'all',
    signal?: AbortSignal,
  ): Promise<ColabAssignedServer[] | UnownedServer[] | AllServers> {
    this.guardDisposed();
    let storedServers = await this.storage.list();
    if (from === 'extension' && storedServers.length === 0) {
      return storedServers;
    }

    const allAssignments = await this.client.listAssignments(signal);

    if (from === 'extension' || from === 'all') {
      storedServers = (
        await this.reconcileStoredServers(storedServers, allAssignments)
      ).map((server) => {
        const c = server.connectionInformation;
        return {
          ...server,
          connectionInformation: {
            ...c,
            fetch: colabProxyFetch(c.token),
            WebSocket: colabProxyWebSocket(this.vs, this.client, server),
          },
        };
      });
    }

    let unownedServers: UnownedServer[] = [];
    if (from === 'external' || from === 'all') {
      const storedEndpointSet = new Set(storedServers.map((s) => s.endpoint));
      unownedServers = await Promise.all(
        allAssignments
          .filter((a) => !storedEndpointSet.has(a.endpoint))
          .map(async (a) => {
            // For any remote servers created in Colab web UI, assuming there is
            // only one session per assignment.
            const sessions = await this.client.listSessions(a.endpoint, signal);
            const label =
              sessions.length === 1 && sessions[0].name?.length
                ? sessions[0].name
                : UNKNOWN_REMOTE_SERVER_NAME;
            return {
              label,
              endpoint: a.endpoint,
              variant: a.variant,
              accelerator: a.accelerator,
            };
          }),
      );
    }

    switch (from) {
      case 'extension':
        return storedServers;
      case 'external':
        return unownedServers;
      default:
        return {
          assigned: storedServers,
          unowned: unownedServers,
        };
    }
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
    this.guardDisposed();
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
   * @param signal - The cancellation signal.
   * @returns The assigned server.
   */
  async assignServer(
    descriptor: ColabServerDescriptor,
    signal?: AbortSignal,
  ): Promise<ColabAssignedServer> {
    this.guardDisposed();
    const id = randomUUID();
    const { label, variant, accelerator, shape, version } = descriptor;
    let assignment: Assignment;
    try {
      if (isColabServerDescriptorWithAccelerator(descriptor)) {
        assignment = await this.assignWithFallback(
          id,
          descriptor,
          /* fallbacks= */ undefined,
          signal,
        );
      } else {
        ({ assignment } = await this.client.assign(
          id,
          { variant, accelerator, shape, version },
          signal,
        ));
      }
    } catch (error) {
      log.trace(`Failed assigning server ${id}`, error);
      if (error instanceof AllAcceleratorsUnavailableError) {
        void this.notifyAllAcceleratorsUnavailable(error);
      }
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
        label,
        variant: assignment.variant,
        accelerator: assignment.accelerator,
      },
      assignment.endpoint,
      assignment.runtimeProxyInfo,
      new Date(),
    );
    await this.storage.store([server]);
    this.assignmentChange.fire({
      added: [server],
      removed: [],
      changed: [],
    });
    return server;
  }

  /**
   * Gets the latest assigned server, or assigns a new one with the default
   * config (standard CPU).
   *
   * @param signal - The cancellation signal.
   * @returns the latest currently assigned server, or a new default server if
   * none are currently assigned.
   */
  async latestOrAutoAssignServer(
    signal?: AbortSignal,
  ): Promise<ColabAssignedServer> {
    this.guardDisposed();
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
   * Gets the latest server that was assigned.
   *
   * @param signal - The cancellation signal.
   * @returns The latest currently assigned server, or undefined if there are
   * currently none assigned.
   */
  async latestServer(
    signal?: AbortSignal,
  ): Promise<ColabAssignedServer | undefined> {
    this.guardDisposed();
    const assigned = await this.getServers('extension', signal);
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
   * @param signal - The cancellation signal.
   * @returns The server with updated connection information: its token and
   * fetch implementation.
   * @throws {@link NotFoundError} if there is no assigned server with the given
   * ID.
   */
  async refreshConnection(
    id: UUID,
    signal?: AbortSignal,
  ): Promise<ColabAssignedServer> {
    this.guardDisposed();
    await this.reconcileAssignedServers(signal);
    const server = await this.storage.get(id);
    if (!server) {
      throw new NotFoundError('Server is not assigned');
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
    this.assignmentChange.fire({
      added: [],
      removed: [],
      changed: [updatedServer],
    });
    return updatedServer;
  }
  /**
   * Unassigns the given server.
   *
   * For `ColabAssignedServer` assigned by VS Code, deletes all kernel sessions
   * for the specified server before unassigning. Only unassigns if all session
   * deletions succeed.
   *
   * For `UnownedServer` assigned outside VS Code, simply unassigns the
   * server without deleting the sessions. This is because we don't have access
   * to delete those sessions and it's not mandatory to do so.
   *
   * @param server - The server to remove.
   * @param signal - The cancellation signal.
   */
  async unassignServer(
    server: ColabAssignedServer | UnownedServer,
    signal?: AbortSignal,
  ): Promise<void> {
    this.guardDisposed();
    if (!isColabAssignedServer(server)) {
      await this.client.unassign(server.endpoint, signal);
      return;
    }

    const stored = await this.storage.get(server.id);
    if (!stored) {
      return;
    }
    const client = ProxiedJupyterClient.withStaticConnection(server);
    await Promise.all(
      (await client.sessions.list({ signal })).map((session) =>
        session.id
          ? client.sessions.delete({ session: session.id }, { signal })
          : Promise.resolve(),
      ),
    );
    await this.client.unassign(server.endpoint, signal);
    const removed = await this.storage.remove(server.id);
    if (!removed) {
      return;
    }
    this.assignmentChange.fire({
      added: [],
      removed: [{ server, userInitiated: true }],
      changed: [],
    });
  }

  /**
   * Gets the default label for the provided variant/accelerator pair.
   *
   * @param variant - The model variant.
   * @param accelerator - The requested accelerator type.
   * @param signal - The cancellation signal.
   * @returns The next auto-incrementing default label. E.g. "Colab CPU" for the
   * first CPU, "Colab CPU (1)" for the second, and so on.
   */
  async getDefaultLabel(
    variant: Variant,
    accelerator?: string,
    signal?: AbortSignal,
  ): Promise<string> {
    this.guardDisposed();
    const servers = await this.getServers('extension', signal);
    const a = accelerator && accelerator !== 'NONE' ? ` ${accelerator}` : '';
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

  private guardDisposed() {
    if (this.isDisposed) {
      throw new Error(
        'Cannot use AssignmentManager after it has been disposed',
      );
    }
  }

  private async reconcileStoredServers(
    storedServers: ColabAssignedServer[],
    liveAssignments: ListedAssignment[],
  ): Promise<ColabAssignedServer[]> {
    const liveEndpointSet = new Set(liveAssignments.map((a) => a.endpoint));
    const removed: ColabAssignedServer[] = [];
    const reconciled: ColabAssignedServer[] = [];
    for (const s of storedServers) {
      if (liveEndpointSet.has(s.endpoint)) {
        reconciled.push(s);
      } else {
        removed.push(s);
      }
    }
    if (storedServers.length === reconciled.length) {
      return reconciled;
    }

    telemetry.logPruneServers(removed.map((s) => s.endpoint));
    await this.storage.clear();
    await this.storage.store(reconciled);
    this.assignmentChange.fire({
      added: [],
      removed: removed.map((s) => ({ server: s, userInitiated: false })),
      changed: [],
    });
    return reconciled;
  }

  private async assignWithFallback(
    id: UUID,
    descriptor: ColabServerDescriptorWithAccelerator,
    fallback?: {
      toAttempt: string[];
      attempted: string[];
    },
    signal?: AbortSignal,
  ): Promise<Assignment> {
    const { variant, accelerator, shape, version } = descriptor;
    try {
      const { assignment } = await this.client.assign(
        id,
        { variant, accelerator, shape, version },
        signal,
      );
      const original = fallback?.attempted
        ? fallback.attempted[0]
        : accelerator;
      if (original !== accelerator) {
        void this.vs.window.showInformationMessage(
          `Requested accelerator "${original}" is unavailable, assigned "${accelerator}"`,
        );
      }
      return assignment;
    } catch (error) {
      if (!(error instanceof AcceleratorUnavailableError)) {
        throw error;
      }
      let newFallback: typeof fallback;
      // The initial attempt failed, start falling back.
      if (!fallback) {
        const all = await this.getAvailableServerDescriptors(signal);
        const toAttempt = new Set<string>();
        for (const d of all) {
          if (
            d.variant === variant &&
            d.accelerator &&
            d.accelerator !== accelerator
          ) {
            toAttempt.add(d.accelerator);
          }
        }
        newFallback = {
          toAttempt: Array.from(toAttempt),
          attempted: [accelerator],
        };
      } else {
        newFallback = {
          toAttempt: fallback.toAttempt.slice(1),
          attempted: [
            ...fallback.attempted,
            fallback.toAttempt[0], // The one that just failed.
          ],
        };
      }
      if (newFallback.toAttempt.length === 0) {
        throw new AllAcceleratorsUnavailableError(
          variant,
          newFallback.attempted,
        );
      }
      log.info(
        `Assignment failed with unavailable accelerator ${accelerator}, retrying with ${newFallback.toAttempt[0]}`,
      );
      return this.assignWithFallback(
        id,
        { ...descriptor, accelerator: newFallback.toAttempt[0] },
        newFallback,
        signal,
      );
    }
  }

  private toAssignedServer(
    server: ColabJupyterServer,
    endpoint: string,
    connectionInfo: RuntimeProxyToken,
    dateAssigned: Date,
  ): ColabAssignedServer {
    const { url, token } = connectionInfo;
    const headers: Record<string, string> =
      server.connectionInformation?.headers ?? {};
    headers[COLAB_RUNTIME_PROXY_TOKEN_HEADER.key] = token;
    headers[COLAB_CLIENT_AGENT_HEADER.key] = COLAB_CLIENT_AGENT_HEADER.value;

    const colabServer: ColabAssignedServer = {
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
    return {
      ...colabServer,
      connectionInformation: {
        ...colabServer.connectionInformation,
        WebSocket: colabProxyWebSocket(this.vs, this.client, colabServer),
      },
    };
  }

  private async notifyAllAcceleratorsUnavailable(
    error: AllAcceleratorsUnavailableError,
  ) {
    void (await this.vs.window.showErrorMessage(
      `Unable to assign server. ${error.message}`,
    ));
  }

  private async notifyMaxAssignmentsExceeded() {
    // TODO: Account for subscription tiers in actions.
    const selectedAction = await this.vs.window.showErrorMessage(
      'Unable to assign server. You have too many, remove one to continue.',
      AssignmentsExceededActions.REMOVE_SERVER,
    );
    switch (selectedAction) {
      case AssignmentsExceededActions.REMOVE_SERVER:
        this.vs.commands.executeCommand(
          REMOVE_SERVER.id,
          CommandSource.COMMAND_SOURCE_NOTIFICATION,
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
          'https://research.google.com/colaboratory/faq.html#resource-limits',
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
        : `${removed.slice(0, numRemoved - 1).join(', ')} and ${removed[numRemoved - 1]} were`;
    const viewIssue = await this.vs.window.showInformationMessage(
      `To work around [microsoft/vscode-jupyter #17094](https://github.com/microsoft/vscode-jupyter/issues/17094) - please re-open notebooks ${serverDescriptor} previously connected to.`,
      `View Issue`,
    );
    if (viewIssue) {
      this.vs.env.openExternal(
        this.vs.Uri.parse(
          'https://github.com/microsoft/vscode-jupyter/issues/17094',
        ),
      );
    }
  }
}

enum AssignmentsExceededActions {
  REMOVE_SERVER = 'Remove Server',
}

const LEARN_MORE = 'Learn More';

const UNKNOWN_REMOTE_SERVER_NAME = 'Untitled';

class AllAcceleratorsUnavailableError extends Error {
  constructor(
    variant: string,
    readonly attempted: string[],
  ) {
    const l = attempted.join(', ');
    const msg = `All ${variant} accelerators are unavailable: ${l}`;
    super(msg);
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
 *
 * @param token - The cancellation token.
 * @returns A fetch function that adds the Colab runtime proxy token as a
 * header.
 */
function colabProxyFetch(
  token: string,
): (info: RequestInfo, init?: RequestInit) => Promise<Response> {
  return async (info: RequestInfo, init?: RequestInit) => {
    if (isRequest(info)) {
      // Ensure compatibility with `node-fetch`
      info = new Request(info.url, info);
    }

    const headers = new Headers(isRequest(info) ? info.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set(COLAB_RUNTIME_PROXY_TOKEN_HEADER.key, token);
    headers.set(
      COLAB_CLIENT_AGENT_HEADER.key,
      COLAB_CLIENT_AGENT_HEADER.value,
    );
    init = { ...init, headers };

    return fetch(info, init);
  };
}

function isRequest(info: RequestInfo): info is Request {
  return typeof info !== 'string' && !('href' in info);
}

type ColabServerDescriptorWithAccelerator = ColabServerDescriptor & {
  accelerator: string;
};

function isColabServerDescriptorWithAccelerator(
  descriptor: ColabServerDescriptor,
): descriptor is ColabServerDescriptorWithAccelerator {
  return !!descriptor.accelerator;
}
