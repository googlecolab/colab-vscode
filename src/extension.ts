import { ExtensionContext, workspace, Uri } from "vscode";
import { getJupyterApi } from "./jupyter/jupyter_extension";
import { ColabJupyterServerProvider, RpConfig } from "./jupyter/provider";

// Called when the extension is activated.
export async function activate(context: ExtensionContext) {
  const jupyter = await getJupyterApi();
  const rpConfig = getRpConfig();
  const servers = ColabJupyterServerProvider.register(jupyter, rpConfig);

  context.subscriptions.push(servers);
}

function getRpConfig(): RpConfig {
  const config = workspace.getConfiguration("colab");
  const baseUrl = config.get<string>("resoruceProxyBaseUrl");
  const token = config.get<string>("resoruceProxyToken");

  if (!baseUrl || !token) {
    throw new Error(
      'Resource proxy configuration is missing. Requires both an "rpBaseUrl" and "rpToken"',
    );
  }

  return { baseUri: Uri.parse(baseUrl), token };
}
