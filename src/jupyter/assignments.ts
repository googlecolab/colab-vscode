/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'assert';
import { randomUUID, UUID } from 'crypto';
import fetch, {
  Headers,
  Request,
  RequestInfo,
  RequestInit,
  Response,
} from 'node-fetch';
import vscode, { Disposable } from 'vscode';
import { ColabClient } from '../colab/client/v1';
import {
  Assignment,
  ListedAssignment,
  RuntimeProxyToken,
  variantToMachineType,
  isHighMemOnlyAccelerator,
  ExperimentFlag,
} from '../colab/client/v1/api';
import {
  ColabApiClient,
  denormalizeShape,
  denormalizeVariant,
  normalizeShape,
  normalizeVariant,
  throwIfOperationError,
} from '../colab/client/v2';
import {
  CreateRuntimeOperation,
  ConnectionInfo,
  Runtime,
  instanceOfRuntime,
} from '../colab/client/v2/generated/colab';
import { REMOVE_SERVER } from '../colab/commands/constants';
import {
  AcceleratorUnavailableError,
  DenylistedError,
  InsufficientQuotaError,
  NotFoundError,
  TooManyAssignmentsError,
  WaitOperationTimeoutError,
} from '../colab/errors';
import { getFlag } from '../colab/experiment-state';
import {
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
} from '../colab/headers';
import { Shape, SubscriptionTier, Variant } from '../colab/types';
import { waitForTimeout } from '../common/async';
import { log } from '../common/logging';
import { FetchError as JupyterFetchError } from '../jupyter/client/generated';
import { telemetry } from '../telemetry';
import { AssignmentOutcome, CommandSource } from '../telemetry/api';
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
   * @param colabClient - The old Colab private API client instance.
   * @param colabApiClient - The new Colab public API client instance.
   * @param storage - The storage instance for persistence.
   */
  constructor(
    private readonly vs: typeof vscode,
    private readonly colabClient: ColabClient,
    private readonly colabApiClient: ColabApiClient,
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
    const enablePublicApi = getFlag(ExperimentFlag.EnablePublicApi);
    if (enablePublicApi) {
      // The new ListRuntimeSpecs API already takes user's subscription tier
      // into account, returning with the correct eligibility info. The new API
      // also returns additional high-memory shapes for the Pro users, so we
      // don't need to manually add them.
      const response = await this.colabApiClient.colab.listRuntimeSpecs(
        /* requestParameters= */ {},
        /* initOverrides= */ { signal },
      );
      return (
        response.runtimeSpecs
          ?.filter((spec) => spec.eligible)
          .map((spec) => {
            const variant = normalizeVariant(spec.key.variant);
            const shape = normalizeShape(spec.key.shape);
            const accelerator = spec.key.accelerator;
            const label =
              variant === Variant.DEFAULT
                ? 'Colab CPU'
                : `Colab ${variant} ${accelerator}`;
            return { label, variant, accelerator, shape };
          }) ?? []
      );
    }

    const userInfo = await this.colabClient.getUserInfo(signal);

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

    const enablePublicApi = getFlag(ExperimentFlag.EnablePublicApi);
    let live: ListedAssignment[] | Runtime[];
    if (enablePublicApi) {
      live =
        (
          await this.colabApiClient.colab.listRuntimes(
            /* requestParameters= */ {},
            { signal },
          )
        ).runtimes ?? [];
    } else {
      live = await this.colabClient.listAssignments(signal);
    }
    await this.reconcileStoredServers(
      stored,
      live.map((a) => getEndpoint(a)),
    );
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

    const enablePublicApi = getFlag(ExperimentFlag.EnablePublicApi);
    let allAssignments: ListedAssignment[] | Runtime[];
    if (enablePublicApi) {
      allAssignments =
        (
          await this.colabApiClient.colab.listRuntimes(
            /* requestParameters= */ {},
            { signal },
          )
        ).runtimes ?? [];
    } else {
      allAssignments = await this.colabClient.listAssignments(signal);
    }

    if (from === 'extension' || from === 'all') {
      storedServers = (
        await this.reconcileStoredServers(
          storedServers,
          allAssignments.map((a) => getEndpoint(a)),
        )
      ).map((server) => {
        const c = server.connectionInformation;
        return {
          ...server,
          connectionInformation: {
            ...c,
            fetch: colabProxyFetch(c.token),
            WebSocket: colabProxyWebSocket(this.vs, this.colabClient, server),
          },
        };
      });
    }

    let unownedServers: UnownedServer[] = [];
    if (from === 'external' || from === 'all') {
      unownedServers = await this.getUnownedServers(
        allAssignments,
        storedServers,
        signal,
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
    let outcome = AssignmentOutcome.ASSIGNMENT_OUTCOME_UNSPECIFIED;
    let hadFallback = false;
    const enablePublicApi = getFlag(ExperimentFlag.EnablePublicApi);
    try {
      let assignmentOrRuntime: Assignment | Runtime;
      try {
        if (isColabServerDescriptorWithAccelerator(descriptor)) {
          assignmentOrRuntime = await this.assignWithFallback(
            descriptor,
            /* id= */ enablePublicApi ? undefined : id,
            /* fallback= */ undefined,
            signal,
          );
          if (instanceOfRuntime(assignmentOrRuntime)) {
            hadFallback =
              assignmentOrRuntime.runtimeSpec.accelerator !==
              descriptor.accelerator;
          } else {
            hadFallback =
              assignmentOrRuntime.accelerator !== descriptor.accelerator;
          }
        } else {
          if (enablePublicApi) {
            assignmentOrRuntime = await this.createRuntime(descriptor, signal);
          } else {
            ({ assignment: assignmentOrRuntime } =
              await this.colabClient.assign(
                id,
                { variant, accelerator, shape, version },
                signal,
              ));
          }
        }
      } catch (error) {
        log.trace(`Failed assigning server ${id}`, error);
        outcome = errorToAssignmentOutcome(error);
        if (error instanceof AllAcceleratorsUnavailableError) {
          hadFallback = error.attempted.length > 1;
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

      let server: ColabAssignedServer;
      if (instanceOfRuntime(assignmentOrRuntime)) {
        assert(assignmentOrRuntime.name);
        const runtimeId = trimPrefix(assignmentOrRuntime.name, 'runtimes/');
        const c = assignmentOrRuntime.connectionInfo;
        assert(c, `ConnectionInfo is missing in runtime: ${runtimeId}}`);
        server = this.toAssignedServer(
          {
            id: runtimeId,
            label,
            variant: normalizeVariant(assignmentOrRuntime.runtimeSpec.variant),
            accelerator: assignmentOrRuntime.runtimeSpec.accelerator,
            shape: normalizeShape(assignmentOrRuntime.runtimeSpec.shape),
            version: assignmentOrRuntime.version,
          },
          c.endpoint,
          c,
          new Date(),
        );
      } else {
        server = this.toAssignedServer(
          {
            id,
            label,
            variant: assignmentOrRuntime.variant,
            accelerator: assignmentOrRuntime.accelerator,
          },
          assignmentOrRuntime.endpoint,
          assignmentOrRuntime.runtimeProxyInfo,
          new Date(),
        );
      }
      await this.storage.store([server]);
      this.assignmentChange.fire({
        added: [server],
        removed: [],
        changed: [],
      });
      outcome = AssignmentOutcome.ASSIGNMENT_OUTCOME_SUCCEEDED;
      return server;
    } finally {
      telemetry.logAssignServer(outcome, {
        variant,
        accelerator: accelerator ?? '',
        shape: shape !== undefined ? Shape[shape] : '',
        version: version ?? '',
        hadFallback,
      });
    }
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
    id: string,
    signal?: AbortSignal,
  ): Promise<ColabAssignedServer> {
    this.guardDisposed();
    await this.reconcileAssignedServers(signal);
    const server = await this.storage.get(id);
    if (!server) {
      throw new NotFoundError('Server is not assigned');
    }
    const newConnectionInfo = await this.colabClient.refreshConnection(
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
      await this.colabClient.unassign(server.endpoint, signal);
      return;
    }

    const stored = await this.storage.get(server.id);
    if (!stored) {
      return;
    }
    await this.deleteSessions(server, signal);
    await this.colabClient.unassign(server.endpoint, signal);
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
    liveEndpoints: string[],
  ): Promise<ColabAssignedServer[]> {
    const liveEndpointSet = new Set(liveEndpoints);
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
    descriptor: ColabServerDescriptorWithAccelerator,
    id?: UUID,
    fallback?: {
      toAttempt: string[];
      attempted: string[];
    },
    signal?: AbortSignal,
  ): Promise<Assignment | Runtime> {
    const { variant, accelerator, shape, version } = descriptor;
    try {
      let assignment: Assignment | Runtime;
      if (id) {
        // Take the old v1 route if an `id` is passed in.
        ({ assignment } = await this.colabClient.assign(
          id,
          { variant, accelerator, shape, version },
          signal,
        ));
      } else {
        // Otherwise, take the new v2 route.
        assignment = await this.createRuntime(descriptor, signal);
      }

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
        { ...descriptor, accelerator: newFallback.toAttempt[0] },
        id,
        newFallback,
        signal,
      );
    }
  }

  private toAssignedServer(
    server: ColabJupyterServer,
    endpoint: string,
    connectionInfo: RuntimeProxyToken | ConnectionInfo,
    dateAssigned: Date,
  ): ColabAssignedServer {
    const { url, token } = connectionInfo;
    const headers: Record<string, string> =
      server.connectionInformation?.headers ?? {};
    headers[COLAB_RUNTIME_PROXY_TOKEN_HEADER.key] = token;
    headers[COLAB_CLIENT_AGENT_HEADER.key] = COLAB_CLIENT_AGENT_HEADER.value;

    const tokenExpiry =
      'expireTime' in connectionInfo
        ? connectionInfo.expireTime
        : new Date(Date.now() + connectionInfo.tokenExpiresInSeconds * 1000);
    const colabServer: ColabAssignedServer = {
      ...server,
      endpoint,
      connectionInformation: {
        baseUrl: this.vs.Uri.parse(url),
        token,
        tokenExpiry,
        headers,
        fetch: colabProxyFetch(token),
      },
      dateAssigned,
    };
    return {
      ...colabServer,
      connectionInformation: {
        ...colabServer.connectionInformation,
        WebSocket: colabProxyWebSocket(this.vs, this.colabClient, colabServer),
      },
    };
  }

  private async getUnownedServers(
    allAssignments: ListedAssignment[] | Runtime[],
    storedServers: ColabAssignedServer[],
    signal?: AbortSignal,
  ): Promise<UnownedServer[]> {
    const storedEndpointSet = new Set(storedServers.map((s) => s.endpoint));

    return (
      await Promise.all(
        allAssignments
          .filter((a) => !storedEndpointSet.has(getEndpoint(a)))
          .map(async (a): Promise<UnownedServer | undefined> => {
            const endpoint = getEndpoint(a);
            // For any remote servers created in Colab web UI, assuming there
            // is only one session per assignment.
            let label = UNKNOWN_REMOTE_SERVER_NAME;
            const timeout = waitForTimeout(
              LIST_UNOWNED_SESSIONS_TIMEOUT_MS,
              `Listing sessions timeout exceeded for endpoint ${endpoint}`,
            );
            try {
              let connectionInfo:
                | ConnectionInfo
                | RuntimeProxyToken
                | undefined;
              if (instanceOfRuntime(a)) {
                connectionInfo = a.connectionInfo;
              } else {
                connectionInfo = a.runtimeProxyInfo;
              }
              if (!connectionInfo) {
                return toUnownedServer(label, a);
              }

              const jupyterClient = ProxiedJupyterClient.withStaticConnection(
                connectionInfo.url,
                connectionInfo.token,
              );
              const sessions = await Promise.race([
                jupyterClient.sessions.list({ signal }),
                timeout.promise,
              ]);
              if (sessions.length === 1 && sessions[0].name?.length) {
                label = sessions[0].name;
              }
            } catch (error: unknown) {
              // The assignment may have been removed (e.g. via Colab web UI
              // or another VS Code instance sharing the account) between
              // listing assignments and listing its sessions, resulting in a
              // network error, i.e. FetchError. Drop it from the result rather
              // than failing the entire call.
              if (error instanceof JupyterFetchError) {
                log.trace(
                  `Dropping orphan assignment ${endpoint} - sessions.list resulted in a network error`,
                  error,
                );
                return undefined;
              }
              // For any other failure, fail open with a placeholder label so
              // we still surface the assignment to the user.
              log.warn(
                `Failed to list sessions for assignment ${endpoint}, falling back to placeholder label`,
                error,
              );
            } finally {
              timeout.dispose();
            }
            return toUnownedServer(label, a);
          }),
      )
    ).filter((s): s is UnownedServer => s !== undefined);
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

  private async deleteSessions(
    server: ColabAssignedServer,
    signal?: AbortSignal,
  ): Promise<unknown> {
    // Best-effort clean up sessions before unassigning the server. Without
    // this, sessions won't immediately disconnect if there are notebooks
    // attached in VS Code. However, we don't want to fail the entire
    // unassignServer call because the unassign API call will eventually garbage
    // collect and clean up the sessions too.
    const c = server.connectionInformation;
    const jupyterClient = ProxiedJupyterClient.withStaticConnection(
      c.baseUrl,
      c.token,
    );
    return Promise.allSettled(
      await jupyterClient.sessions
        .list({ signal })
        .catch((err: unknown) => {
          // Swallow the sessions.list error as this is best-effort.
          log.warn('Error occurred while listing sessions:', err);
          return [];
        })
        .then((sessions) =>
          sessions.map((session) =>
            session.id
              ? jupyterClient.sessions.delete(
                  { session: session.id },
                  { signal },
                )
              : Promise.resolve(),
          ),
        ),
    ).catch((err: unknown) => {
      // Swallow the sessions.delete errors as this is best-effort.
      log.warn('Error occurred while deleting sessions:', err);
    });
  }

  private async createRuntime(
    descriptor: ColabServerDescriptor,
    signal?: AbortSignal,
  ): Promise<Runtime> {
    const requestId = randomUUID();
    let operation = await this.colabApiClient.colab.createRuntime(
      {
        runtime: {
          runtimeSpec: {
            variant: denormalizeVariant(descriptor.variant),
            accelerator: descriptor.accelerator ?? 'NONE',
            shape: denormalizeShape(descriptor.shape),
          },
          version: descriptor.version,
        },
        requestId,
      },
      { signal },
    );

    if (operation.done) {
      throwIfOperationError(operation, descriptor.accelerator);
      assert(operation.response);
      return operation.response;
    }

    assert(operation.name);
    const operationId = trimPrefix(operation.name, 'operations/');
    operation = (await this.vs.window.withProgress(
      {
        location: this.vs.ProgressLocation.Notification,
        title: 'Assigning server...',
        cancellable: false,
      },
      () => {
        return this.colabApiClient.operations.waitOperation(
          { operationsId: operationId, timeout: WAIT_OPERATION_TIMEOUT },
          { signal },
        );
      },
    )) as CreateRuntimeOperation;
    if (!operation.done) {
      throw new WaitOperationTimeoutError(operationId, WAIT_OPERATION_TIMEOUT);
    }

    throwIfOperationError(operation, descriptor.accelerator);
    assert(
      operation.response,
      `Runtime response is missing in operation: ${operationId}`,
    );
    return operation.response;
  }
}

enum AssignmentsExceededActions {
  REMOVE_SERVER = 'Remove Server',
}

const WAIT_OPERATION_TIMEOUT = '120s';
const LIST_UNOWNED_SESSIONS_TIMEOUT_MS = 3000;

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
 * Colab proxy headers always win over any caller-supplied values for the
 * same keys.
 *
 * @param token - The Colab runtime proxy token.
 * @returns A fetch function that adds the Colab runtime proxy token as a
 * header.
 */
function colabProxyFetch(
  token: string,
): (info: RequestInfo, init?: RequestInit) => Promise<Response> {
  return async (info: RequestInfo, init?: RequestInit) => {
    let infoHeaders: Headers | undefined;
    if (isRequest(info)) {
      // Ensure compatibility with `node-fetch`
      info = new Request(info.url, info);
      infoHeaders = info.headers;
    }

    const headers = new Headers(infoHeaders);
    new Headers(init?.headers).forEach((value, key) => {
      headers.set(key, value);
    });
    headers.set(COLAB_RUNTIME_PROXY_TOKEN_HEADER.key, token);
    headers.set(COLAB_CLIENT_AGENT_HEADER.key, COLAB_CLIENT_AGENT_HEADER.value);
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

function toUnownedServer(
  label: string,
  runtime: Runtime | ListedAssignment,
): UnownedServer {
  if (instanceOfRuntime(runtime)) {
    assert(runtime.name);
    assert(runtime.connectionInfo);
    return {
      id: trimPrefix(runtime.name, 'runtimes/'),
      label,
      endpoint: runtime.connectionInfo.endpoint,
      variant: normalizeVariant(runtime.runtimeSpec.variant),
      accelerator: runtime.runtimeSpec.accelerator,
      shape: normalizeShape(runtime.runtimeSpec.shape),
      version: runtime.version,
    };
  }
  return {
    id: runtime.notebookIdHash,
    label,
    endpoint: runtime.endpoint,
    variant: runtime.variant,
    accelerator: runtime.accelerator,
  };
}

function getEndpoint(runtime: Runtime | ListedAssignment | Assignment): string {
  if (instanceOfRuntime(runtime)) {
    assert(runtime.connectionInfo);
    return runtime.connectionInfo.endpoint;
  }
  return runtime.endpoint;
}

function errorToAssignmentOutcome(error: unknown): AssignmentOutcome {
  if (error instanceof AllAcceleratorsUnavailableError) {
    return AssignmentOutcome.ASSIGNMENT_OUTCOME_ALL_ACCELERATORS_UNAVAILABLE;
  }
  if (error instanceof AcceleratorUnavailableError) {
    return AssignmentOutcome.ASSIGNMENT_OUTCOME_ACCELERATOR_UNAVAILABLE;
  }
  if (error instanceof TooManyAssignmentsError) {
    return AssignmentOutcome.ASSIGNMENT_OUTCOME_TOO_MANY_ASSIGNMENTS;
  }
  if (error instanceof InsufficientQuotaError) {
    return AssignmentOutcome.ASSIGNMENT_OUTCOME_INSUFFICIENT_QUOTA;
  }
  if (error instanceof DenylistedError) {
    return AssignmentOutcome.ASSIGNMENT_OUTCOME_DENYLISTED;
  }
  return AssignmentOutcome.ASSIGNMENT_OUTCOME_OTHER_FAILURE;
}

function trimPrefix(str: string, prefix: string): string {
  if (str.startsWith(prefix)) {
    return str.slice(prefix.length);
  }
  return str;
}
