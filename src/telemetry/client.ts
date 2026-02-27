/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fetch, { Request } from 'node-fetch';
import vscode from 'vscode';
import { Disposable } from 'vscode';
import { ExperimentFlag } from '../colab/api';
import { getFlag } from '../colab/experiment-state';
import { CONTENT_TYPE_JSON_HEADER } from '../colab/headers';
import { log } from '../common/logging';
import {
  ColabLogEvent,
  LogEvent,
  LogRequest,
  LogResponse,
  LOG_SOURCE,
} from './api';

/** The Clearcut endpoint. */
export const LOG_ENDPOINT = 'https://play.googleapis.com/log?format=json_proto';
/**
 * Maximum number of pending events before flushing. When exceeded, events will
 * be dropped from the front of the queue.
 */
const DEFAULT_MAX_PENDING_EVENTS = 1000;
/** Minimum wait time between flushes in milliseconds. */
const DEFAULT_MIN_FLUSH_WAIT_MS = 10 * 1000;

/** The configuration for the Clearcut client. */
export interface ClearcutConfig {
  /**
   * Maximum number of pending events before flushing. When exceeded, events
   * will be dropped from the front of the queue.
   */
  readonly maxPendingEvents?: number;
  /** Minimum wait time between flushes in milliseconds. */
  readonly minFlushWaitMs?: number;
}

const DEFAULT_CONFIG: ClearcutConfig = {
  maxPendingEvents: DEFAULT_MAX_PENDING_EVENTS,
  minFlushWaitMs: DEFAULT_MIN_FLUSH_WAIT_MS,
};

/**
 * A client for sending logs to Clearcut.
 */
export class ClearcutClient implements Disposable {
  private readonly maxPendingEvents: number;
  private readonly minFlushWaitMs: number;

  private isDisposed = false;
  /** Whether a flush request is currently in progress. */
  private isDoingFlush = false;
  /** The time when the next flush request is allowed. */
  private nextFlush = new Date();
  /** Queue of events to be flushed to Clearcut. */
  private pendingEvents: LogEvent[] = [];

  constructor(
    private readonly vs: typeof vscode,
    config: ClearcutConfig = DEFAULT_CONFIG,
  ) {
    this.maxPendingEvents =
      config.maxPendingEvents ?? DEFAULT_MAX_PENDING_EVENTS;
    this.minFlushWaitMs = config.minFlushWaitMs ?? DEFAULT_MIN_FLUSH_WAIT_MS;
  }

  dispose() {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    // Flush any remaining events before disposing.
    this.flush(/* force= */ true).catch((err: unknown) => {
      log.error('Failed to flush telemetry events during disposal', err);
    });
  }

  /** Queues a Colab log event for sending to Clearcut. */
  log(event: ColabLogEvent) {
    if (this.isDisposed) {
      throw new Error(
        'ClearcutClient cannot be used after it has been disposed.',
      );
    }

    const numPendingEvents = this.pendingEvents.length;
    // In theory, we shouldn't exceed maxPendingEvents, but for posterity, we
    // guard against it here.
    if (numPendingEvents >= this.maxPendingEvents) {
      // Drop oldest events to make room.
      this.pendingEvents.splice(
        0,
        numPendingEvents - this.maxPendingEvents + 1,
      );
    }

    this.pendingEvents.push({ source_extension_json: JSON.stringify(event) });
    this.flush().catch((err: unknown) => {
      log.error('Failed to flush telemetry events', err);
    });
  }

  /**
   * Flushes queued events to Clearcut.
   *
   * @param force - Flushes to Clearcut regardless of whether a flush is in
   *   progress or if the flush interval's been met. Note that the VS Code
   *   telemetry setting must still be enabled along with Colab's telemetry
   *   experiment flag.
   */
  private async flush(force = false) {
    // Must be enabled by Colab and the user before flushing to Clearcut.
    const isTelemetryEnabled =
      getFlag(ExperimentFlag.EnableTelemetry) && this.vs.env.isTelemetryEnabled;
    if (!isTelemetryEnabled || this.pendingEvents.length === 0) {
      return;
    }

    const canFlush =
      force || (!this.isDoingFlush && new Date() >= this.nextFlush);
    if (!canFlush) {
      return;
    }

    const events = this.pendingEvents;
    this.pendingEvents = [];
    this.isDoingFlush = true;

    try {
      const waitBetweenFlushesMs = await this.issueRequest(events);
      this.nextFlush = new Date(Date.now() + waitBetweenFlushesMs);
    } catch (err) {
      this.nextFlush = new Date(Date.now() + this.minFlushWaitMs);
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
    const request = new Request(LOG_ENDPOINT, {
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
        return this.minFlushWaitMs;
      }
      throw new Error(
        `Failed to issue request ${request.method} ${request.url}: ${response.statusText}`,
      );
    }

    let next_flush_millis = this.minFlushWaitMs;
    try {
      const { next_request_wait_millis } =
        (await response.json()) as LogResponse;
      const wait = Number(next_request_wait_millis);
      if (Number.isInteger(wait) && wait > this.minFlushWaitMs) {
        next_flush_millis = wait;
      }
    } catch (err: unknown) {
      log.error('Failed to parse Clearcut response:', err);
    }
    return next_flush_millis;
  }

  /** Requeues events by placing them at the front of the queue. */
  private requeue(events: LogEvent[]) {
    const capacity = this.maxPendingEvents - this.pendingEvents.length;

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
