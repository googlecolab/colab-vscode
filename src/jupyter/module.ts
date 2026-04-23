/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Jupyter } from '@vscode/jupyter-extension';
import vscode, { Disposable, Extension, ExtensionContext } from 'vscode';
import { GoogleAuthProvider } from '../auth/auth-provider';
import { ColabClient } from '../colab/client';
import { registerColabCommands } from '../colab/commands/register';
import { ConnectionRefreshController } from '../colab/connection-refresher';
import { ContentTreeProvider } from '../colab/content-browser/content-tree';
import { registerContentBrowserCommands } from '../colab/content-browser/register';
import { ServerKeepAliveController } from '../colab/keep-alive';
import { ResourceTreeProvider } from '../colab/resource-monitor/resource-tree';
import { ServerPicker } from '../colab/server-picker';
import { Toggleable } from '../common/toggleable';
import { AssignmentManager } from './assignments';
import { ContentsFileSystemProvider } from './contents/file-system';
import { JupyterConnectionManager } from './contents/sessions';
import { ColabJupyterServerProvider } from './provider';
import { ServerStorage } from './storage';

/** The result of activating the Jupyter integration module. */
export interface JupyterModule {
  /** Manages the user's assigned Colab Jupyter servers. */
  readonly assignmentManager: AssignmentManager;
  /**
   * Service-level disposables (assignment manager, server provider, jupyter
   * connections, file-system registration, both tree views, connection
   * refresher, keep-alive controller). Push these into
   * `context.subscriptions` before the colab background services so they tear
   * down in the correct order.
   */
  readonly disposables: Disposable[];
  /**
   * Command-registration disposables. Push these LAST in
   * `context.subscriptions` so they are disposed earliest, removing command
   * handlers before the underlying services tear down.
   */
  readonly commandDisposables: Disposable[];
  /** Auth-gated toggles that should be passed to `whileAuthorized`. */
  readonly toggles: Toggleable[];
}

/**
 * Builds the Jupyter integration: assignment manager, server provider,
 * connections, file system, both tree views, connection refresher, keep-alive
 * controller, and registers the Colab + content-browser commands that depend
 * on these services.
 *
 * @param vs - The VS Code API instance.
 * @param context - The extension context (for `secrets` access).
 * @param jupyter - The installed Jupyter extension.
 * @param authProvider - The authentication provider; supplies session-change
 * events used by several services.
 * @param colab - The Colab client used by the assignment manager and
 * resource view.
 * @returns The services and disposables produced.
 */
export function createJupyterModule(
  vs: typeof vscode,
  context: ExtensionContext,
  jupyter: Extension<Jupyter>,
  authProvider: GoogleAuthProvider,
  colab: ColabClient,
): JupyterModule {
  const serverStorage = new ServerStorage(vs, context.secrets);
  const assignmentManager = new AssignmentManager(vs, colab, serverStorage);
  const serverProvider = new ColabJupyterServerProvider(
    vs,
    authProvider.onDidChangeSessions,
    assignmentManager,
    colab,
    new ServerPicker(vs, assignmentManager),
    jupyter.exports,
  );
  const jupyterConnections = new JupyterConnectionManager(
    vs,
    authProvider.onDidChangeSessions,
    assignmentManager,
  );
  const fs = new ContentsFileSystemProvider(vs, jupyterConnections);
  const contentTree = new ContentTreeProvider(
    assignmentManager,
    authProvider.onDidChangeSessions,
    assignmentManager.onDidAssignmentsChange,
    fs.onDidChangeFile,
  );
  const resourceTree = new ResourceTreeProvider(
    assignmentManager,
    assignmentManager.onDidAssignmentsChange,
    authProvider.onDidChangeSessions,
    colab,
  );
  const connections = new ConnectionRefreshController(assignmentManager);
  const keepAlive = new ServerKeepAliveController(vs, colab, assignmentManager);

  const fsDisposable = vs.workspace.registerFileSystemProvider('colab', fs, {
    isCaseSensitive: true,
  });
  const contentTreeView = vs.window.createTreeView(
    'colab-server-content-view',
    { treeDataProvider: contentTree },
  );
  const resourceTreeView = vs.window.createTreeView(
    'colab-server-resource-view',
    { treeDataProvider: resourceTree },
  );

  const colabCommandDisposables = registerColabCommands(vs, {
    authProvider,
    assignmentManager,
    fs,
  });
  const contentBrowserCommandDisposables = registerContentBrowserCommands(vs, {
    contentTree,
    resourceTree,
  });

  return {
    assignmentManager,
    disposables: [
      assignmentManager,
      serverProvider,
      jupyterConnections,
      fsDisposable,
      contentTreeView,
      resourceTreeView,
      connections,
      keepAlive,
    ],
    commandDisposables: [
      ...colabCommandDisposables,
      ...contentBrowserCommandDisposables,
    ],
    toggles: [connections, keepAlive],
  };
}
