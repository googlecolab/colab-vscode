import {
  Jupyter,
  JupyterServer,
  JupyterServerCollection,
  JupyterServerConnectionInformation,
  JupyterServerProvider,
} from "@vscode/jupyter-extension";
import { CancellationToken, Uri, ProviderResult } from "vscode";

/**
 * Configuration for the Resource Proxy connection.
 */
export interface RpConfig {
  /**
   * Base {@link Uri Uri} of the Jupyter Server behind the resource proxy.
   */
  readonly baseUri: Uri;

  /**
   * The resource proxy token attached as a header to Jupyter Server requests.
   */
  readonly token: string;
}

/**
 * Colab Jupyter server provider.
 *
 * Provides a static list of Colab Jupyter servers and resolves the connection information using the provided config.
 */
export class ColabJupyterServerProvider implements JupyterServerProvider {
  /**
   * Registers the Colab Jupyter Server provider with the Jupyter Kernels API.
   *
   * @param jupyter Kernels API.
   * @param config for connecting to the Resource Proxy.
   */
  static register(jupyter: Jupyter, config: RpConfig): JupyterServerCollection {
    return jupyter.createJupyterServerCollection(
      "colab",
      "Colab",
      new ColabJupyterServerProvider(config),
    );
  }

  // TODO: Fetch available servers from the backend. Hardcoded for now.
  private readonly idToServer = new Map<string, ColabJupyterServer>([
    ["m", new ColabJupyterServer("m", "Colab CPU")],
    ["gpu-t4", new ColabJupyterServer("gpu-t4", "Colab T4")],
    ["gpu-l4", new ColabJupyterServer("gpu-l4", "Colab L4")],
    ["gpu-a100", new ColabJupyterServer("gpu-a100", "Colab A100")],
    ["tpu-v28", new ColabJupyterServer("tpu-v28", "Colab TPU v2-8")],
    ["tpu-v5e1", new ColabJupyterServer("tpu-v5e1", "Colab TPU v5e-1")],
  ]);

  constructor(private readonly config: RpConfig) {}

  /**
   * Provides the list of {@link JupyterServer Jupyter Servers}.
   */
  provideJupyterServers(
    _token: CancellationToken,
  ): ProviderResult<JupyterServer[]> {
    return Array.from(this.idToServer.values());
  }

  /**
   * Resolves the connection for the provided {@link JupyterServer Jupyter Server}.
   */
  resolveJupyterServer(
    server: JupyterServer,
    _token: CancellationToken,
  ): ProviderResult<JupyterServer> {
    const colabServer = this.idToServer.get(server.id);
    if (!colabServer) {
      return;
    }
    colabServer.resolve(this.config);
    return colabServer;
  }
}

class ColabJupyterServer implements JupyterServer {
  connectionInformation?: JupyterServerConnectionInformation;

  constructor(
    readonly id: string,
    readonly label: string,
  ) {}

  resolve(config: RpConfig): void {
    // TODO: Assign the appropriate machine for the server instead of the single hardcoded configuration.
    this.connectionInformation = {
      baseUrl: config.baseUri,
      headers: { "X-Colab-Runtime-Proxy-Token": config.token },
    };
  }
}
