/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import vscode from 'vscode';
import { Disposable } from 'vscode';
import { getPackageInfo } from '../config/package-info';
import { getJupyterApi } from '../jupyter/jupyter-extension';
import { ClearcutClient, ColabLogEventBase, ColabEvent } from './client';

let client: ClearcutClient | undefined;
// Fields that aren't expected to change for the duration of the session.
let baseLog: Omit<ColabLogEventBase, 'timestamp'>;

/**
 * Initializes the telemetry module
 * @param context - The VS Code extension context
 * @param vs - The vscode module.
 * @returns A promise that resolves with a {@link Disposable} that can be used
 * to clean up the client.
 */
export async function initializeTelemetry(
  context: vscode.ExtensionContext,
  vs: typeof vscode,
): Promise<Disposable> {
  if (client) {
    throw new Error('Telemetry has already been initialized.');
  }

  client = new ClearcutClient();

  const jupyterExtension = await getJupyterApi(vs);
  baseLog = {
    extension_version: getPackageInfo(context.extension).version,
    jupyter_extension_version: getPackageInfo(jupyterExtension).version,
    session_id: vs.env.sessionId,
    ui_kind:
      vs.env.uiKind === vs.UIKind.Desktop ? 'UI_KIND_DESKTOP' : 'UI_KIND_WEB',
    vscode_version: vs.version,
  };

  return {
    dispose: () => {
      client?.dispose();
      client = undefined;
    },
  };
}

/**
 * A collection of functions for logging telemetry events.
 */
export const telemetry = {
  logActivation: () => {
    log({ activation_event: {} });
  },
  logError: (e: Error) => {
    log({
      error_event: { name: e.name, msg: e.message, stack: e.stack ?? '' },
    });
  },
};

function log(event: ColabEvent) {
  // TODO: Add listener for telemetry setting and return early if opted-out
  // TODO: Skip logging in integration tests
  if (!client) {
    return;
  }
  client.log({
    ...baseLog,
    ...event,
    timestamp: new Date().toISOString(),
  });
}
