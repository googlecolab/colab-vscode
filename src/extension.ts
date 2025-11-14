/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Jupyter } from "@vscode/jupyter-extension";
import { OAuth2Client } from "google-auth-library";
import vscode, { Disposable } from "vscode";
import { GoogleAuthProvider } from "./auth/auth-provider";
import { getOAuth2Flows } from "./auth/flows/flows";
import { login } from "./auth/login";
import { AuthStorage } from "./auth/storage";
import { ColabClient } from "./colab/client";
import {
  COLAB_TOOLBAR,
  REMOVE_SERVER,
  SIGN_OUT,
} from "./colab/commands/constants";
import { notebookToolbar } from "./colab/commands/notebook";
import { removeServer } from "./colab/commands/server";
import { ConnectionRefreshController } from "./colab/connection-refresher";
import { ConsumptionNotifier } from "./colab/consumption/notifier";
import { ConsumptionPoller } from "./colab/consumption/poller";
import { ServerKeepAliveController } from "./colab/keep-alive";
import { ServerPicker } from "./colab/server-picker";
import { CONFIG } from "./colab-config";
import { initializeLogger, log } from "./common/logging";
import { Toggleable } from "./common/toggleable";
import { getPackageInfo } from "./config/package-info";
import { AssignmentManager } from "./jupyter/assignments";
import { getJupyterApi } from "./jupyter/jupyter-extension";
import { ColabJupyterServerProvider } from "./jupyter/provider";
import { ServerStorage } from "./jupyter/storage";
import { ExtensionUriHandler } from "./system/uri";

// Called when the extension is activated.
export async function activate(context: vscode.ExtensionContext) {
  const logging = initializeLogger(vscode, context.extensionMode);
  const jupyter = await getJupyterApi(vscode);
  logEnvInfo(jupyter);
  const uriHandler = new ExtensionUriHandler(vscode);
  const uriHandlerRegistration = vscode.window.registerUriHandler(uriHandler);
  const authClient = new OAuth2Client(
    CONFIG.ClientId,
    CONFIG.ClientNotSoSecret,
  );
  const authFlows = getOAuth2Flows(
    vscode,
    getPackageInfo(context.extension),
    authClient,
  );
  const authProvider = new GoogleAuthProvider(
    vscode,
    new AuthStorage(context.secrets),
    authClient,
    (scopes: string[]) => login(vscode, authFlows, authClient, scopes),
  );
  await authProvider.initialize();
  const colabClient = new ColabClient(
    new URL(CONFIG.ColabApiDomain),
    new URL(CONFIG.ColabGapiDomain),
    () =>
      GoogleAuthProvider.getOrCreateSession(vscode).then(
        (session) => session.accessToken,
      ),
  );
  const serverStorage = new ServerStorage(vscode, context.secrets);
  const assignmentManager = new AssignmentManager(
    vscode,
    colabClient,
    serverStorage,
  );
  const serverProvider = new ColabJupyterServerProvider(
    vscode,
    authProvider.whileAuthorized.bind(authProvider),
    assignmentManager,
    colabClient,
    new ServerPicker(vscode, assignmentManager),
    jupyter.exports,
  );
  const connections = new ConnectionRefreshController(assignmentManager);
  const keepServersAlive = new ServerKeepAliveController(
    vscode,
    colabClient,
    assignmentManager,
  );
  const consumptionMonitor = watchConsumption(colabClient);
  // Sending server "keep-alive" pings and monitoring consumption requires
  // issuing authenticated requests to Colab. This can only be done after the
  // user has signed in. We don't block extension activation on completing the
  // heavily asynchronous sign-in flow.
  const whileAuthorizedToggle = authProvider.whileAuthorized(
    connections,
    keepServersAlive,
    consumptionMonitor.toggle,
  );

  context.subscriptions.push(
    logging,
    uriHandler,
    uriHandlerRegistration,
    disposeAll(authFlows),
    authProvider,
    assignmentManager,
    serverProvider,
    connections,
    keepServersAlive,
    ...consumptionMonitor.disposables,
    whileAuthorizedToggle,
    ...registerCommands(assignmentManager, authProvider),
  );
}

function logEnvInfo(jupyter: vscode.Extension<Jupyter>) {
  log.info(`${vscode.env.appName}: ${vscode.version}`);
  log.info(`Remote: ${vscode.env.remoteName ?? "N/A"}`);
  log.info(`App Host: ${vscode.env.appHost}`);
  const jupyterVersion = getPackageInfo(jupyter).version;
  log.info(`Jupyter extension version: ${jupyterVersion}`);
}

/**
 * Sets up consumption monitoring.
 *
 * If the user has already signed in, starts immediately. Otherwise, waits until
 * the user signs in.
 */
function watchConsumption(colab: ColabClient): {
  toggle: Toggleable;
  disposables: Disposable[];
} {
  const disposables: Disposable[] = [];
  const poller = new ConsumptionPoller(vscode, colab);
  disposables.push(poller);
  const notifier = new ConsumptionNotifier(
    vscode,
    colab,
    poller.onDidChangeCcuInfo,
  );
  disposables.push(notifier);

  return { toggle: poller, disposables };
}

function registerCommands(
  assignmentManager: AssignmentManager,
  authProvider: GoogleAuthProvider,
): Disposable[] {
  return [
    vscode.commands.registerCommand(SIGN_OUT.id, async () => {
      await authProvider.signOut();
    }),
    // TODO: Register the rename server alias command once rename is reflected
    // in the recent kernels list. See https://github.com/microsoft/vscode-jupyter/issues/17107.
    vscode.commands.registerCommand(
      REMOVE_SERVER.id,
      async (withBackButton?: boolean) => {
        await removeServer(vscode, assignmentManager, withBackButton);
      },
    ),
    vscode.commands.registerCommand(COLAB_TOOLBAR.id, async () => {
      await notebookToolbar(vscode, assignmentManager);
    }),
  ];
}

/**
 * Returns a Disposable that calls dispose on all items in the array which are
 * disposable.
 */
function disposeAll(items: { dispose?: () => void }[]): Disposable {
  return {
    dispose: () => {
      items.forEach((item) => item.dispose?.());
    },
  };
}
