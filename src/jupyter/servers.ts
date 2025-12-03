/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { UUID } from "crypto";
import {
  JupyterServer,
  JupyterServerConnectionInformation,
} from "@vscode/jupyter-extension";
import { Variant } from "../colab/api";

/**
 * Colab's Jupyter server descriptor which includes machine-specific
 * designations.
 */
export interface ColabServerDescriptor {
  readonly label: string;
  readonly variant: Variant;
  readonly accelerator?: string;
}

/**
 * A Jupyter server which includes the Colab descriptor and enforces that IDs
 * are UUIDs.
 */
export interface ColabJupyterServer
  extends ColabServerDescriptor,
    JupyterServer {
  readonly id: UUID;
}

/**
 * A Colab Jupyter server which has been assigned in and owned by VS Code, thus
 * including the required connection information.
 */
export type ColabAssignedServer = ColabJupyterServer & {
  readonly endpoint: string;
  readonly connectionInformation: JupyterServerConnectionInformation & {
    readonly token: string;
    readonly tokenExpiry: Date;
  };
  readonly dateAssigned: Date;
};

export function isColabAssignedServer(
  s: ColabAssignedServer | UnownedServer,
): s is ColabAssignedServer {
  return "connectionInformation" in s;
}

export const DEFAULT_CPU_SERVER: ColabServerDescriptor = {
  label: "Colab CPU",
  variant: Variant.DEFAULT,
};

/** A Colab server assigned outside and not owned by VS Code. */
export interface UnownedServer extends ColabServerDescriptor {
  readonly endpoint: string;
}

/** Consists of all servers that are assigned in and outside VS Code. */
export interface AllServers {
  /** Servers assigned in VS Code. */
  readonly assigned: readonly ColabAssignedServer[];

  /** Servers assigned outside and not owned by VS Code. */
  readonly unowned: readonly UnownedServer[];
}
