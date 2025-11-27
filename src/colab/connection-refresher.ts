/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { UUID } from "crypto";
import { Disposable } from "vscode";
import { log } from "../common/logging";
import { AsyncToggle } from "../common/toggleable";
import {
  AssignmentChangeEvent,
  AssignmentManager,
} from "../jupyter/assignments";
import { ColabAssignedServer } from "../jupyter/servers";
import { NotFoundError } from "./client";

/* The buffer we give to refresh the token, before it actually expires. */
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes.

/**
 * The buffer we give to schedule a token refresh retry, if the previous attempt
 * failed.
 *
 * Given how limited assigned servers are and how spread out these retries would
 * be, a backoff is overkill and this static buffer is sufficient.
 */
const RETRY_BUFFER_MS = 30 * 1000; // 30 seconds.

/**
 * Controls toggling the refreshing of connections.
 */
export class ConnectionRefreshController
  extends AsyncToggle
  implements Disposable
{
  private refresher?: ConnectionRefresher;

  constructor(private readonly assignments: AssignmentManager) {
    super();
  }

  dispose() {
    // Called not only to reduce duplicate logic, but more importantly to avoid
    // a memory leak if `dispose()` is called while `turnOn` is in progress. In
    // that case, the `refresher` would not yet be assigned, `dispose` would do
    // nothing and the `turnOn` operation would complete - leaving an undisposed
    // refresher.
    this.off();
  }

  protected override async turnOn(signal: AbortSignal): Promise<void> {
    const refresher = await ConnectionRefresher.initialize(
      this.assignments,
      signal,
    );

    // If signalled to abort during initialization, dispose the newly created
    // refresher.
    if (signal.aborted) {
      refresher.dispose();
      return;
    }

    this.refresher?.dispose();
    this.refresher = refresher;
  }

  protected override turnOff(_signal: AbortSignal): Promise<void> {
    this.refresher?.dispose();
    this.refresher = undefined;
    return Promise.resolve();
  }
}

/**
 * Watches the connection information of Colab servers and refreshes the token
 * as needed.
 */
export class ConnectionRefresher implements Disposable {
  private readonly refreshes = new Map<
    UUID,
    {
      timeout: NodeJS.Timeout;
      expiry: Date;
    }
  >();
  private readonly abortController = new AbortController();

  private constructor(
    private readonly assignments: AssignmentManager,
    initialServers: ColabAssignedServer[],
  ) {
    for (const s of initialServers) {
      this.scheduleRefresh(s);
    }
    this.assignments.onDidAssignmentsChange((e) => {
      if (this.abortController.signal.aborted) {
        return;
      }
      this.handleAssignmentChange(e);
    });
  }

  dispose() {
    this.abortController.abort(
      new Error(`${this.constructor.name} is being disposed`),
    );
    for (const { timeout } of this.refreshes.values()) {
      clearTimeout(timeout);
    }
    this.refreshes.clear();
  }

  /**
   * Initializes a new {@link ConnectionRefresher}.
   *
   * @param assignments - The {@link AssignmentManager} to query and refresh
   * assignments with.
   * @param cancel - The signal used to abort initialization.
   */
  static async initialize(
    assignments: AssignmentManager,
    cancel?: AbortSignal,
  ): Promise<ConnectionRefresher> {
    const servers = await assignments.getAssignedServers(cancel);
    const toRefresh = servers.filter(shouldRefresh);
    const refreshing: Promise<ColabAssignedServer>[] = [];
    for (const s of toRefresh) {
      refreshing.push(assignments.refreshConnection(s.id, cancel));
    }
    await Promise.all(refreshing);

    if (cancel?.aborted) {
      throw new Error("Connection refresher initialization aborted");
    }

    const refreshedServers = await assignments.getAssignedServers(cancel);
    return new ConnectionRefresher(assignments, refreshedServers);
  }

  private scheduleRefresh(
    s: ColabAssignedServer,
    delayMs: number = bufferedRefreshDelay(s),
  ): void {
    const timeout = setTimeout(() => {
      if (this.abortController.signal.aborted) {
        return;
      }
      void this.refresh(s);
    }, delayMs);
    log.trace(
      `Scheduled connection refresh for "${s.label}" in ${delayMs.toString()}ms`,
    );
    this.refreshes.set(s.id, {
      timeout,
      expiry: s.connectionInformation.tokenExpiry,
    });
  }

  /**
   * It's in handling the assignment change where we pickup servers that have
   * had their token refreshed. This enables scheduling of the next refresh.
   */
  private handleAssignmentChange(e: AssignmentChangeEvent) {
    // New servers.
    for (const s of e.added) {
      this.scheduleRefresh(s);
    }

    // Updated servers.
    for (const s of e.changed) {
      const r = this.refreshes.get(s.id);
      // This would be a programming error.
      if (!r) {
        log.error("Connection watcher received change for an untracked server");
        return;
      }
      // If the change wasn't to the token expiry, ignore it.
      if (r.expiry === s.connectionInformation.tokenExpiry) {
        return;
      }
      this.clear(s.id);
      this.scheduleRefresh(s);
    }

    // Removed servers.
    for (const { server: s } of e.removed) {
      this.clear(s.id);
    }
  }

  private async refresh(s: ColabAssignedServer): Promise<void> {
    if (!this.refreshes.has(s.id)) {
      log.trace(`Skipping refresh for untracked server "${s.label}"`);
      return;
    }
    try {
      log.trace(`Refreshing the connection for "${s.label}"`);
      await this.assignments.refreshConnection(
        s.id,
        this.abortController.signal,
      );
      log.trace(`Connection refreshed for "${s.label}"`);
    } catch (err: unknown) {
      if (this.abortController.signal.aborted) {
        log.trace(`Connection refresh for "${s.label}" aborted.`);
        return;
      }
      if (err instanceof NotFoundError) {
        log.trace(
          `No longer attempting to refresh connection for server that no longer exists: "${s.label}"`,
          err,
        );
        this.clear(s.id);
        return;
      }
      this.maybeRetry(s, err);
    }
  }

  private maybeRetry(s: ColabAssignedServer, pastIssue: unknown): void {
    if (this.abortController.signal.aborted) {
      return;
    }
    const canRetry =
      s.connectionInformation.tokenExpiry.getTime() - Date.now() >
      RETRY_BUFFER_MS;
    const issueMsgPrefix = `Issue refreshing server connection for "${s.label}"`;
    if (!canRetry) {
      log.error(`${issueMsgPrefix}, not retrying`, pastIssue);
      this.clear(s.id);
      return;
    }
    log.warn(
      `${issueMsgPrefix}, scheduling retry in ${RETRY_BUFFER_MS.toString()}ms`,
      pastIssue,
    );
    this.scheduleRefresh(s, RETRY_BUFFER_MS);
    return;
  }

  private clear(serverId: UUID): void {
    const r = this.refreshes.get(serverId);
    if (r) {
      clearTimeout(r.timeout);
      this.refreshes.delete(serverId);
    }
  }
}

function bufferedRefreshDelay(s: ColabAssignedServer) {
  return Math.max(
    s.connectionInformation.tokenExpiry.getTime() -
      Date.now() -
      REFRESH_BUFFER_MS,
    100,
  );
}

function shouldRefresh(s: ColabAssignedServer): boolean {
  const tokenExpiryMs = s.connectionInformation.tokenExpiry.getTime();
  return tokenExpiryMs <= Date.now() + REFRESH_BUFFER_MS;
}
