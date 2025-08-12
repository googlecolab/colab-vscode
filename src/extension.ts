/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OAuth2Client } from "google-auth-library";
import vscode from "vscode";
import { GoogleAuthProvider } from "./auth/auth-provider";
import { getOAuth2Flows } from "./auth/flows/flows";
import { login } from "./auth/login";
import { AuthStorage } from "./auth/storage";
import { ColabClient } from "./colab/client";
import {
  COLAB_TOOLBAR,
  REMOVE_SERVER,
  RENAME_SERVER_ALIAS,
} from "./colab/commands/constants";
import { notebookToolbar } from "./colab/commands/notebook";
import { renameServerAlias, removeServer } from "./colab/commands/server";
import { ServerKeepAliveController } from "./colab/keep-alive";
import { ServerPicker } from "./colab/server-picker";
import { CONFIG } from "./colab-config";
import { getPackageInfo } from "./config/package-info";
import { AssignmentManager } from "./jupyter/assignments";
import { getJupyterApi } from "./jupyter/jupyter-extension";
import { ColabJupyterServerProvider } from "./jupyter/provider";
import { ServerStorage } from "./jupyter/storage";
import { ExtensionUriHandler } from "./system/uri-handler";

// Called when the extension is activated.
export async function activate(context: vscode.ExtensionContext) {
  const jupyter = await getJupyterApi(vscode);
  const uriHandler = new ExtensionUriHandler(vscode);
  const disposeUriHandler = vscode.window.registerUriHandler(uriHandler);
  const authClient = new OAuth2Client(
    CONFIG.ClientId,
    CONFIG.ClientNotSoSecret,
  );
  const authFlows = getOAuth2Flows(
    vscode,
    getPackageInfo(context),
    uriHandler,
    authClient,
  );
  const authProvider = new GoogleAuthProvider(
    vscode,
    new AuthStorage(context.secrets),
    authClient,
    (scopes: string[]) => login(vscode, authFlows, authClient, scopes),
  );
  await authProvider.initialize();
  // TODO: Align these URLs with the environment. Mismatch is no big deal during
  // development.
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
  await assignmentManager.reconcileAssignedServers();
  await assignmentManager.setHasAssignedServerContext();

  const keepAlive = new ServerKeepAliveController(
    vscode,
    colabClient,
    assignmentManager,
  );
  const serverProvider = new ColabJupyterServerProvider(
    vscode,
    assignmentManager,
    colabClient,
    new ServerPicker(vscode, assignmentManager),
    jupyter,
  );

  context.subscriptions.push(
    disposeUriHandler,
    {
      dispose: () => {
        authFlows.forEach((flow) => {
          flow.dispose?.();
        });
      },
    },
    authProvider,
    assignmentManager,
    keepAlive,
    serverProvider,
    vscode.commands.registerCommand(
      RENAME_SERVER_ALIAS.id,
      async (withBackButton?: boolean) => {
        await renameServerAlias(vscode, serverStorage, withBackButton);
      },
    ),
    vscode.commands.registerCommand(
      REMOVE_SERVER.id,
      async (withBackButton?: boolean) => {
        await removeServer(vscode, assignmentManager, withBackButton);
      },
    ),
    vscode.commands.registerCommand(COLAB_TOOLBAR.id, async () => {
      await notebookToolbar(vscode, assignmentManager);
    }),
  );
}
