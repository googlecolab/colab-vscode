/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { UUID } from "crypto";
import { ColabAssignedServer } from "../../jupyter/servers";
import { ServerStorage } from "../../jupyter/storage";

/**
 * An in memory fake implementation of {@link ServerStorage}.
 */
export class ServerStorageFake
  implements Pick<ServerStorage, "list" | "get" | "store" | "remove" | "clear">
{
  private servers?: ColabAssignedServer[];

  list = () => Promise.resolve(this.servers ?? []);

  get = (serverId: UUID) =>
    Promise.resolve(this.servers?.find((s) => s.id === serverId));

  store = (servers: ColabAssignedServer[]) => {
    this.servers = servers;
    return Promise.resolve();
  };

  remove = (serverId: UUID) => {
    const lengthBefore = this.servers?.length ?? 0;
    this.servers = this.servers?.filter((s) => s.id !== serverId);
    return Promise.resolve(lengthBefore > (this.servers?.length ?? 0));
  };

  clear = () => {
    this.servers = undefined;
    return Promise.resolve();
  };
}
