/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * API types for logging telemetry events to Clearcut.
 */

/** The Colab log event structure. */
// TODO: Convert to proto definition.
// TODO: Record events for MVP CUJs.
export type ColabLogEvent = ColabLogEventBase &
  ColabEvent & {
    /** The timestamp of the event as an ISO string. */
    timestamp: string;
  };

/**
 * Base information common to all ColabLogEvents. These fields are not expected
 * to change for the duration of the session.
 */
export interface ColabLogEventBase {
  /** The application name of the editor. */
  app_name: string;
  /** The version of the extension. */
  extension_version: string;
  /** The version of the Jupyter extension. */
  jupyter_extension_version: string;
  /** The OS platform. */
  platform: string;
  /** A unique identifier for the current VS Code session. */
  session_id: string;
  /** The kinds of UIs that VS Code can run on. */
  ui_kind: 'UI_KIND_DESKTOP' | 'UI_KIND_WEB';
  /** The version of VS Code. */
  vscode_version: string;
}

/** The telemetry event being logged. */
export type ColabEvent =
  | {
      /** An event representing extension activation. */
      activation_event: ColabActivationEvent;
    }
  | {
      /** An event that logs when the user creates a server assignment */
      assign_server_event: ColabAssignServerEvent;
    }
  | {
      /** An event that logs when the user selects the autoconnect option */
      auto_connect_event: ColabAutoConnectEvent;
    }
  | {
      /** An event representing an error. */
      error_event: ColabErrorEvent;
    }
  | {
      /** An event that logs when servers are pruned */
      prune_servers_event: ColabPruneServersEvent;
    }
  | {
      /** An event that logs when the remove server command is triggered */
      remove_server_event: ColabRemoveServerEvent;
    }
  | {
      /** An event representing a sign-in. */
      sign_in_event: ColabSignInEvent;
    }
  | {
      /** An event representing a sign-out. */
      sign_out_event: ColabSignOutEvent;
    }
  | {
      /** An event representing a Colab toolbar click. */
      colab_toolbar_event: ColabToolbarEvent;
    }
  | {
      /** An event representing a click to insert Drive mounting snippet. */
      mount_drive_snippet_event: ColabMountDriveSnippetEvent;
    }
  | {
      /** An event representing a Colab server mounting. */
      mount_server_event: ColabMountServerEvent;
    }
  | {
      /** An event representing a click to open Colab web. */
      open_colab_web_event: OpenColabWebEvent;
    }
  | {
      /** An event representing a click to upgrade to Colab Pro. */
      upgrade_to_pro_event: ColabUpgradeToProEvent;
    };

/** Enum to represent different command sources/triggers */
export enum CommandSource {
  COMMAND_SOURCE_UNSPECIFIED = 0,
  COMMAND_SOURCE_SERVER_PROVIDER = 1,
  COMMAND_SOURCE_COLAB_TOOLBAR = 2,
  COMMAND_SOURCE_COMMAND_PALETTE = 3,
  COMMAND_SOURCE_NOTIFICATION = 4,
}

/** An event representing extension activation. */
type ColabActivationEvent = Record<string, never>;

/** An event representing a server assignment */
type ColabAssignServerEvent = Record<string, never>;

/** An event representing a server auto connection */
type ColabAutoConnectEvent = Record<string, never>;

/** An event representing an error. */
interface ColabErrorEvent {
  /** The name of the error. */
  name: string;
  /** The error message. */
  msg: string;
  /** The stack trace of the error. */
  stack: string;
}

/** An event representing a click to insert Drive mounting snippet. */
interface ColabMountDriveSnippetEvent {
  source: CommandSource;
}

/** An event representing a Colab server mounting. */
interface ColabMountServerEvent {
  source: CommandSource;
  server?: string;
}

/** An event representing server pruning */
interface ColabPruneServersEvent {
  servers: string[];
}

/** An event representing server removal */
interface ColabRemoveServerEvent {
  source: CommandSource;
}

// The authentication flow used for sign in.
export enum AuthFlow {
  AUTH_FLOW_UNSPECIFIED = 0,
  /** The loopback authentication flow. */
  AUTH_FLOW_LOOPBACK = 1,
  /** The proxied redirect authentication flow. */
  AUTH_FLOW_PROXIED_REDIRECT = 2,
}

/** An event representing a sign-in. */
interface ColabSignInEvent {
  /** The authentication flow used for sign-in. */
  auth_flow: AuthFlow;
  /** Whether the sign-in attempt succeeded or failed. */
  succeeded: boolean;
}

/** An event representing a sign-out. */
type ColabSignOutEvent = Record<string, never>;

/** An event representing a Colab toolbar click. */
type ColabToolbarEvent = Record<string, never>;

/** An event representing a click to upgrade to Colab Pro. */
interface ColabUpgradeToProEvent {
  source: CommandSource;
}

/** An event representing a click to open Colab web. */
interface OpenColabWebEvent {
  source: CommandSource;
}

/** The Clearcut log event structure. */
export interface LogEvent {
  /** ColabLogEvent serialized as a JSON string. */
  source_extension_json: string;
}

/** The source identifier for Colab VS Code logs. */
export const LOG_SOURCE = 'COLAB_VSCODE';

/** The Clearcut log request structure. */
export interface LogRequest {
  /** The source identifier for logs. */
  log_source: typeof LOG_SOURCE;
  /** The log events to send. */
  log_event: LogEvent[];
}

/** The Clearcut log response structure. */
export interface LogResponse {
  /**
   * Minimum wait time before the next request in milliseconds. Note that the
   * Clearcut LogResponse proto specifies the type int64, but in JSON, it gets
   * represented as a string.
   */
  next_request_wait_millis: string;
}
