/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from 'vscode';
import { z } from 'zod';
import { Shape, Variant } from '../colab/types';
import { log } from '../common/logging';
import { PROVIDER_ID } from '../config/constants';
import { ColabAssignedServer } from './servers';

const ASSIGNED_SERVERS_KEY = `${PROVIDER_ID}.assigned_servers`;

const AssignedServer = z.object({
  id: z.string(),
  label: z.string().nonempty(),
  variant: z.enum(Variant),
  accelerator: z.string().optional(),
  // The shape is presentational. Degrading an unrecognized one keeps a live
  // server usable if the API gains a shape this version predates, rather than
  // discarding it over a label.
  shape: z.enum(Shape).optional().catch(undefined),
  version: z.string().optional(),
  endpoint: z.string().nonempty(),
  connectionInformation: z.object({
    baseUrl: z.string().nonempty(),
    token: z.string().nonempty(),
    tokenExpiry: z.coerce.date(),
    headers: z.record(z.string().nonempty(), z.string().nonempty()).optional(),
  }),
  dateAssigned: z.coerce.date(),
});
type AssignedServer = z.infer<typeof AssignedServer>;

/**
 * Parses the persisted servers, skipping any entry that cannot be understood.
 *
 * Persisted data outlives the schema that wrote it. Parsing the array as a
 * unit means one entry written by an older (or newer) schema throws away every
 * other server and leaves the user permanently unable to list, store or remove
 * anything, so entries are parsed individually instead.
 *
 * @param json - The raw JSON read from secret storage.
 * @returns The servers that could be parsed, and how many entries could not.
 */
function parseStoredServers(json: string | undefined): {
  servers: AssignedServer[];
  dropped: number;
} {
  if (!json) {
    return { servers: [], dropped: 0 };
  }
  const entries = z.array(z.unknown()).safeParse(JSON.parse(json));
  if (!entries.success) {
    log.error('Discarding stored servers, expected an array:', entries.error);
    return { servers: [], dropped: 0 };
  }
  const servers: AssignedServer[] = [];
  let dropped = 0;
  for (const [index, entry] of entries.data.entries()) {
    const server = AssignedServer.safeParse(entry);
    if (!server.success) {
      log.warn(
        `Dropping unparsable stored server at index ${index.toString()}:`,
        server.error,
      );
      dropped++;
      continue;
    }
    servers.push(server.data);
  }
  return { servers, dropped };
}

/**
 * Server storage for Colab Jupyter servers.
 *
 * Implementation assumes full ownership over the backing secret storage file.
 */
export class ServerStorage {
  private cache?: ColabAssignedServer[];

  /**
   * Initializes a new instance.
   *
   * @param vs - The VS Code API instance.
   * @param secrets - The secret storage instance.
   */
  constructor(
    private readonly vs: typeof vscode,
    private readonly secrets: vscode.SecretStorage,
  ) {}

  /**
   * List the assigned servers that have been stored.
   *
   * @returns The assigned servers that have been stored.
   */
  async list(): Promise<ColabAssignedServer[]> {
    if (this.cache !== undefined) {
      return this.cache;
    }
    const serversJson = await this.secrets.get(ASSIGNED_SERVERS_KEY);
    const { servers, dropped } = parseStoredServers(serversJson);
    if (dropped > 0) {
      // Prune rather than skip on every read. An assigned server is
      // ephemeral: an idle one is reclaimed within ~30 minutes and none
      // outlive 24 hours, so an entry this version cannot read refers to a
      // runtime that is long gone and is worth nothing to keep.
      await this.storeServers(servers, serversJson);
    }
    const res = servers.map((server) => ({
      id: server.id,
      label: server.label,
      variant: server.variant,
      accelerator: server.accelerator,
      shape: server.shape,
      version: server.version,
      endpoint: server.endpoint,
      connectionInformation: {
        baseUrl: this.vs.Uri.parse(server.connectionInformation.baseUrl),
        token: server.connectionInformation.token,
        tokenExpiry: server.connectionInformation.tokenExpiry,
        headers: server.connectionInformation.headers,
      },
      dateAssigned: server.dateAssigned,
    }));
    this.cache = res;
    return res;
  }

  /**
   * Get a single assigned server by its ID.
   *
   * @param id - The ID of the server to retrieve.
   * @returns The assigned server if found, otherwise undefined.
   */
  async get(id: string): Promise<ColabAssignedServer | undefined> {
    const servers = await this.list();
    return servers.find((server) => server.id === id);
  }

  /**
   * Stores the provided assigned servers.
   *
   * Servers are unique by their ID. If a server with the same ID is already
   * stored, it will be replaced.
   *
   * @param servers - The servers to store.
   * @returns A promise that resolves when the servers have been stored.
   */
  async store(servers: ColabAssignedServer[]): Promise<void> {
    const existingServersJson = await this.secrets.get(ASSIGNED_SERVERS_KEY);
    const serversById = mapServersById(existingServersJson);
    for (const server of servers) {
      // This ensures that updating an existing server does not modify the
      // original assignment date.
      const dateAssigned =
        serversById.get(server.id)?.dateAssigned ?? server.dateAssigned;
      serversById.set(server.id, {
        id: server.id,
        label: server.label,
        variant: server.variant,
        accelerator: server.accelerator,
        shape: server.shape,
        version: server.version,
        endpoint: server.endpoint,
        connectionInformation: {
          baseUrl: server.connectionInformation.baseUrl.toString(),
          token: server.connectionInformation.token,
          tokenExpiry: server.connectionInformation.tokenExpiry,
          headers: server.connectionInformation.headers,
        },
        dateAssigned,
      });
    }
    return this.storeServers(
      Array.from(serversById.values()),
      existingServersJson,
    );
  }

  /**
   * Remove an assigned server.
   *
   * @param serverId - The ID of the server to remove.
   * @returns true if a server was stored and has been removed, or false if the
   * server does not exist.
   */
  async remove(serverId: string): Promise<boolean> {
    const existingServersJson = await this.secrets.get(ASSIGNED_SERVERS_KEY);
    const serversById = mapServersById(existingServersJson);
    if (!serversById.delete(serverId)) {
      return false;
    }
    await this.storeServers(
      Array.from(serversById.values()),
      existingServersJson,
    );
    return true;
  }

  /**
   * Clear all stored servers.
   */
  async clear(): Promise<void> {
    await this.secrets.delete(ASSIGNED_SERVERS_KEY);
    this.cache = undefined;
  }

  private async storeServers(
    servers: AssignedServer[],
    existingServersJson: string | undefined,
  ): Promise<void> {
    const serversSorted = servers.sort((a, b) => a.id.localeCompare(b.id));
    const newServersJson = JSON.stringify(serversSorted);
    // Avoid writing the same value to the secrets store.
    if (newServersJson === existingServersJson) {
      return;
    }
    await this.secrets.store(ASSIGNED_SERVERS_KEY, newServersJson);
    this.cache = undefined;
  }
}

function mapServersById(json: string | undefined) {
  return new Map(parseStoredServers(json).servers.map((s) => [s.id, s]));
}
