import vscode from "vscode";
import { getJupyterApi } from "./jupyter/jupyter-extension";
import { ColabJupyterServerProvider, RpConfig } from "./jupyter/provider";

// Called when the extension is activated.
export async function activate(context: vscode.ExtensionContext) {
  const jupyter = await getJupyterApi(vscode);
  const rpConfig = getRpConfig();
  const servers = ColabJupyterServerProvider.register(jupyter, rpConfig);

  context.subscriptions.push(servers);
}

/** Configuration settings enum */
export enum Config {
  ProxyBaseUrl = "resourceProxyBaseUrl",
  ProxyToken = "resourceProxyToken",
}

function getRpConfig(): RpConfig {
  const config = vscode.workspace.getConfiguration("colab");
  const baseUrl = config.get<string>(Config.ProxyBaseUrl);
  const token = config.get<string>(Config.ProxyToken);

  if (!baseUrl || !token) {
    throw new Error(
      'Resource proxy configuration is missing. Requires both an "rpBaseUrl" and "rpToken"',
    );
  }

  return { baseUri: vscode.Uri.parse(baseUrl), token };
}
