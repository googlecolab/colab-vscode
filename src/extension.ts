/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Jupyter } from '@vscode/jupyter-extension';
import vscode from 'vscode';
import { createAuthModule } from './auth/module';
import { createColabClient, createColabModule } from './colab/module';
import { initializeLogger, log } from './common/logging';
import { getPackageInfo } from './config/package-info';
import { IMPORT_DRIVE_FILE_PATH } from './drive/commands/constants';
import { handleImportUriEvents } from './drive/commands/import';
import { createDriveModule } from './drive/module';
import { getJupyterApi } from './jupyter/jupyter-extension';
import { createJupyterModule } from './jupyter/module';
import { ExtensionUriHandler, registerUriRoutes } from './system/uri';
import { withErrorTracking } from './telemetry/decorators';
import { initializeTelemetryWithNotice } from './telemetry/notice';
import { createProcessErrorHandler } from './telemetry/process-errors';

/**
 * Called when the extension is activated.
 *
 * @param context - The extension context for utilities private to the
 * extension.
 */
export async function activate(context: vscode.ExtensionContext) {
  await withErrorTracking(activateInternal)(context);
}

async function activateInternal(context: vscode.ExtensionContext) {
  const handleProcessError = createProcessErrorHandler(
    context.extensionUri.fsPath,
  );
  process.on('uncaughtException', handleProcessError);
  process.on('unhandledRejection', handleProcessError);
  const logging = initializeLogger(vscode, context.extensionMode);
  const disposeTelemetry = initializeTelemetryWithNotice(
    vscode,
    context.globalState,
  );
  const jupyter = await getJupyterApi(vscode);
  logEnvInfo(jupyter);
  const uriHandler = new ExtensionUriHandler(vscode);
  const packageInfo = getPackageInfo(context.extension);
  const auth = createAuthModule(vscode, context, packageInfo);
  const { authProvider } = auth;
  const colabClient = createColabClient(vscode, authProvider, packageInfo);
  const drive = createDriveModule(vscode, authProvider);
  const jupyterModule = createJupyterModule(
    vscode,
    context,
    jupyter,
    authProvider,
    colabClient,
  );
  const colab = createColabModule(
    vscode,
    colabClient,
    jupyterModule.assignmentManager,
  );
  await authProvider.initialize();
  // Sending server "keep-alive" pings and monitoring consumption requires
  // issuing authenticated requests to Colab. This can only be done after the
  // user has signed in. We don't block extension activation on completing the
  // heavily asynchronous sign-in flow.
  const whileAuthorizedToggle = authProvider.whileAuthorized(
    ...jupyterModule.toggles,
    ...colab.toggles,
  );
  const routes = registerUriRoutes(
    uriHandler.onReceivedUri,
    new Map([
      [
        IMPORT_DRIVE_FILE_PATH,
        (uri) => {
          handleImportUriEvents(vscode, uri);
        },
      ],
    ]),
  );

  context.subscriptions.push(
    logging,
    disposeTelemetry,
    uriHandler,
    ...auth.disposables,
    ...jupyterModule.disposables,
    ...colab.disposables,
    whileAuthorizedToggle,
    // Command disposables are pushed last so they are disposed first, which
    // removes the command handlers before the underlying services tear down.
    ...drive.commandDisposables,
    ...jupyterModule.commandDisposables,
    routes,
  );
  // Register the URI handler with VS Code *after* all event listeners and
  // commands are set up, to avoid the race condition where the URI that
  // triggered onUri activation is delivered before the listener in
  // registerUriRoutes() is subscribed, causing the first deep link to be lost.
  context.subscriptions.push(vscode.window.registerUriHandler(uriHandler));
}

function logEnvInfo(jupyter: vscode.Extension<Jupyter>) {
  log.info(`${vscode.env.appName}: ${vscode.version}`);
  log.info(`Remote: ${vscode.env.remoteName ?? 'N/A'}`);
  log.info(`App Host: ${vscode.env.appHost}`);
  const jupyterVersion = getPackageInfo(jupyter).version;
  log.info(`Jupyter extension version: ${jupyterVersion}`);
}
