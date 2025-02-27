import { UUID } from "crypto";
import {
  JupyterServer,
  JupyterServerConnectionInformation,
} from "@vscode/jupyter-extension";
import { Accelerator, Variant } from "../colab/api";

/**
 * Colab's Jupyter server descriptor which includes machine-specific
 * designations.
 */
export interface ColabServerDescriptor {
  // Note: id will be removed as part of the Jupyter server provider rework.
  readonly id: string;
  readonly label: string;
  readonly variant: Variant;
  readonly accelerator?: Accelerator;
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
 * A Colab Jupyter server which has been assigned, thus including the required
 * connection information.
 */
export type ColabAssignedServer = ColabJupyterServer & {
  readonly connectionInformation: JupyterServerConnectionInformation & {
    readonly token: string;
  };
};

/**
 * The mapping of all potentially available ID to Colab Jupyter servers.
 */
export const COLAB_SERVERS = new Set<ColabServerDescriptor>([
  // CPUs
  {
    id: "m",
    label: "Colab CPU",
    variant: Variant.DEFAULT,
  },
  // GPUs
  {
    id: "gpu-t4",
    label: "Colab GPU T4",
    variant: Variant.GPU,
    accelerator: Accelerator.T4,
  },
  {
    id: "gpu-l4",
    label: "Colab GPU L4",
    variant: Variant.GPU,
    accelerator: Accelerator.L4,
  },
  {
    id: "gpu-a100",
    label: "Colab GPU A100",
    variant: Variant.GPU,
    accelerator: Accelerator.A100,
  },
  // TPUs
  {
    id: "tpu-v2-8",
    label: "Colab TPU v2-8",
    variant: Variant.TPU,
    accelerator: Accelerator.V28,
  },
  {
    id: "tpu-v5e1",
    label: "Colab TPU v5e-1",
    variant: Variant.TPU,
    accelerator: Accelerator.V5E1,
  },
]);
