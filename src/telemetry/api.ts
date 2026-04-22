/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthType } from '../colab/api';

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
      activation_event: ActivationEvent;
    }
  | {
      /** An event that logs when the user creates a server assignment */
      assign_server_event: AssignServerEvent;
    }
  | {
      /** An event that logs when the user selects the autoconnect option */
      auto_connect_event: AutoConnectEvent;
    }
  | {
      /** An event representing a Colab toolbar click. */
      colab_toolbar_event: ColabToolbarEvent;
    }
  | {
      /** An event representing a content browser file or folder operation. */
      content_browser_file_operation_event: ContentBrowserFileOperationEvent;
    }
  | {
      /** An event representing an error. */
      error_event: ErrorEvent;
    }
  | {
      /** An event representing handling of an ephemeral auth. */
      handle_ephemeral_auth_event: HandleEphemeralAuthEvent;
    }
  | {
      /** An event representing a notebook import. */
      import_notebook_event: ImportNotebookEvent;
    }
  | {
      /** An event representing a click to insert Drive mounting snippet. */
      mount_drive_snippet_event: MountDriveSnippetEvent;
    }
  | {
      /** An event representing a Colab server mounting. */
      mount_server_event: MountServerEvent;
    }
  | {
      /** An event representing a click to open Colab web. */
      open_colab_web_event: OpenColabWebEvent;
    }
  | {
      /** An event representing opening a terminal connected to a Colab server. */
      open_terminal_event: OpenTerminalEvent;
    }
  | {
      /** An event that logs when servers are pruned */
      prune_servers_event: PruneServersEvent;
    }
  | {
      /** An event that logs when the remove server command is triggered */
      remove_server_event: RemoveServerEvent;
    }
  | {
      /** An event representing a sign-in. */
      sign_in_event: SignInEvent;
    }
  | {
      /** An event representing a sign-out. */
      sign_out_event: SignOutEvent;
    }
  | {
      /** An event representing a click to upgrade to Colab Pro. */
      upgrade_to_pro_event: UpgradeToProEvent;
    }
  | {
      /** An event representing an upload of files or folders to a server. */
      upload_event: UploadEvent;
    };

/** Enum to represent different command sources/triggers */
export enum CommandSource {
  COMMAND_SOURCE_UNSPECIFIED = 0,
  COMMAND_SOURCE_SERVER_PROVIDER = 1,
  COMMAND_SOURCE_COLAB_TOOLBAR = 2,
  COMMAND_SOURCE_COMMAND_PALETTE = 3,
  COMMAND_SOURCE_NOTIFICATION = 4,
  COMMAND_SOURCE_ON_URI = 5,
  COMMAND_SOURCE_EXPLORER_CONTEXT = 6,
  COMMAND_SOURCE_TREE_VIEW_INLINE = 7,
}

/** Enum to represent different notebook sources */
export enum NotebookSource {
  NOTEBOOK_SOURCE_UNSPECIFIED = 0,
  NOTEBOOK_SOURCE_DRIVE = 1,
}

/**
 * The outcome of a user-initiated operation. Shared across events that have a
 * success/failure/cancel lifecycle.
 */
export enum Outcome {
  OUTCOME_UNSPECIFIED = 0,
  /** The operation completed successfully. */
  OUTCOME_SUCCEEDED = 1,
  /**
   * The user cancelled the operation before any work was attempted (e.g.,
   * dismissed a prompt) or the operation was a no-op.
   */
  OUTCOME_CANCELLED = 2,
  /** The operation was attempted but failed. */
  OUTCOME_FAILED = 3,
  /**
   * The operation was attempted and partially succeeded; some work units
   * succeeded and some failed. Applicable to events that operate on a batch
   * of items (e.g., uploads).
   */
  OUTCOME_PARTIAL_SUCCESS = 4,
}

/** The kind of file operation performed in the content browser tree view. */
export enum ContentBrowserOperation {
  OPERATION_UNSPECIFIED = 0,
  OPERATION_NEW_FILE = 1,
  OPERATION_NEW_FOLDER = 2,
  OPERATION_RENAME = 3,
  OPERATION_DELETE = 4,
}

