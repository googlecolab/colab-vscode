/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Disposable } from 'vscode';
import { GoogleAuthProvider } from '../auth/auth-provider';
import { REQUIRED_SCOPES } from '../auth/scopes';
import { CONFIG } from '../colab-config';
import { Toggleable } from '../common/toggleable';
import { PackageInfo } from '../config/package-info';
import { AssignmentManager } from '../jupyter/assignments';
import { ColabClient } from './client';
import { ConsumptionNotifier } from './consumption/notifier';
import { ConsumptionPoller } from './consumption/poller';
import { ConsumptionStatusBar } from './consumption/status-bar';
import { ExperimentStateProvider } from './experiment-state';

/**
 * Builds the {@link ColabClient} bound to the user's auth state.
 *
 * @param vs - The VS Code API instance.
 * @param authProvider - For token retrieval and sign-out on auth failure.
 * @param packageInfo - Used to set the user-agent on Colab requests.
 * @returns The constructed Colab client.
 */
export function createColabClient(
  vs: typeof vscode,
  authProvider: GoogleAuthProvider,
  packageInfo: PackageInfo,
): ColabClient {
  return ColabClient.create(
    new URL(CONFIG.ColabApiDomain),
    new URL(CONFIG.ColabGapiDomain),
    { appName: vs.env.appName, extensionVersion: packageInfo.version },
    () =>
      GoogleAuthProvider.getOrCreateSession(vs, REQUIRED_SCOPES).then(
        (session) => session.accessToken,
      ),
    () => authProvider.signOut(),
  );
}

/** The result of activating the Colab module's background services. */
export interface ColabModule {
  /** Disposables that should be pushed into `context.subscriptions`. */
  readonly disposables: Disposable[];
  /** Auth-gated toggles that should be passed to `whileAuthorized`. */
  readonly toggles: Toggleable[];
}

/**
 * Builds the Colab background services that depend on both the Colab client
 * and the assignment manager: consumption polling/notifier/status bar and the
 * experiment state provider.
 *
 * @param vs - The VS Code API instance.
 * @param colab - The Colab client used by consumption polling and experiments.
 * @param assignmentManager - Source of assignment-change events used to
 * trigger consumption polls.
 * @returns The disposables and auth-gated toggles produced.
 */
export function createColabModule(
  vs: typeof vscode,
  colab: ColabClient,
  assignmentManager: AssignmentManager,
): ColabModule {
  const poller = new ConsumptionPoller(
    vs,
    colab,
    assignmentManager.onDidAssignmentsChange,
  );
  const notifier = new ConsumptionNotifier(vs, poller.onDidChangeCcuInfo);
  const statusBar = new ConsumptionStatusBar(vs, poller.onDidChangeCcuInfo);
  const experimentStateProvider = new ExperimentStateProvider(colab);
  return {
    disposables: [poller, notifier, statusBar, experimentStateProvider],
    toggles: [poller, statusBar, experimentStateProvider],
  };
}
