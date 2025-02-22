import {
  Jupyter,
  JupyterServer,
  JupyterServerProvider,
} from "@vscode/jupyter-extension";
import fetch, { Headers } from "node-fetch";
import vscode, { CancellationToken, ProviderResult } from "vscode";
import { CCUInfo, Variant } from "../colab/api";
import { ColabClient } from "../colab/client";
import { SERVERS } from "./servers";

/**
 * COLAB_RUNTIME_PROXY_TOKEN_HEADER is a header key for the Colab runtime proxy token.
 */
const COLAB_RUNTIME_PROXY_TOKEN_HEADER = "X-Colab-Runtime-Proxy-Token";

/**
 * COLAB_CLIENT_AGENT_HEADER is a header key for the Colab client agent.
 */
const COLAB_CLIENT_AGENT_HEADER = "X-Colab-Client-Agent";

/**
 * CLIENT_AGENT is an enum of possible client agents that the Colab client agent header will take.
 */
enum CLIENT_AGENT {
  VSCODE = "vscode",
}

/**
 * Colab Jupyter server provider.
 *
 * Provides a static list of Colab Jupyter servers and resolves the connection information using the provided config.
 */
export class ColabJupyterServerProvider
  implements JupyterServerProvider, vscode.Disposable
{
  private readonly disposable: vscode.Disposable;

  constructor(
    private readonly vs: typeof vscode,
    jupyter: Jupyter,
    private readonly client: ColabClient,
  ) {
    this.disposable = this.vs.Disposable.from(
      jupyter.createJupyterServerCollection("colab", "Colab", this),
    );
  }

  dispose() {
    this.disposable.dispose();
  }

  /**
   * Provides the list of {@link JupyterServer Jupyter Servers}.
   */
  provideJupyterServers(
    _token: CancellationToken,
  ): ProviderResult<JupyterServer[]> {
    return this.client.ccuInfo().then((ccuInfo: CCUInfo) => {
      const eligibleGpus = new Set(ccuInfo.eligibleGpus);
      const ineligibleGpus = new Set(ccuInfo.ineligibleGpus);
      // TODO: TPUs are currently not supported by the CCU Info API.
      return Array.from(SERVERS.values()).filter((server) => {
        if (server.variant !== Variant.GPU) {
          return true;
        }
        // Check both to make introducing new accelerators safer.
        const eligibleGpu =
          server.accelerator && eligibleGpus.has(server.accelerator);
        const ineligibleGpu =
          server.accelerator && ineligibleGpus.has(server.accelerator);
        // TODO: Provide a ⚠️ warning for the servers which are ineligible for the user.

        return eligibleGpu && !ineligibleGpu;
      });
    });
  }

  /**
   * Resolves the connection for the provided {@link JupyterServer Jupyter Server}.
   */
  resolveJupyterServer(
    server: JupyterServer,
    _token: CancellationToken,
  ): ProviderResult<JupyterServer> {
    // TODO: Derive NBH.
    const nbh = "booooooooooooooooooooooooooooooooooooooooooo"; // cspell:disable-line

    const colabServer = SERVERS.get(server.id);
    if (!colabServer) {
      return Promise.reject(new Error(`Unknown server: ${server.id}`));
    }

    return this.client
      .assign(nbh, colabServer.variant, colabServer.accelerator)
      .then((assignment): JupyterServer => {
        const { url, token } = assignment.runtimeProxyInfo ?? {};

        if (!url || !token) {
          throw new Error(
            "Unable to obtain connection information for server.",
          );
        }

        return {
          ...server,
          connectionInformation: {
            baseUrl: this.vs.Uri.parse(url),
            headers: { COLAB_RUNTIME_PROXY_TOKEN_HEADER: token },
            // Overwrite the fetch method so that we can add our own custom headers to all requests made by the Jupyter extension.
            fetch: async (
              info: fetch.RequestInfo,
              init?: fetch.RequestInit,
            ) => {
              if (!init) {
                init = {};
              }
              const requestHeaders = new Headers(init.headers);
              requestHeaders.append(COLAB_RUNTIME_PROXY_TOKEN_HEADER, token);
              requestHeaders.append(
                COLAB_CLIENT_AGENT_HEADER,
                CLIENT_AGENT.VSCODE,
              );
              init.headers = requestHeaders;

              return fetch(info, init);
            },
          },
        };
      });
  }
}
