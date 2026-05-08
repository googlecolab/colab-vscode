/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Disposable, FileChangeEvent, Uri } from 'vscode';
import { log } from '../../common/logging';
import {
  OverrunPolicy,
  SequentialTaskRunner,
  StartMode,
} from '../../common/task-runner';
import { isDirectoryContents, toFileType } from '../client/converters';
import {
  Contents,
  ContentsApi,
  ContentsGetTypeEnum,
  ResponseError,
} from '../client/generated';

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_MAX_BACKOFF_MS = 5 * 60 * 1000;
const DEFAULT_TASK_TIMEOUT_MS = 30000;

interface SnapshotEntry {
  readonly uri: Uri;
  readonly type: vscode.FileType;
  readonly mtime: number;
  readonly size: number;
}

type DirectorySnapshot = ReadonlyMap<string, SnapshotEntry>;

/** Configuration for a {@link DirectoryPoller}. */
export interface DirectoryPollerOptions {
  /** VS Code API instance. */
  readonly vs: typeof vscode;
  /** Directory URI this poller watches. */
  readonly uri: Uri;
  /** Returns an existing contents client, or undefined when none is live. */
  readonly getClient: () => Promise<ContentsApi | undefined>;
  /** Receives file change events emitted by this poller. */
  readonly onDidChangeFile: (events: readonly FileChangeEvent[]) => void;
  /** Poll interval in milliseconds. */
  readonly intervalMs?: number;
  /** Maximum failed-poll backoff in milliseconds. */
  readonly maxBackoffMs?: number;
  /** Per-poll timeout in milliseconds. */
  readonly taskTimeoutMs?: number;
}

/**
 * Polls one Colab contents directory and emits file events for direct children.
 *
 * The poller deliberately has no knowledge of recursive watches or connection
 * creation. Higher-level orchestration decides which exact directories deserve
 * polling and provides an existing client when one is available.
 */
export class DirectoryPoller implements Disposable {
  private readonly runner: SequentialTaskRunner;
  private readonly intervalMs: number;
  private readonly maxBackoffMs: number;
  private refCountValue = 0;
  private isDisposed = false;
  private isStarted = false;
  private isSuspended = false;
  private currentBackoffMs: number;
  private nextPollTimeMs = 0;
  private snapshot?: DirectorySnapshot;