/** The kind of target a content browser file operation was performed on. */
export enum ContentBrowserTarget {
  TARGET_UNSPECIFIED = 0,
  TARGET_FILE = 1,
  TARGET_DIRECTORY = 2,
}

// The authentication flow used for sign in.
export enum AuthFlow {
  AUTH_FLOW_UNSPECIFIED = 0,
  /** The loopback authentication flow. */
  AUTH_FLOW_LOOPBACK = 1,
  /** The proxied redirect authentication flow. */
  AUTH_FLOW_PROXIED_REDIRECT = 2,
}

/** An event representing extension activation. */
type ActivationEvent = Record<string, never>;

/** An event representing a server assignment */
type AssignServerEvent = Record<string, never>;

/** An event representing a server auto connection */
type AutoConnectEvent = Record<string, never>;

/** An event representing a Colab toolbar click. */
type ColabToolbarEvent = Record<string, never>;

/** An event representing a content browser file or folder operation. */
interface ContentBrowserFileOperationEvent {
  /** The kind of file operation that was attempted. */
  operation: ContentBrowserOperation;
  /**
   * The outcome of the operation. `OUTCOME_CANCELLED` covers both the user
   * dismissing the input box and declining the delete confirmation.
   */
  outcome: Outcome;
  /**
   * The kind of target the operation was performed on. For
   * `OPERATION_NEW_FOLDER` this is always `TARGET_DIRECTORY`. For
   * `OPERATION_NEW_FILE` it reflects whether the user typed a trailing slash
   * to create a folder instead. For `OPERATION_RENAME` and
   * `OPERATION_DELETE` it reflects the actual target type.
   */
  target: ContentBrowserTarget;
}

/** An event representing an error. */
interface ErrorEvent {
  /** The name of the error. */
  name: string;
  /** The error message. */
  msg: string;
  /** The stack trace of the error. */
  stack: string;
}

/** An event representing handling of an ephemeral auth. */
interface HandleEphemeralAuthEvent {
  auth_type: AuthType;
}

/** An event representing a notebook import. */
interface ImportNotebookEvent {
  source: CommandSource;
  notebook_source: NotebookSource;
}

/** An event representing a click to insert Drive mounting snippet. */
interface MountDriveSnippetEvent {
  source: CommandSource;
}

/** An event representing a Colab server mounting. */
interface MountServerEvent {
  source: CommandSource;
  server?: string;
}

/** An event representing a click to open Colab web. */
interface OpenColabWebEvent {
  source: CommandSource;
}

/** An event representing opening a terminal connected to a Colab server. */
interface OpenTerminalEvent {
  source: CommandSource;
}

/** An event representing server pruning */
interface PruneServersEvent {
  servers: string[];
}

/** An event representing server removal */
interface RemoveServerEvent {
  source: CommandSource;
}

/** An event representing a sign-in. */
interface SignInEvent {
  /** The authentication flow used for sign-in. */
  auth_flow: AuthFlow;
  /** Whether the sign-in attempt succeeded or failed. */
  succeeded: boolean;
}

/** An event representing a sign-out. */
type SignOutEvent = Record<string, never>;

/** An event representing a click to upgrade to Colab Pro. */
interface UpgradeToProEvent {
  source: CommandSource;
}

/** An event representing an upload of files or folders to a Colab server. */
interface UploadEvent {
  /** The source of the upload command. */
  source: CommandSource;
  /**
   * The outcome of the upload. `OUTCOME_CANCELLED` covers both the user
   * dismissing the server picker and there being no servers assigned.
   * `OUTCOME_PARTIAL_SUCCESS` is used when at least one file uploaded
   * successfully and at least one other file or directory failed.
   */
  outcome: Outcome;
  /** The number of files that were successfully uploaded. */
  success_count: number;
  /** The number of files or directories that failed to upload. */
  fail_count: number;
  /** The total number of files (excluding directories) that were attempted. */
  file_count: number;
  /** The total number of directories that were attempted. */
  directory_count: number;
  /** The total size, in bytes, of all files that were successfully uploaded. */
  uploaded_bytes: number;
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
