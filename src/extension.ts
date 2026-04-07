/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Jupyter } from '@vscode/jupyter-extension';
import { OAuth2Client } from 'google-auth-library';
import vscode, { Disposable } from 'vscode';
import { GoogleAuthProvider } from './auth/auth-provider';
import { getOAuth2Flows } from './auth/flows/flows';
import { login, LoginOptions } from './auth/login';
import { DRIVE_SCOPES, REQUIRED_SCOPES } from './auth/scopes';
import { AuthStorage } from './auth/storage';
import { ColabClient } from './colab/client';
import {
  COLAB_TOOLBAR,
  UPLOAD,
  MOUNT_DRIVE,
  MOUNT_SERVER,
  REMOVE_SERVER,
  SIGN_OUT,
  OPEN_TERMINAL,
} from './colab/commands/constants';
import { upload } from './colab/commands/files';
import { notebookToolbar, appendCodeCell } from './colab/commands/notebook';
import { mountServer, removeServer } from './colab/commands/server';
import { openTerminal } from './colab/commands/terminal';
import { ConnectionRefreshController } from './colab/connection-refresher';
import { ConsumptionNotifier } from './colab/consumption/notifier';
import { ConsumptionPoller } from './colab/consumption/poller';
import { ConsumptionStatusBar } from './colab/consumption/status-bar';
import {
  deleteFile,
  download,
  newFile,
  newFolder,
  renameFile,
} from './colab/content-browser/commands';
import { ContentItem } from './colab/content-browser/content-item';
import { ContentTreeProvider } from './colab/content-browser/content-tree';
import { ExperimentStateProvider } from './colab/experiment-state';
import { ServerKeepAliveController } from './colab/keep-alive';
import { ResourceTreeProvider } from './colab/resource-monitor/resource-tree';
import { ServerPicker } from './colab/server-picker';
import { CONFIG } from './colab-config';
import { initializeLogger, log } from './common/logging';
import { Toggleable } from './common/toggleable';
import { getPackageInfo } from './config/package-info';
import { DriveClient } from './drive/client';
import {
  IMPORT_DRIVE_FILE_PATH,
  IMPORT_NOTEBOOK_FROM_URL,
} from './drive/commands/constants';
import {
  handleImportUriEvents,
  importNotebookFromUrl,
} from './drive/commands/import';
import { AssignmentManager } from './jupyter/assignments';
import { ContentsFileSystemProvider } from './jupyter/contents/file-system';
import { JupyterConnectionManager } from './jupyter/contents/sessions';
import { getJupyterApi } from './jupyter/jupyter-extension';
import { ColabJupyterServerProvider } from './jupyter/provider';
import { ServerStorage } from './jupyter/storage';
import { ExtensionUriHandler } from './system/uri';
import { telemetry } from './telemetry';
import { CommandSource } from './telemetry/api';
import { withErrorTracking } from './telemetry/decorators';
import { initializeTelemetryWithNotice } from './telemetry/notice';

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
  process.on('uncaughtException', telemetry.logError);
  process.on('unhandledRejection', telemetry.logError);
  const logging = initializeLogger(vscode, context.extensionMode);
  const disposeTelemetry = initializeTelemetryWithNotice(
    vscode,
    context.globalState,
  );
  const jupyter = await getJupyterApi(vscode);
  logEnvInfo(jupyter);
  const uriHandler = new ExtensionUriHandler(vscode);
  const authClient = new OAuth2Client(
    CONFIG.ClientId,
    CONFIG.ClientNotSoSecret,
  );
  const packageInfo = getPackageInfo(context.extension);
  const authFlows = getOAuth2Flows(vscode, packageInfo, authClient);
  const authProvider = new GoogleAuthProvider(
    vscode,
    new AuthStorage(context.secrets),
    authClient,
    (scopes: string[], options?: LoginOptions) =>
      login(vscode, authFlows, authClient, scopes, options),
  );
  const colabClient = ColabClient.create(
    new URL(CONFIG.ColabApiDomain),
    new URL(CONFIG.ColabGapiDomain),
    { appName: vscode.env.appName, extensionVersion: packageInfo.version },
    () =>
      GoogleAuthProvider.getOrCreateSession(vscode, REQUIRED_SCOPES).then(
        (session) => session.accessToken,
      ),
    () => authProvider.signOut(),
  );
  const driveClient = DriveClient.create(
    () =>
      GoogleAuthProvider.getOrCreateSession(vscode, DRIVE_SCOPES).then(
        (session) => session.accessToken,
      ),
    () => authProvider.signOut(),
  );
  const serverStorage = new ServerStorage(vscode, context.secrets);
  const assignmentManager = new AssignmentManager(
    vscode,
    colabClient,
    serverStorage,
  );
  const serverProvider = new ColabJupyterServerProvider(
    vscode,
    authProvider.onDidChangeSessions,
    assignmentManager,
    colabClient,
    new ServerPicker(vscode, assignmentManager),
    jupyter.exports,
  );
  const jupyterConnections = new JupyterConnectionManager(
    vscode,
    authProvider.onDidChangeSessions,
    assignmentManager,
  );
  const fs = new ContentsFileSystemProvider(vscode, jupyterConnections);
  const serverContentTreeView = new ContentTreeProvider(
    assignmentManager,
    authProvider.onDidChangeSessions,
    assignmentManager.onDidAssignmentsChange,
    fs.onDidChangeFile,
  );
  const serverResourceTreeView = new ResourceTreeProvider(
    assignmentManager,
    assignmentManager.onDidAssignmentsChange,
    authProvider.onDidChangeSessions,
    colabClient,
  );
  const connections = new ConnectionRefreshController(assignmentManager);
  const keepServersAlive = new ServerKeepAliveController(
    vscode,
    colabClient,
    assignmentManager,
  );
  const consumptionMonitor = watchConsumption(colabClient);
  const experimentStateProvider = new ExperimentStateProvider(colabClient);
  await authProvider.initialize();
  // Sending server "keep-alive" pings and monitoring consumption requires
  // issuing authenticated requests to Colab. This can only be done after the
  // user has signed in. We don't block extension activation on completing the
  // heavily asynchronous sign-in flow.
  const whileAuthorizedToggle = authProvider.whileAuthorized(
    connections,
    keepServersAlive,
    ...consumptionMonitor.toggles,
    experimentStateProvider,
  );
  const disposeFs = vscode.workspace.registerFileSystemProvider('colab', fs, {
    isCaseSensitive: true,
  });
  const disposeContentTreeView = vscode.window.createTreeView(
    'colab-server-content-view',
    { treeDataProvider: serverContentTreeView },
  );
  const disposeResourceTreeView = vscode.window.createTreeView(
    'colab-server-resource-view',
    { treeDataProvider: serverResourceTreeView },
  );

  context.subscriptions.push(
    logging,
    disposeTelemetry,
    uriHandler,
    disposeAll(authFlows),
    authProvider,
    assignmentManager,
    experimentStateProvider,
    serverProvider,
    jupyterConnections,
    disposeFs,
    disposeContentTreeView,
    disposeResourceTreeView,
    connections,
    keepServersAlive,
    ...consumptionMonitor.disposables,
    whileAuthorizedToggle,
    ...registerCommands(
      authProvider,
      assignmentManager,
      serverContentTreeView,
      serverResourceTreeView,
      fs,
      driveClient,
    ),
    handleUriEvents(uriHandler.onReceivedUri),
  );
  // Register the URI handler with VS Code *after* all event listeners and
  // commands are set up, to avoid the race condition where the URI that
  // triggered onUri activation is delivered before the listener in
  // handleUriEvents() is subscribed, causing the first deep link to be lost.
  context.subscriptions.push(vscode.window.registerUriHandler(uriHandler));

  telemetry.logActivation();
}

