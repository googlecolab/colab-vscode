/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'assert';
import vscode from 'vscode';
import { Disposable } from 'vscode';
import { AuthType } from '../colab/client/v1/api';
import { getExperimentIds } from '../colab/experiment-state';
import { SubscriptionTier as ColabSubscriptionTier } from '../colab/types';
import { describeCauses, truncateMessage } from '../common/error-description';
import { COLAB_EXT_IDENTIFIER } from '../config/constants';
import { getPackageInfo } from '../config/package-info';
import { JUPYTER_EXT_IDENTIFIER } from '../jupyter/jupyter-extension';
import {
  ColabLogEventBase,
  ColabEvent,
  CommandSource,
  AssignmentOutcome,
  AuthFlow,
  ContentBrowserOperation,
  ContentBrowserTarget,
  LowBalanceSeverity,
  NotebookSource,
  Outcome,
  SubscriptionTier,
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
  /** Logs that the extension was activated. */
  logActivation: () => {
    log({ activation_event: {} });
  },
  /** Logs an automatic connection to a server. */
  logAutoConnect: () => {
    log({ auto_connect_event: {} });
  },
  /**
   * Logs the outcome of a server assignment request.
   *
   * @param outcome - Whether the operation succeeded.
   * @param config - The requested server configuration.
   */
  logAssignServer: (
    outcome: AssignmentOutcome,
    config: {
      variant: string;
      accelerator: string;
      shape: string;
      version: string;
      hadFallback: boolean;
    },
  ) => {
    log({
      assign_server_event: {
        outcome,
        variant: config.variant,
        accelerator: config.accelerator,
        shape: config.shape,
        version: config.version,
        had_fallback: config.hadFallback,
      },
    });
  },
  /** Logs use of the Colab toolbar. */
  logColabToolbar: () => {
    log({ colab_toolbar_event: {} });
  },
  /**
   * Logs a file operation performed in the content browser.
   *
   * @param operation - The operation performed.
   * @param outcome - Whether the operation succeeded.
   * @param target - What the operation targeted.
   */
  logContentBrowserFileOperation: (
    operation: ContentBrowserOperation,
    outcome: Outcome,
    target: ContentBrowserTarget,
  ) => {
    log({
      content_browser_file_operation_event: { operation, outcome, target },
    });
  },
  /**
   * Logs the outcome of a file download.
   *
   * @param outcome - Whether the operation succeeded.
   * @param downloadedBytes - Number of bytes downloaded.
   */
  logDownload: (outcome: Outcome, downloadedBytes: number) => {
    log({
      download_event: { outcome, downloaded_bytes: downloadedBytes },
    });
  },
  /**
   * Logs a low compute unit balance notification.
   *
   * @param severity - How low the balance is.
   * @param subscriptionTier - The user's subscription tier.
   * @param clickedAction - Whether the user clicked the notification action.
   */
  logLowCcuNotification: (
    severity: LowBalanceSeverity,
    subscriptionTier: ColabSubscriptionTier,
    clickedAction: boolean,
  ) => {
    log({
      low_ccu_notification_event: {
        severity,
        subscription_tier: toTelemetrySubscriptionTier(subscriptionTier),
        clicked_action: clickedAction,
      },
    });
  },
  /**
   * Logs an error, truncating long messages.
   *
   * @param e - The error to log; any value is accepted.
   */
  logError: (e: unknown) => {
    if (e instanceof Error) {
      const causes = describeCauses(e);
      log({
        error_event: {
          name: e.name,
          msg: truncateMessage(
            causes ? `${e.message} <- ${causes}` : e.message,
          ),
          stack: e.stack ?? '',
        },
      });
    } else if (typeof e === 'string') {
      log({
        error_event: { name: 'Error', msg: truncateMessage(e), stack: '' },
      });
    } else {
      const msg = e ? JSON.stringify(e) : String(e);
      log({
        error_event: { name: 'Error', msg: truncateMessage(msg), stack: '' },
      });
    }
  },
  /**
   * Logs the handling of an ephemeral authentication request.
   *
   * @param authType - The kind of authentication being handled.
   */
  logHandleEphemeralAuth: (authType: AuthType) => {
    log({ handle_ephemeral_auth_event: { auth_type: authType } });
  },
  /**
   * Logs a notebook import.
   *
   * @param source - Where the action was triggered from.
   * @param notebookSource - Where the notebook was imported from.
   */
  logImportNotebook: (
    source: CommandSource,
    notebookSource: NotebookSource,
  ) => {
    log({ import_notebook_event: { source, notebook_source: notebookSource } });
  },
  /**
   * Logs insertion of the mount Drive snippet.
   *
   * @param source - Where the action was triggered from.
   */
  logMountDriveSnippet: (source: CommandSource) => {
    log({ mount_drive_snippet_event: { source } });
  },
  /**
   * Logs mounting a server.
   *
   * @param source - Where the action was triggered from.
   * @param server - The server involved, if any.
   */
  logMountServer: (source: CommandSource, server?: string) => {
    log({ mount_server_event: { source, server } });
  },
  /**
   * Logs opening Colab in the web browser.
   *
   * @param source - Where the action was triggered from.
   */
  logOpenColabWeb: (source: CommandSource) => {
    log({ open_colab_web_event: { source } });
  },
  /**
   * Logs opening a terminal on a server.
   *
   * @param source - Where the action was triggered from.
   */
  logOpenTerminal: (source: CommandSource) => {
    log({ open_terminal_event: { source } });
  },
  /**
   * Logs pruning of servers.
   *
   * @param servers - The pruned servers.
   */
  logPruneServers: (servers: string[]) => {
    log({ prune_servers_event: { servers } });
  },
  /**
   * Logs removal of a server.
   *
   * @param source - Where the action was triggered from.
   */
  logRemoveServer: (source = CommandSource.COMMAND_SOURCE_UNSPECIFIED) => {
    log({
      remove_server_event: {
        source,
      },
    });
  },
  /**
   * Logs a sign-in attempt.
   *
   * @param flow - The authentication flow used.
   * @param succeeded - Whether the sign-in succeeded.
   */
  logSignIn: (flow: AuthFlow, succeeded: boolean) => {
    log({ sign_in_event: { auth_flow: flow, succeeded } });
  },
  /** Logs a sign-out. */
  logSignOut: () => {
    log({ sign_out_event: {} });
  },
  /**
   * Logs an upgrade-to-Pro request.
   *
   * @param source - Where the action was triggered from.
   */
  logUpgradeToPro: (source: CommandSource) => {
    log({ upgrade_to_pro_event: { source } });
  },
  /**
   * Logs the outcome of a file upload.
   *
   * @param source - Where the action was triggered from.
   * @param outcome - Whether the operation succeeded.
   * @param stats - Aggregate counts for the upload.
   */
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
    experiment_ids: getExperimentIds(),
  });
}

function toTelemetrySubscriptionTier(
  tier: ColabSubscriptionTier,
): SubscriptionTier {
  switch (tier) {
    case ColabSubscriptionTier.NONE:
      return SubscriptionTier.SUBSCRIPTION_TIER_NONE;
    case ColabSubscriptionTier.PRO:
      return SubscriptionTier.SUBSCRIPTION_TIER_PRO;
    case ColabSubscriptionTier.PRO_PLUS:
      return SubscriptionTier.SUBSCRIPTION_TIER_PRO_PLUS;
  }
}
