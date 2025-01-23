import { JupyterServer } from "@vscode/jupyter-extension";
import { Accelerator, Variant } from "../colab/api";

/**
 * Colab's Jupter server descriptor which includes machine-specific designations.
 */
export interface ColabJupyterServer extends JupyterServer {
  variant: Variant;
  accelerator?: Accelerator;
}

/**
 * The mapping of all potentially available ID to Colab Jupyter servers.
 */
export const SERVERS = new Map<string, ColabJupyterServer>([
  // CPUs
  [
    "m",
    {
      id: "m",
      label: "Colab CPU",
      variant: Variant.DEFAULT,
    },
  ],
  // GPUs
  [
    "gpu-t4",
    {
      id: "gpu-t4",
      label: "Colab GPU T4",
      variant: Variant.GPU,
      accelerator: Accelerator.T4,
    },
  ],
  [
    "gpu-l4",
    {
      id: "gpu-l4",
      label: "Colab GPU L4",
      variant: Variant.GPU,
      accelerator: Accelerator.L4,
    },
  ],
  [
    "gpu-a100",
    {
      id: "gpu-a100",
      label: "Colab GPU A100",
      variant: Variant.GPU,
      accelerator: Accelerator.A100,
    },
  ],
  // TPUs
  [
    "tpu-v28",
    {
      id: "tpu-v28",
      label: "Colab TPU v2-8",
      variant: Variant.TPU,
    },
  ],
  [
    "tpu-v5e1",
    {
      id: "tpu-v5e1",
      label: "Colab TPU v5e-1",
      variant: Variant.TPU,
    },
  ],
]);