function logEnvInfo(jupyter: vscode.Extension<Jupyter>) {
  log.info(`${vscode.env.appName}: ${vscode.version}`);
  log.info(`Remote: ${vscode.env.remoteName ?? 'N/A'}`);
  log.info(`App Host: ${vscode.env.appHost}`);
  const jupyterVersion = getPackageInfo(jupyter).version;
  log.info(`Jupyter extension version: ${jupyterVersion}`);
}

/**
 * Sets up consumption monitoring.
 *
 * If the user has already signed in, starts immediately. Otherwise, waits until
 * the user signs in.
 *
 * @param colab - The colab client used to poll consumption.
 * @returns An object containing a {@link Toggleable} to control the polling and
 * any disposables created for the monitoring.
 */
function watchConsumption(colab: ColabClient): {
  toggles: Toggleable[];
  disposables: Disposable[];
} {
  const poller = new ConsumptionPoller(vscode, colab);
  const notifier = new ConsumptionNotifier(vscode, poller.onDidChangeCcuInfo);
  const statusBar = new ConsumptionStatusBar(vscode, poller.onDidChangeCcuInfo);
  return {
    toggles: [poller, statusBar],
    disposables: [poller, notifier, statusBar],
  };
}

function registerCommands(
  authProvider: GoogleAuthProvider,
  assignmentManager: AssignmentManager,
  contentTreeProvider: ContentTreeProvider,
  resourceTreeProvider: ResourceTreeProvider,
  fs: ContentsFileSystemProvider,
  driveClient: DriveClient,
): Disposable[] {
  return [
    registerCommand(SIGN_OUT.id, async () => {
      await authProvider.signOut();
    }),
    // TODO: Register the rename server alias command once rename is reflected
    // in the recent kernels list. See https://github.com/microsoft/vscode-jupyter/issues/17107.
    registerCommand(
      MOUNT_SERVER.id,
      async (source?: CommandSource, withBackButton?: boolean) => {
        await mountServer(
          vscode,
          assignmentManager,
          fs,
          source ?? CommandSource.COMMAND_SOURCE_COMMAND_PALETTE,
          withBackButton,
        );
      },
    ),
    registerCommand(MOUNT_DRIVE.id, async (source?: CommandSource) => {
      telemetry.logMountDriveSnippet(
        source ?? CommandSource.COMMAND_SOURCE_COMMAND_PALETTE,
      );
      await appendCodeCell(
        vscode,
        [
          'from google.colab import drive',
          `drive.mount('/content/drive')`,
        ].join('\n'),
        'python',
      );
    }),
    registerCommand(
      REMOVE_SERVER.id,
      async (source?: CommandSource, withBackButton?: boolean) => {
        await removeServer(vscode, assignmentManager, withBackButton, source);
      },
    ),
    registerCommand(UPLOAD.id, async (uri: vscode.Uri, uris?: vscode.Uri[]) => {
      await upload(vscode, assignmentManager, uri, uris);
    }),
    registerCommand(COLAB_TOOLBAR.id, async () => {
      await notebookToolbar(vscode, assignmentManager);
    }),
    registerCommand('colab.refreshServerContentView', () => {
      contentTreeProvider.refresh();
    }),
    registerCommand('colab.refreshServerResourceView', () => {
      resourceTreeProvider.refresh();
    }),
    registerCommand('colab.newFile', (contextItem: ContentItem) => {
      void newFile(vscode, contextItem);
    }),
    registerCommand('colab.newFolder', (contextItem: ContentItem) => {
      void newFolder(vscode, contextItem);
    }),
    registerCommand('colab.download', (contextItem: ContentItem) => {
      void download(vscode, contextItem);
    }),
    registerCommand('colab.renameFile', (contextItem: ContentItem) => {
      void renameFile(vscode, contextItem);
    }),
    registerCommand('colab.deleteFile', (contextItem: ContentItem) => {
      void deleteFile(vscode, contextItem);
    }),
    registerCommand(OPEN_TERMINAL.id, async (withBackButton?: boolean) => {
      await openTerminal(vscode, assignmentManager, withBackButton);
    }),
    registerCommand(IMPORT_NOTEBOOK_FROM_URL.id, async (url?: string) => {
      await importNotebookFromUrl(vscode, driveClient, url);
    }),
  ];
}

/**
 * Registers a command with the given identifier and handler.
 *
 * @param command - The unique identifier for the command.
 * @param handler - A command handler function.
 * @returns Disposable which deregisters this command on disposal.
 */
function registerCommand<T extends (...args: Parameters<T>) => ReturnType<T>>(
  command: string,
  handler: T,
): Disposable {
  return vscode.commands.registerCommand(command, withErrorTracking(handler));
}

/**
 * Handles incoming URI events to the extension.
 *
 * @param onReceivedUri - Event listener for Uri events
 * @returns Disposable which stops listening to URI events on disposal.
 */
function handleUriEvents(onReceivedUri: vscode.Event<vscode.Uri>): Disposable {
  const supportedPaths = [IMPORT_DRIVE_FILE_PATH];
  return onReceivedUri((uri) => {
    if (!supportedPaths.includes(uri.path.slice(1))) {
      return;
    }

    handleImportUriEvents(vscode, uri);
  });
}

function disposeAll(items: { dispose?: () => void }[]): Disposable {
  return {
    dispose: () => {
      items.forEach((item) => item.dispose?.());
    },
  };
}
