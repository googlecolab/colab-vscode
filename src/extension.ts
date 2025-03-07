import { OAuth2Client } from "google-auth-library";
import vscode from "vscode";
import { GoogleAuthProvider } from "./auth/provider";
import { RedirectUriCodeProvider } from "./auth/redirect";
import { AuthStorage } from "./auth/storage";
import { ColabClient } from "./colab/client";
import { ServerPicker } from "./colab/server-picker";
import { getPackageInfo } from "./config/package_info";
import { AssignmentManager } from "./jupyter/assignments";
import { getJupyterApi } from "./jupyter/jupyter-extension";
import { ColabJupyterServerProvider } from "./jupyter/provider";
import { ServerStorage } from "./jupyter/storage";

/* cSpell:disable */
const CLIENT_ID =
  "1014160490159-8bdmhbrghjfch5sb8ltuofo1mk1totmr.apps.googleusercontent.com";
const CLIENT_NOT_SO_SECRET = "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";
/* cSpell:enable */
const AUTH_CLIENT = new OAuth2Client(
  CLIENT_ID,
  CLIENT_NOT_SO_SECRET,
  // TODO: Configure this per environment once it works beyond localhost.
  "https://localhost:8888/vscode/redirect",
);

// Called when the extension is activated.
export async function activate(context: vscode.ExtensionContext) {
  const jupyter = await getJupyterApi(vscode);
  const redirectUriHandler = new RedirectUriCodeProvider();
  const disposeUriHandler =
    vscode.window.registerUriHandler(redirectUriHandler);
  const authProvider = new GoogleAuthProvider(
    vscode,
    getPackageInfo(context),
    new AuthStorage(context.secrets),
    AUTH_CLIENT,
    redirectUriHandler,
  );
  const colabClient = new ColabClient(new URL("https://localhost:8888"), () =>
    GoogleAuthProvider.getSession(vscode),
  );
  const serverStorage = new ServerStorage(vscode, context.secrets);
  const assignmentManager = new AssignmentManager(
    vscode,
    colabClient,
    serverStorage,
  );
  const serverPicker = new ServerPicker(vscode);
  const serverProvider = new ColabJupyterServerProvider(
    vscode,
    assignmentManager,
    serverPicker,
    jupyter,
  );

  context.subscriptions.push(
    disposeUriHandler,
    authProvider,
    assignmentManager,
    serverProvider,
  );
}
