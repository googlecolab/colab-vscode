/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'assert';
import vscode from 'vscode';
import { Disposable } from 'vscode';
import { AuthType } from '../colab/api';
import { COLAB_EXT_IDENTIFIER } from '../config/constants';
import { getPackageInfo } from '../config/package-info';
import { JUPYTER_EXT_IDENTIFIER } from '../jupyter/jupyter-extension';
import {
  ColabLogEventBase,
  ColabEvent,
  CommandSource,
  AuthFlow,
  ContentBrowserOperation,
  ContentBrowserTarget,
  NotebookSource,
  Outcome,
} from './api';
import { ClearcutClient } from './client';

let client: ClearcutClient | undefined;
// Fields that aren't expected to change for the duration of the session.
let baseLog: ColabLogEventBase;
// Indicates whether the user has telemetry enabled.
let isTelemetryEnabled: () => boolean;

/**
 * Initializes the telemetry module
 *
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
    app_name: vs.env.appName,
    extension_version: getPackageInfo(colabExtension).version,
    jupyter_extension_version: getPackageInfo(jupyterExtension).version,
    platform: process.platform,
    session_id: vs.env.sessionId,
    ui_kind:
      vs.env.uiKind === vs.UIKind.Desktop ? 'UI_KIND_DESKTOP' : 'UI_KIND_WEB',
    vscode_version: vs.version,
  };

  isTelemetryEnabled = () => vs.env.isTelemetryEnabled;
  client = new ClearcutClient(vs);

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
  logAutoConnect: () => {
    log({ auto_connect_event: {} });
  },
  logAssignServer: () => {
    log({ assign_server_event: {} });
  },
  logColabToolbar: () => {
    log({ colab_toolbar_event: {} });
  },
  logContentBrowserFileOperation: (
    operation: ContentBrowserOperation,
    outcome: Outcome,
    target: ContentBrowserTarget,
  ) => {
    log({
      content_browser_file_operation_event: { operation, outcome, target },
    });
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
  logHandleEphemeralAuth: (authType: AuthType) => {
    log({ handle_ephemeral_auth_event: { auth_type: authType } });
  },
  logImportNotebook: (
    source: CommandSource,
    notebookSource: NotebookSource,
  ) => {
    log({ import_notebook_event: { source, notebook_source: notebookSource } });
  },
  logMountDriveSnippet: (source: CommandSource) => {
    log({ mount_drive_snippet_event: { source } });
  },
  logMountServer: (source: CommandSource, server?: string) => {
    log({ mount_server_event: { source, server } });
  },
  logOpenColabWeb: (source: CommandSource) => {
    log({ open_colab_web_event: { source } });
  },
  logOpenTerminal: (source: CommandSource) => {
    log({ open_terminal_event: { source } });
  },
  logPruneServers: (servers: string[]) => {
    log({ prune_servers_event: { servers } });
  },
  logRemoveServer: (source = CommandSource.COMMAND_SOURCE_UNSPECIFIED) => {
    log({
      remove_server_event: {
        source,
      },
    });
  },
  logSignIn: (flow: AuthFlow, succeeded: boolean) => {
    log({ sign_in_event: { auth_flow: flow, succeeded } });
  },
  logSignOut: () => {
    log({ sign_out_event: {} });
  },
  logUpgradeToPro: (source: CommandSource) => {
    log({ upgrade_to_pro_event: { source } });
  },
  logUpload: (
    source: CommandSource,
    outcome: Outcome,
    stats: {
      successCount: number;
      failCount: number;
      fileCount: number;
      directoryCount: number;
      uploadedBytes: number;
    },
  ) => {
    log({
      upload_event: {
        source,
        outcome,
        success_count: stats.successCount,
        fail_count: stats.failCount,
        file_count: stats.fileCount,
        directory_count: stats.directoryCount,
        uploaded_bytes: stats.uploadedBytes,
      },
    });
  },
};

function log(event: ColabEvent) {
  // TODO: Skip logging in integration tests
  if (!client || !isTelemetryEnabled()) {
    return;
  }
  client.log({
    ...baseLog,
    ...event,
    timestamp: new Date().toISOString(),
  });
}
