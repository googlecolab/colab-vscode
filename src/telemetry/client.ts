/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fetch, { Request } from 'node-fetch';
import { Disposable } from 'vscode';
import { CONTENT_TYPE_JSON_HEADER } from '../colab/headers';
import { log } from '../common/logging';
import {
  ColabLogEvent,
  LogEvent,
  LogRequest,
  LogResponse,
  LOG_SOURCE,
} from './api';

// The Clearcut endpoint.
const LOGS_ENDPOINT = 'https://play.googleapis.com/log?format=json_proto';
// Maximum number of pending events before flushing. When exceeded, events will
// be dropped from the front of the queue.
const MAX_PENDING_EVENTS = 1000;
// Minimum wait time between flushes in milliseconds.
const MIN_WAIT_BETWEEN_FLUSHES_MS = 10 * 1000;

/**
 * A client for sending logs to Clearcut.
 */
export class ClearcutClient implements Disposable {
  private isDisposed = false;
  // Whether a flush request is currently in progress.
  private isDoingFlush = false;
  // The time when the next flush request is allowed.
  private nextFlush = new Date();
  // Queue of events to be flushed to Clearcut.
  private pendingEvents: LogEvent[] = [];

  dispose() {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    // Flush any remaining events before disposing.
    void this.flush(/* force= */ true);
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
    void this.flush();
  }

  /** Flushes queued events to Clearcut. */
  private async flush(force = false) {
    const canFlush =
      force || (!this.isDoingFlush && new Date() >= this.nextFlush);
    if (this.pendingEvents.length === 0 || !canFlush) {
      return;
    }

    const events = this.pendingEvents;
    this.pendingEvents = [];
    this.isDoingFlush = true;

    try {
      const waitBetweenFlushesMs = await this.issueRequest(events);
      this.nextFlush = new Date(Date.now() + waitBetweenFlushesMs);
    } catch (err) {
      this.nextFlush = new Date(Date.now() + MIN_WAIT_BETWEEN_FLUSHES_MS);
      throw err;
    } finally {
      this.isDoingFlush = false;
    }
  }

  /**
   * Sends a log request to Clearcut.
   *
   * @param events - The log events to send.
   * @returns - The minimum wait time before the next request in milliseconds.
   */
  private async issueRequest(events: LogEvent[]): Promise<number> {
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
    // TODO: handle 401 once token is included in request
    if (!response.ok) {
      if (response.status >= 500) {
        this.requeue(events); // Retry on next flush
        return MIN_WAIT_BETWEEN_FLUSHES_MS;
      }
      throw new Error(
        `Failed to issue request ${request.method} ${request.url}: ${response.statusText}`,
      );
    }

    let next_flush_millis = MIN_WAIT_BETWEEN_FLUSHES_MS;
    try {
      const { next_request_wait_millis: wait } =
        (await response.json()) as LogResponse;
      if (Number.isInteger(wait) && wait > MIN_WAIT_BETWEEN_FLUSHES_MS) {
        next_flush_millis = wait;
      }
    } catch (err: unknown) {
      log.error('Failed to parse Clearcut response:', err);
    }
    return next_flush_millis;
  }

  /** Requeues events by placing them at the front of the queue. */
  private requeue(events: LogEvent[]) {
    const capacity = MAX_PENDING_EVENTS - this.pendingEvents.length;

    // Queue is full, which means the oldest events should be dropped.
    if (capacity === 0) {
      return;
    }
    if (capacity >= events.length) {
      this.pendingEvents.unshift(...events);
      return;
    }
    // Only keep the most recent events within the queue's capacity.
    this.pendingEvents.unshift(...events.slice(-capacity));
  }
}

export const TEST_ONLY = {
  LOGS_ENDPOINT,
  MAX_PENDING_EVENTS,
  MIN_WAIT_BETWEEN_FLUSHES_MS,
};
