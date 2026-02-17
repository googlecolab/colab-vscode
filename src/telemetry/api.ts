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
    // The timestamp of the event as an ISO string.
    timestamp: string;
  };

/**
 * Base information common to all ColabLogEvents. These fields are not expected
 * to change for the duration of the session.
 */
export interface ColabLogEventBase {
  // The application name of the editor.
  app_name: string;
  extension_version: string;
  jupyter_extension_version: string;
  // The OS platform.
  platform: string;
  // A unique identifier for the current VS Code session.
  session_id: string;
  // The kinds of UIs that VS Code can run on.
  ui_kind: 'UI_KIND_DESKTOP' | 'UI_KIND_WEB';
  vscode_version: string;
}

/** The telemetry event being logged. */
export type ColabEvent =
  | { activation_event: ColabActivationEvent }
  | { error_event: ColabErrorEvent };

type ColabActivationEvent = Record<string, never>;

interface ColabErrorEvent {
  // The name of the error.
  name: string;
  // The error message.
  msg: string;
  // The stack trace of the error.
  stack: string;
}

/** The Clearcut log event structure. */
export interface LogEvent {
  // ColabLogEvent serialized as a JSON string.
  source_extension_json: string;
}

/** The source identifier for Colab VS Code logs. */
export const LOG_SOURCE = 'COLAB_VSCODE';

/** The Clearcut log request structure. */
export interface LogRequest {
  log_source: typeof LOG_SOURCE;
  log_event: LogEvent[];
}

/** The Clearcut log response structure. */
export interface LogResponse {
  // Minimum wait time before the next request in milliseconds. Note that the
  // Clearcut LogResponse proto specifies the type int64 but its JSPB type is
  // string.
  next_request_wait_millis: string;
}