  /**
   * Initializes a new instance.
   *
   * @param options - Poller dependencies and timing configuration.
   */
  constructor(private readonly options: DirectoryPollerOptions) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.currentBackoffMs = this.intervalMs;
    this.runner = new SequentialTaskRunner(
      {
        intervalTimeoutMs: this.intervalMs,
        taskTimeoutMs: options.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS,
        abandonGraceMs: 0,
      },
      {
        name: `${DirectoryPoller.name}:${options.uri.toString()}`,
        run: this.poll.bind(this),
      },
      OverrunPolicy.AbandonAndRun,
    );
  }

  /**
   * Current number of active watch registrations.
   *
   * @returns The number of active references.
   */
  get refCount(): number {
    return this.refCountValue;
  }

  /**
   * Adds one active watch registration.
   *
   * @returns The updated reference count.
   */
  addRef(): number {
    this.guardDisposed();
    this.refCountValue += 1;
    return this.refCountValue;
  }

  /**
   * Releases one active watch registration.
   *
   * @returns The updated reference count.
   */
  release(): number {
    this.guardDisposed();
    if (this.refCountValue === 0) {
      return 0;
    }
    this.refCountValue -= 1;
    if (this.refCountValue === 0) {
      this.runner.stop();
      this.isStarted = false;
      this.isSuspended = false;
      this.snapshot = undefined;
      this.currentBackoffMs = this.intervalMs;
      this.nextPollTimeMs = 0;
    }
    return this.refCountValue;
  }

  /** Starts polling if there is at least one active registration. */
  start(): void {
    this.guardDisposed();
    if (this.isStarted || this.refCountValue === 0) {
      return;
    }
    this.isStarted = true;
    this.runner.start(StartMode.Immediately);
  }

  /** Suspends polling without clearing the last known snapshot. */
  suspend(): void {
    this.guardDisposed();
    if (!this.isStarted || this.isSuspended) {
      return;
    }
    this.isSuspended = true;
    this.runner.stop();
  }

  /** Resumes polling and refreshes immediately. */
  resume(): void {
    this.guardDisposed();
    if (!this.isStarted || !this.isSuspended || this.refCountValue === 0) {
      return;
    }
    this.isSuspended = false;
    this.nextPollTimeMs = 0;
    this.runner.start(StartMode.Immediately);
  }

  /** Disposes this poller and aborts any in-flight poll. */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    this.refCountValue = 0;
    this.runner.dispose();
  }

  /** Throws if the poller has already been disposed. */
  private guardDisposed(): void {
    if (this.isDisposed) {
      throw new Error('Cannot use DirectoryPoller after it has been disposed');
    }
  }

  /**
   * Runs one scheduled poll when not suspended or backed off.
   *
   * @param signal - Abort signal for the current scheduled poll.
   */
  private async poll(signal: AbortSignal): Promise<void> {
    if (this.isSuspended || Date.now() < this.nextPollTimeMs) {
      return;
    }

    const client = await this.options.getClient();
    if (!client) {
      return;
    }

    try {
      const snapshot = await this.readSnapshot(client, signal);
      this.handleSuccess(snapshot);
    } catch (error: unknown) {
      this.handlePollError(error);
    }
  }

  /**
   * Reads the current direct-child snapshot for the watched directory.
   *
   * @param client - Contents API client to read from.
   * @param signal - Abort signal for the request.
   * @returns A snapshot keyed by Jupyter contents path.
   */
  private async readSnapshot(
    client: ContentsApi,
    signal: AbortSignal,
  ): Promise<DirectorySnapshot> {
    const contents = await client.get(
      { path: this.options.uri.path, type: ContentsGetTypeEnum.Directory },
      { signal },
    );
    if (!isDirectoryContents(contents)) {
      throw new Error(
        `Expected directory contents for ${this.options.uri.toString()}`,
      );
    }

    return new Map(
      contents.content.map((child) => [
        child.path,
        this.toSnapshotEntry(child),
      ]),
    );
  }

  /**
   * Converts one Jupyter contents child into comparable metadata.
   *
   * @param contents - Jupyter contents model for one child entry.
   * @returns The comparable snapshot entry.
   */
  private toSnapshotEntry(contents: Contents): SnapshotEntry {
    return {
      uri: this.options.vs.Uri.joinPath(this.options.uri, contents.name),
      type: toFileType(this.options.vs, contents.type),
      mtime: contents.lastModified
        ? new Date(contents.lastModified).getTime()
        : 0,
      size: contents.size ?? 0,
    };
  }

  /**
   * Stores a successful snapshot and emits changes after initialization.
   *
   * @param snapshot - Snapshot from the latest successful poll.
   */
  private handleSuccess(snapshot: DirectorySnapshot): void {
    const previous = this.snapshot;
    this.snapshot = snapshot;
    this.currentBackoffMs = this.intervalMs;
    this.nextPollTimeMs = 0;

    if (!previous) {
      return;
    }

    const events = this.diffSnapshots(previous, snapshot);
    if (events.length > 0) {
      this.options.onDidChangeFile(events);
    }
  }

  /**
   * Handles a failed poll, including terminal deletion and backoff.
   *
   * @param error - Error thrown while polling.
   */
  private handlePollError(error: unknown): void {
    if (error instanceof ResponseError && error.response.status === 404) {
      this.options.onDidChangeFile([
        { type: this.options.vs.FileChangeType.Deleted, uri: this.options.uri },
      ]);
      this.dispose();
      return;
    }

    log.warn(`Unable to poll ${this.options.uri.toString()}`, error);
    this.nextPollTimeMs = Date.now() + this.currentBackoffMs;
    this.currentBackoffMs = Math.min(
      this.currentBackoffMs * 2,
      this.maxBackoffMs,
    );
  }

  /**
   * Compares two snapshots and returns coalesced file events.
   *
   * @param previous - Last successful snapshot.
   * @param current - Latest successful snapshot.
   * @returns Events describing changes between the snapshots.
   */
  private diffSnapshots(
    previous: DirectorySnapshot,
    current: DirectorySnapshot,
  ): FileChangeEvent[] {
    const deleted: FileChangeEvent[] = [];
    const changed: FileChangeEvent[] = [];
    const created: FileChangeEvent[] = [];

    for (const [path, previousEntry] of previous) {
      const currentEntry = current.get(path);
      if (!currentEntry) {
        deleted.push({
          type: this.options.vs.FileChangeType.Deleted,
          uri: previousEntry.uri,
        });
        continue;
      }
      if (currentEntry.type !== previousEntry.type) {
        deleted.push({
          type: this.options.vs.FileChangeType.Deleted,
          uri: previousEntry.uri,
        });
        created.push({
          type: this.options.vs.FileChangeType.Created,
          uri: currentEntry.uri,
        });
        continue;
      }
      if (
        currentEntry.mtime !== previousEntry.mtime ||
        currentEntry.size !== previousEntry.size
      ) {
        changed.push({
          type: this.options.vs.FileChangeType.Changed,
          uri: currentEntry.uri,
        });
      }
    }

    for (const [path, currentEntry] of current) {
      if (!previous.has(path)) {
        created.push({
          type: this.options.vs.FileChangeType.Created,
          uri: currentEntry.uri,
        });
      }
    }

    return coalesceEvents([...deleted, ...changed, ...created]);
  }
}

function coalesceEvents(events: readonly FileChangeEvent[]): FileChangeEvent[] {
  const seen = new Set<string>();
  const coalesced: FileChangeEvent[] = [];
  for (const event of events) {
    const key = `${String(event.type)}:${event.uri.toString()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    coalesced.push(event);
  }
  return coalesced;
}
