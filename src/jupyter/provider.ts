import {
  Jupyter,
  JupyterServer,
  JupyterServerProvider,
} from "@vscode/jupyter-extension";
import * as nodeFetch from "node-fetch";
import { CancellationToken, ProviderResult } from "vscode";
import vscode from "vscode";
import { CCUInfo, Variant } from "../colab/api";
import { ColabClient } from "../colab/client";
import { SERVERS } from "./servers";

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
            headers: { "X-Colab-Runtime-Proxy-Token": token },
            // Overwrite the fetch method so that we can add our own custom headers to all requests made by the Jupyter extension.
            fetch: async (
              info: nodeFetch.RequestInfo,
              init?: nodeFetch.RequestInit,
            ) => {
              if (!init) {
                init = {};
              }
              const requestHeaders = new nodeFetch.Headers(init.headers);
              requestHeaders.append("X-Colab-Runtime-Proxy-Token", token);
              init.headers = requestHeaders;

              if (typeof info !== "string" && !("href" in info)) {
                info = new nodeFetch.Request(info.url, info);
              }

              return nodeFetch.default(info, init);
            },
          },
        };
      });
  }
}
