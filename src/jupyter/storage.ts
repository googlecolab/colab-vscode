/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { UUID } from "crypto";
import vscode from "vscode";
import { z } from "zod";
import { Accelerator, Variant } from "../colab/api";
import { PROVIDER_ID } from "../config/constants";
import { isUUID } from "../utils/uuid";
import { ColabAssignedServer } from "./servers";

const ASSIGNED_SERVERS_KEY = `${PROVIDER_ID}.assigned_servers`;
const AssignedServers = z.array(
  z.object({
    id: z.string().refine(isUUID, "String must be a valid UUID."),
    label: z.string().nonempty(),
    variant: z.nativeEnum(Variant),
    accelerator: z.nativeEnum(Accelerator).optional(),
    endpoint: z.string().nonempty(),
    connectionInformation: z.object({
      baseUrl: z.string().nonempty(),
      token: z.string().nonempty(),
      headers: z
        .record(z.string().nonempty(), z.string().nonempty())
        .optional(),
    }),
  }),
);

/**
 * Server storage for Colab Jupyter servers.
 *
 * Implementation assumes full ownership over the backing secret storage file.
 */
export class ServerStorage {
  private cache?: ColabAssignedServer[];

  constructor(
    private readonly vs: typeof vscode,
    private readonly secrets: vscode.SecretStorage,
  ) {}

  /**
   * List the assigned servers that have been stored.
   * @returns The assigned servers that have been stored.
   */
  async list(): Promise<ColabAssignedServer[]> {
    if (this.cache !== undefined) {
      return this.cache;
    }
    const serversJson = await this.secrets.get(ASSIGNED_SERVERS_KEY);
    const servers = serversJson
      ? AssignedServers.parse(JSON.parse(serversJson))
      : [];
    const res = servers.map((server) => ({
      id: server.id,
      label: server.label,
      variant: server.variant,
      accelerator: server.accelerator,
      endpoint: server.endpoint,
      connectionInformation: {
        baseUrl: this.vs.Uri.parse(server.connectionInformation.baseUrl),
        token: server.connectionInformation.token,
        headers: server.connectionInformation.headers,
      },
    }));
    this.cache = res;
    return res;
  }

  /**
   * Stores the provided assigned servers.
   *
   * Servers are unique by their ID. If a server with the same ID is already
   * stored, it will be replaced.
   *
   * @param servers - The servers to store.
   */
  async store(servers: ColabAssignedServer[]): Promise<void> {
    const existingServersJson = await this.secrets.get(ASSIGNED_SERVERS_KEY);
    const serversById = mapServersById(existingServersJson);
    for (const server of servers) {
      serversById.set(server.id, {
        id: server.id,
        label: server.label,
        variant: server.variant,
        accelerator: server.accelerator,
        endpoint: server.endpoint,
        connectionInformation: {
          baseUrl: server.connectionInformation.baseUrl.toString(),
          token: server.connectionInformation.token,
          headers: server.connectionInformation.headers,
        },
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
  async remove(serverId: UUID): Promise<boolean> {
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
    servers: z.infer<typeof AssignedServers>,
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
  const servers = json ? AssignedServers.parse(JSON.parse(json)) : [];
  return new Map(servers.map((s) => [s.id, s]));
}
