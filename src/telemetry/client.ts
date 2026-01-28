/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fetch, { Request } from 'node-fetch';
import { Disposable } from 'vscode';
import { CONTENT_TYPE_JSON_HEADER } from '../colab/headers';

// The Clearcut endpoint.
const LOGS_ENDPOINT = 'https://play.googleapis.com/log';
// The source identifier for Colab VS Code logs.
const LOG_SOURCE = 'COLAB_VSCODE';
// Maximum number of pending events before flushing. When exceeded, events will
// be dropped from the front of the queue.
const MAX_PENDING_EVENTS = 1000;
// Minimum wait time between flushes in milliseconds.
const MIN_WAIT_BETWEEN_FLUSHES_MS = 10 * 1000;

// The Colab log event structure.
// TODO: Convert to proto definition.
// TODO: Record events for MVP CUJs.
export interface ColabLogEvent {
  extension_version: string;
  jupyter_extension_version: string;
  // A unique identifier for the current VS Code session.
  session_id: string;
  // The timestamp of the event as an ISO string.
  timestamp: string;
  // The kinds of UIs that VS Code can run on.
  ui_kind: 'UI_KIND_DESKTOP' | 'UI_KIND_WEB';
  vscode_version: string;
}

// The Clearcut log event structure.
interface LogEvent {
  // ColabLogEvent serialized as a JSON string.
  source_extension_json: string;
}

// The Clearcut log request structure.
interface LogRequest {
  log_source: typeof LOG_SOURCE;
  log_event: LogEvent[];
}

/**
 * A client for sending logs to Clearcut.
 */
export class ClearcutClient implements Disposable {
  // Queue of events to be flushed to Clearcut.
  private pendingEvents: LogEvent[] = [];

  // The time when the next flush request is allowed.
  private nextFlush = new Date();

  private isDisposed = false;

  dispose() {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    // Flush any remaining events before disposing.
    this.flush(/* force= */ true);
  }

  /** Queues a Colab log event for sending to Clearcut. */
  log(event: ColabLogEvent) {
    if (this.isDisposed) {
      throw new Error(
        'ClearcutClient cannot be used after it has been disposed.',
      );
    }

    const numPendingEvents = this.pendingEvents.length;
    // In theory, we shouldn't exceed MAX_PENDING_EVENTS, but for posterity, we
    // guard against it here.
    if (numPendingEvents >= MAX_PENDING_EVENTS) {
      // Drop oldest events to make room.
      this.pendingEvents.splice(0, numPendingEvents - MAX_PENDING_EVENTS + 1);
    }

    this.pendingEvents.push({ source_extension_json: JSON.stringify(event) });
    this.flush();
  }

  /** Flushes queued events to Clearcut. */
  private flush(force = false) {
    const canFlush = force || new Date() >= this.nextFlush;
    if (this.pendingEvents.length === 0 || !canFlush) {
      return;
    }

    const events = this.pendingEvents;
    this.pendingEvents = [];
    this.nextFlush = new Date(Date.now() + MIN_WAIT_BETWEEN_FLUSHES_MS);
    void this.issueRequest(events);
  }

  /** Sends a log request to Clearcut. */
  private async issueRequest(events: LogEvent[]) {
    const logRequest: LogRequest = {
      log_source: LOG_SOURCE,
      log_event: events,
    };
    const request = new Request(LOGS_ENDPOINT, {
      method: 'POST',
      body: JSON.stringify(logRequest),
      headers: {
        [CONTENT_TYPE_JSON_HEADER.key]: CONTENT_TYPE_JSON_HEADER.value,
      },
    });
    const response = await fetch(request);
    // TODO: Rate-limit based on next_request_wait_millis in response.
    // TODO: Retry on 401 and 5xx.
    if (!response.ok) {
      throw new Error(
        `Failed to issue request ${request.method} ${request.url}: ${response.statusText}`,
      );
    }
  }
}

export const TEST_ONLY = {
  LOGS_ENDPOINT,
  LOG_SOURCE,
  MAX_PENDING_EVENTS,
  MIN_WAIT_BETWEEN_FLUSHES_MS,
};
