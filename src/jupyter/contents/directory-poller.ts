/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Disposable, FileChangeEvent, Uri } from 'vscode';
import {
  calculateBackoffIntervals,
  countsAsNetworkFailure,
} from '../../common/backoff';
import {
  OverrunPolicy,
  SequentialTaskRunner,
  StartMode,
} from '../../common/task-runner';
import {
  DirectoryContents,
  isDirectoryContents,
  toFileType,
} from '../client/converters';
import {
  Contents,
  ContentsApi,
  ContentsGetTypeEnum,
  ResponseError,
} from '../client/generated';

const POLL_INTERVAL_MS = 1000 * 5; // 5 seconds.
const TASK_TIMEOUT_MS = 1000 * 30; // 30 seconds.
/**
 * Ceiling on the consecutive intervals skipped while backing off, so a failing
 * directory is retried at most every 5 minutes.
 */
const MAX_BACKOFF_INTERVALS = 60;

interface SnapshotEntry {
  readonly uri: Uri;
  readonly type: vscode.FileType;
  readonly lastModified?: string;
  readonly size?: number;
}

/** Direct children of the watched directory, keyed by URI string. */
type Snapshot = ReadonlyMap<string, SnapshotEntry>;

/** Configuration for a {@link DirectoryPoller}. */
export interface DirectoryPollerOptions {
  /** VS Code API instance. */
  readonly vs: typeof vscode;
  /** Directory URI this poller watches. */
  readonly uri: Uri;
  /** Returns an existing contents client, or undefined when none is live. */
  readonly getClient: () => Promise<ContentsApi | undefined>;
  /** Receives file change events emitted by this poller. */
  readonly onDidChangeFile: (events: FileChangeEvent[]) => void;
  /** Called once, after the poller disposed itself because the directory is gone. */
  readonly onDidTerminate: () => void;
}

/**
 * Polls the direct children of one Colab directory and emits created, changed
 * and deleted events by diffing successive listings.
 *
 * Sharing and ref-counting belong to the owner. When the directory is deleted
 * or replaced by a file, the poller disposes itself and calls
 * {@link DirectoryPollerOptions.onDidTerminate}. Every public method is safe to
 * call after disposal.
 */
export class DirectoryPoller implements Disposable {
  private readonly runner: SequentialTaskRunner;
  private snapshot?: Snapshot;
  private consecutiveFailures = 0;
  private intervalsToSkip = 0;
  private isSuspended = false;
  private isDisposed = false;

  /**
   * Initializes and immediately starts polling.
   *
   * @param options - Poller dependencies and callbacks.
   */
  constructor(private readonly options: DirectoryPollerOptions) {
    this.runner = new SequentialTaskRunner(
      {
        intervalTimeoutMs: POLL_INTERVAL_MS,
        taskTimeoutMs: TASK_TIMEOUT_MS,
        // Nothing to clean up, abandon immediately.
        abandonGraceMs: 0,
      },
      {
        name: `${DirectoryPoller.name}:${options.uri.toString()}`,
        run: this.poll.bind(this),
      },
      // A slow listing is left to finish (bounded by TASK_TIMEOUT_MS) instead
      // of being abandoned and re-sent every interval.
      OverrunPolicy.AllowToComplete,
    );
    this.runner.start(StartMode.Immediately);
  }

  /** Stops polling, keeping the last listing to diff against on resume. */
  suspend(): void {
    if (this.isDisposed || this.isSuspended) {
      return;
    }
    this.isSuspended = true;
    this.runner.stop();
  }

  /**
   * Resumes polling with an immediate poll, skipping any pending backoff.
   *
   * The failure count is kept, so a directory that still fails backs off
   * further.
   */
  resume(): void {
    if (this.isDisposed || !this.isSuspended) {
      return;
    }
    this.isSuspended = false;
    this.intervalsToSkip = 0;
    this.runner.start(StartMode.Immediately);
  }

  /** Stops polling and aborts any in-flight poll. */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    this.runner.dispose();
  }

  private async poll(signal: AbortSignal): Promise<void> {
    if (this.intervalsToSkip > 0) {
      this.intervalsToSkip--;
      return;
    }
    const client = await this.options.getClient();
    // No live client, or suspended or disposed during the lookup.
    if (!client || signal.aborted) {
      return;
    }
    await this.refresh(client, signal);
  }

  /**
   * Lists the directory and emits the changes since the previous listing.
   *
   * @param client - The existing contents client to list with.
   * @param signal - Aborted when the poll is suspended, disposed or times out.
   */
  private async refresh(
    client: ContentsApi,
    signal: AbortSignal,
  ): Promise<void> {
    let contents: Contents;
    try {
      contents = await client.get(
        { path: this.options.uri.path, type: ContentsGetTypeEnum.Directory },
        { signal },
      );
    } catch (err: unknown) {
      // 404: deleted. 400: Jupyter's "bad type", as the path is now a file.
      if (
        err instanceof ResponseError &&
        (err.response.status === 404 || err.response.status === 400)
      ) {
        this.terminate();
        return;
      }
      if (countsAsNetworkFailure(signal)) {
        this.consecutiveFailures++;
        this.intervalsToSkip = calculateBackoffIntervals(
          this.consecutiveFailures,
          MAX_BACKOFF_INTERVALS,
        );
      }
      throw err;
    }
    // Suspended or disposed while the listing was in flight.
    if (signal.aborted) {
      return;
    }
    this.consecutiveFailures = 0;
    if (!isDirectoryContents(contents)) {
      this.terminate();
      return;
    }

    const previous = this.snapshot;
    this.snapshot = this.toSnapshot(contents);
    if (!previous) {
      return;
    }
    const events = this.diff(previous, this.snapshot);
    if (events.length > 0) {
      this.options.onDidChangeFile(events);
    }
  }

  private toSnapshot(contents: DirectoryContents): Snapshot {
    const snapshot = new Map<string, SnapshotEntry>();
    for (const child of contents.content) {
      const uri = this.options.vs.Uri.joinPath(this.options.uri, child.name);
      snapshot.set(uri.toString(), {
        uri,
        type: toFileType(this.options.vs, child.type),
        lastModified: child.lastModified,
        size: child.size,
      });
    }
    return snapshot;
  }

  private diff(previous: Snapshot, current: Snapshot): FileChangeEvent[] {
    const { Created, Changed, Deleted } = this.options.vs.FileChangeType;
    const events: FileChangeEvent[] = [];
    for (const [key, before] of previous) {
      const after = current.get(key);
      if (!after) {
        events.push({ type: Deleted, uri: before.uri });
      } else if (after.type !== before.type) {
        events.push({ type: Deleted, uri: before.uri });
        events.push({ type: Created, uri: after.uri });
      } else if (
        after.lastModified !== before.lastModified ||
        after.size !== before.size
      ) {
        events.push({ type: Changed, uri: after.uri });
      }
    }
    for (const [key, after] of current) {
      if (!previous.has(key)) {
        events.push({ type: Created, uri: after.uri });
      }
    }
    return events;
  }

  private terminate(): void {
    // Only report a directory we have listed. VS Code also watches open files,
    // and a Deleted event for one would mark its editor as deleted.
    if (this.snapshot) {
      this.options.onDidChangeFile([
        { type: this.options.vs.FileChangeType.Deleted, uri: this.options.uri },
      ]);
    }
    this.dispose();
    this.options.onDidTerminate();
  }
}

export const TEST_ONLY = {
  POLL_INTERVAL_MS,
  TASK_TIMEOUT_MS,
  MAX_BACKOFF_INTERVALS,
};
