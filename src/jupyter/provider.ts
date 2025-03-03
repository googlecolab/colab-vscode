import {
  Jupyter,
  JupyterServer,
  JupyterServerCollection,
  JupyterServerProvider,
} from "@vscode/jupyter-extension";
import fetch, { Headers, Request, RequestInfo, RequestInit } from "node-fetch";
import vscode, { CancellationToken, ProviderResult } from "vscode";
import { CCUInfo, Variant } from "../colab/api";
import { ColabClient } from "../colab/client";
import { SERVERS } from "./servers";

/**
 * A header key for the Colab runtime proxy token.
 */
const COLAB_RUNTIME_PROXY_TOKEN_HEADER = "X-Colab-Runtime-Proxy-Token";

/**
 * A header key for the Colab client agent.
 */
const COLAB_CLIENT_AGENT_HEADER = "X-Colab-Client-Agent";

/**
 * The client agent value for requests originating from VS Code.
 */
const VSCODE_CLIENT_AGENT = "vscode";

/**
 * Colab Jupyter server provider.
 *
 * Provides a static list of Colab Jupyter servers and resolves the connection
 * information using the provided config.
 */
export class ColabJupyterServerProvider
  implements JupyterServerProvider, vscode.Disposable
{
  private readonly serverCollection: JupyterServerCollection;

  constructor(
    private readonly vs: typeof vscode,
    jupyter: Jupyter,
    private readonly client: ColabClient,
  ) {
    this.serverCollection = jupyter.createJupyterServerCollection(
      "colab",
      "Colab",
      this,
    );
  }

  dispose() {
    this.serverCollection.dispose();
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
        // TODO: Provide a ⚠️ warning for the servers which are ineligible for
        // the user.

        return eligibleGpu && !ineligibleGpu;
      });
    });
  }

  /**
   * Resolves the connection for the provided
   * {@link JupyterServer Jupyter Server}.
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
            // Overwrite the fetch method so that we can add our own custom
            // headers to all requests made by the Jupyter extension.
            fetch: async (info: RequestInfo, init?: RequestInit) => {
              if (!init) {
                init = {};
              }
              const requestHeaders = new Headers(init.headers);
              requestHeaders.append(COLAB_RUNTIME_PROXY_TOKEN_HEADER, token);
              requestHeaders.append(
                COLAB_CLIENT_AGENT_HEADER,
                VSCODE_CLIENT_AGENT,
              );
              init.headers = requestHeaders;

              // A workaround to a known issue with node-fetch.
              // https://github.com/node-fetch/node-fetch/discussions/1598
              //
              // This issue presents itself in the form of fetch Request objects
              // not matching node-fetch Request objects, and how node-fetch
              // determines an object in an interesting fashion
              // https://github.com/node-fetch/node-fetch/blob/8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f/src/request.js#L52
              // that does not recognize the regular Fetch API's Request object
              // thus passing the entire object into the node fetch Request's
              // url.
              //
              // Parsed urls turn into [Request objects] here:
              // https://github.com/node-fetch/node-fetch/blob/8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f/src/request.js#L52
              //
              // This issue is further confused by the type error not exactly
              // being helpful to debugging the issue:
              // https://github.com/node-fetch/node-fetch/blob/8b3320d2a7c07bce4afc6b2bf6c3bbddda85b01f/src/index.js#L54
              //
              // Create a new node-fetch request with the correct symbols, so
              // that node-fetch will parse it correctly.
              if (isRequest(info)) {
                info = new Request(info.url, info);
              }

              return fetch(info, init);
            },
          },
        };
      });
  }
}

function isRequest(info: RequestInfo): info is Request {
  return typeof info !== "string" && !("href" in info);
}
