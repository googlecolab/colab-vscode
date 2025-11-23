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

/** A Colab remote server assigned outside VS Code. */
export interface ColabRemoteServer extends ColabServerDescriptor {
  readonly endpoint: string;
  readonly sessionId?: string;
}

/**
 * A Colab Jupyter server which has been assigned, thus including the required
 * connection information.
 */
export type ColabAssignedServer = ColabJupyterServer & {
  readonly endpoint: string;
  readonly connectionInformation: JupyterServerConnectionInformation & {
    readonly token: string;
    readonly tokenExpiry: Date;
  };
  readonly dateAssigned: Date;
};

export const DEFAULT_CPU_SERVER: ColabServerDescriptor = {
  label: "Colab CPU",
  variant: Variant.DEFAULT,
};

export function isInstanceOfColabAssignedServer(
  obj: unknown,
): obj is ColabAssignedServer {
  return "connectionInformation" in (obj as ColabAssignedServer);
}
