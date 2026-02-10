/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'assert';
import vscode from 'vscode';
import { Disposable } from 'vscode';
import { COLAB_EXT_IDENTIFIER } from '../config/constants';
import { getPackageInfo } from '../config/package-info';
import { JUPYTER_EXT_IDENTIFIER } from '../jupyter/jupyter-extension';
import { ClearcutClient, ColabLogEventBase, ColabEvent } from './client';

let client: ClearcutClient | undefined;
// Fields that aren't expected to change for the duration of the session.
let baseLog: ColabLogEventBase;

/**
 * Initializes the telemetry module
 * @param context - The VS Code extension context
 * @param vs - The vscode module.
 * @returns A {@link Disposable} that can be used to clean up the client.
 */
export function initializeTelemetry(vs: typeof vscode): Disposable {
  if (client) {
    throw new Error('Telemetry has already been initialized.');
  }

  const colabExtension = vs.extensions.getExtension(COLAB_EXT_IDENTIFIER);
  assert(colabExtension);
  const jupyterExtension = vs.extensions.getExtension(JUPYTER_EXT_IDENTIFIER);
  assert(jupyterExtension);

  baseLog = {
    extension_version: getPackageInfo(colabExtension).version,
    jupyter_extension_version: getPackageInfo(jupyterExtension).version,
    session_id: vs.env.sessionId,
    ui_kind:
      vs.env.uiKind === vs.UIKind.Desktop ? 'UI_KIND_DESKTOP' : 'UI_KIND_WEB',
    vscode_version: vs.version,
  };

  client = new ClearcutClient();

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
  logError: (e: unknown) => {
    if (e instanceof Error) {
      log({
        error_event: { name: e.name, msg: e.message, stack: e.stack ?? '' },
      });
    } else if (typeof e === 'string') {
      log({ error_event: { name: 'Error', msg: e, stack: '' } });
    } else {
      const msg = e ? JSON.stringify(e) : String(e);
      log({ error_event: { name: 'Error', msg, stack: '' } });
    }
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
