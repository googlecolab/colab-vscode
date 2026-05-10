/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, {
  Disposable,
  FileChangeEvent,
  FileType,
  Uri,
  WorkspaceConfiguration,
} from 'vscode';
import { log } from '../../common/logging';
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

const WATCH_POLL_INTERVAL_MS = 1000 * 5;
const WATCH_TASK_TIMEOUT_MS = 1000 * 10;
const MAX_WATCH_DEPTH = 20;
const WATCH_SNAPSHOT_REQUEST_CONCURRENCY = 5;
const MAX_WATCH_SNAPSHOT_ENTRIES = 5000;

interface WatchConfig {
  readonly pollIntervalMs: number;
  readonly snapshotRequestConcurrency: number;
  readonly maxSnapshotEntries: number;
}

interface FileSnapshot {
  readonly mtime: number;
  readonly size: number;
}

interface SnapshotEntry {
  readonly uri: Uri;
  readonly type: FileType;
  readonly mtime: number;
  readonly size: number;
}

interface DirectorySnapshot {
  readonly entries: ReadonlyMap<string, SnapshotEntry>;
  readonly complete: boolean;
}

type WatchKind = 'directory' | 'file';
type WatchSnapshot = DirectorySnapshot | FileSnapshot;

function isFileSnapshot(snapshot: WatchSnapshot): snapshot is FileSnapshot {
  return !isDirectorySnapshot(snapshot);
}

function isDirectorySnapshot(
  snapshot: WatchSnapshot,
): snapshot is DirectorySnapshot {
  return 'complete' in snapshot;
}

type CurrentWatchState =
  | { readonly skipped: true }
  | { readonly present: false; readonly skipped?: false }
  | {
      readonly kind: 'directory';
      readonly present: true;
      readonly snapshot: DirectorySnapshot;
      readonly skipped?: false;
    }
  | {
      readonly kind: 'file';
      readonly present: true;
      readonly snapshot: FileSnapshot;
      readonly skipped?: false;
    };

interface WatchState {
  readonly uri: Uri;
  readonly recursive: boolean;
  refCount: number;
  initialized: boolean;
  present: boolean;
  kind?: WatchKind;
  snapshot?: WatchSnapshot;
}

interface PendingDirectorySnapshot {
  readonly uri: Uri;
  readonly contents: DirectoryContents;
  readonly remainingDepth: number;
}

interface PendingDirectoryRequest {
  readonly uri: Uri;
  readonly remainingDepth: number;
}

interface SnapshotCollectionBudget {
  entryCount: number;
}

function readWatchConfig(
  config?: Pick<WorkspaceConfiguration, 'get'>,
): WatchConfig {
  return {
    pollIntervalMs: readPositiveInteger(
      config,
      'fileWatchPollIntervalMs',
      WATCH_POLL_INTERVAL_MS,
    ),
    snapshotRequestConcurrency: readPositiveInteger(
      config,
      'fileWatchSnapshotRequestConcurrency',
      WATCH_SNAPSHOT_REQUEST_CONCURRENCY,
    ),
    maxSnapshotEntries: readPositiveInteger(
      config,
      'fileWatchMaxSnapshotEntries',
      MAX_WATCH_SNAPSHOT_ENTRIES,
    ),
  };
}

function readPositiveInteger(
  config: Pick<WorkspaceConfiguration, 'get'> | undefined,
  key: string,
  defaultValue: number,
): number {
  if (!config) {
    return defaultValue;
  }
  const value = config.get<number>(key, defaultValue);
  if (!Number.isFinite(value) || value < 1) {
    return defaultValue;
  }
  return Math.floor(value);
}

function assertNever(value: never): never {
  throw new Error(`Unexpected watch state: ${JSON.stringify(value)}`);
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/**
 * Polling-backed watcher for mounted Colab filesystem resources.
 */
export class ContentsFileWatcher implements Disposable {
  private readonly watchRunner: SequentialTaskRunner;
  private readonly watchConfig: WatchConfig;
  private readonly watches = new Map<string, WatchState>();

  /**
   * Initializes a new instance.
   *
   * @param vs - The VS Code API instance.
   * @param config - Colab workspace configuration values.
   * @param getExistingClient - Retrieves an existing client without creating
   * a new connection for background polling.
   * @param emitChanges - Emits file change events to provider consumers.
   */
  constructor(
    private readonly vs: typeof vscode,
    config: Pick<WorkspaceConfiguration, 'get'> | undefined,
    private readonly getExistingClient: (
      endpoint: string | Uri,
    ) => Promise<ContentsApi | undefined>,
    private readonly emitChanges: (events: FileChangeEvent[]) => void,
  ) {
    this.watchConfig = readWatchConfig(config);
    this.watchRunner = new SequentialTaskRunner(
      {
        intervalTimeoutMs: this.watchConfig.pollIntervalMs,
        taskTimeoutMs: WATCH_TASK_TIMEOUT_MS,
        abandonGraceMs: 0,
      },
      {
        name: `${ContentsFileWatcher.name}.watch`,
        run: this.pollWatches.bind(this),
      },
      OverrunPolicy.AllowToComplete,
    );
  }

  /**
   * Dispose the watcher, removing all active watch registrations.
   */
  dispose(): void {
    this.watches.clear();
    this.watchRunner.dispose();
  }

  /**
   * Registers a watch for a mounted Colab filesystem resource.
   *
   * @param uri - The URI of the watched resource.
   * @param recursive - Whether nested directories should be included.
   * @returns A disposable that stops this watch registration.
   */
  watch(uri: Uri, recursive: boolean): Disposable {
    const key = this.buildWatchKey(uri, recursive);
    const existing = this.watches.get(key);
    if (existing) {
      existing.refCount += 1;
    } else {
      this.watches.set(key, {
        uri,
        recursive,
        refCount: 1,
        initialized: false,
        present: false,
      });
    }

    if (this.watches.size === 1) {
      this.watchRunner.start(StartMode.Immediately);
    } else {
      this.watchRunner.runNow();
    }

    let disposed = false;
    return {
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        const watch = this.watches.get(key);
        if (!watch) {
          return;
        }
        watch.refCount -= 1;
        if (watch.refCount > 0) {
          return;
        }
        this.watches.delete(key);
        if (this.watches.size === 0) {
          this.watchRunner.stop();
        }
      },
    };
  }

  /**
   * Removes watches that belong to one authority.
   *
   * @param authority - The Colab filesystem authority.
   */
  removeWatchesForAuthority(authority: string): void {
    this.removeWatchesForAuthorities([authority]);
  }

  /**
   * Removes watches that belong to any of the provided authorities.
   *
   * @param authorities - Colab filesystem authorities to remove.
   */
  removeWatchesForAuthorities(authorities: readonly string[]): void {
    if (authorities.length === 0 || this.watches.size === 0) {
      return;
    }
    // Deleting the current Map entry during iteration is spec-safe and avoids a
    // second pass over watches when a server authority is revoked.
    for (const [key, watch] of this.watches) {
      if (authorities.includes(watch.uri.authority)) {
        this.watches.delete(key);
      }
    }
    if (this.watches.size === 0) {
      this.watchRunner.stop();
    }
  }

  private async pollWatches(signal: AbortSignal): Promise<void> {
    if (this.watches.size === 0 || signal.aborted) {
      return;
    }

    const eventGroups: { watch: WatchState; events: FileChangeEvent[] }[] = [];
    const processed = new Set<WatchState>();

    for (;;) {
      if (isAborted(signal)) {
        break;
      }
      const remaining = Array.from(this.watches.values())
        .filter((candidate) => !processed.has(candidate))
        .sort(
          (a, b) =>
            a.uri.path.length - b.uri.path.length ||
            Number(b.recursive) - Number(a.recursive),
        );
      const watch = remaining.shift();
      if (watch === undefined) {
        break;
      }
      processed.add(watch);
      if (!this.isWatchRegistered(watch)) {
        continue;
      }

      try {
        const watchEvents = await this.pollWatch(watch, signal);
        if (!this.isWatchRegistered(watch)) {
          continue;
        }
        eventGroups.push({ watch, events: watchEvents });
      } catch (error: unknown) {
        if (isAborted(signal)) {
          break;
        }
        log.warn(
          `Failed to poll watched resource "${watch.uri.toString()}"`,
          error,
        );
      }
    }

    if (isAborted(signal)) {
      return;
    }

    const events = eventGroups.flatMap((group) =>
      this.isWatchRegistered(group.watch) ? group.events : [],
    );
    const coalesced = this.coalesceFileEvents(events);
    if (coalesced.length > 0) {
      this.emitChanges(coalesced);
    }
  }

  private async pollWatch(
    watch: WatchState,
    signal: AbortSignal,
  ): Promise<FileChangeEvent[]> {
    const current = await this.readCurrentWatchState(watch, signal);
    if (
      isAborted(signal) ||
      current.skipped ||
      !this.isWatchRegistered(watch)
    ) {
      return [];
    }
    if (!watch.initialized) {
      this.updateWatchState(watch, current);
      return [];
    }

    const events = this.diffWatchStates(watch, current);
    if (isAborted(signal)) {
      return [];
    }
    this.updateWatchState(watch, current);
    return events;
  }

  private updateWatchState(
    watch: WatchState,
    current: Exclude<CurrentWatchState, { readonly skipped: true }>,
  ): void {
    watch.initialized = true;
    watch.present = current.present;
    if (!current.present) {
      watch.kind = undefined;
      watch.snapshot = undefined;
      return;
    }
    watch.kind = current.kind;
    watch.snapshot = current.snapshot;
  }

  private diffWatchStates(
    previous: WatchState,
    current: Exclude<CurrentWatchState, { readonly skipped: true }>,
  ): FileChangeEvent[] {
    if (!previous.present && !current.present) {
      return [];
    }
    if (!previous.present) {
      return [{ type: this.vs.FileChangeType.Created, uri: previous.uri }];
    }
    if (!current.present) {
      return [{ type: this.vs.FileChangeType.Deleted, uri: previous.uri }];
    }
    if (!previous.kind) {
      return [{ type: this.vs.FileChangeType.Changed, uri: previous.uri }];
    }
    if (previous.kind !== current.kind) {
      return [
        { type: this.vs.FileChangeType.Deleted, uri: previous.uri },
        { type: this.vs.FileChangeType.Created, uri: previous.uri },
      ];
    }
    switch (current.kind) {
      case 'file':
        if (!previous.snapshot || !isFileSnapshot(previous.snapshot)) {
          return [{ type: this.vs.FileChangeType.Changed, uri: previous.uri }];
        }
        if (
          previous.snapshot.mtime === current.snapshot.mtime &&
          previous.snapshot.size === current.snapshot.size
        ) {
          return [];
        }
        return [{ type: this.vs.FileChangeType.Changed, uri: previous.uri }];
      case 'directory':
        if (!previous.snapshot || !isDirectorySnapshot(previous.snapshot)) {
          return this.conservativeDirectoryChange(previous.uri);
        }
        return this.diffDirectorySnapshots(
          previous.uri,
          previous.snapshot,
          current.snapshot,
        );
      default:
        return assertNever(current);
    }
  }

  private diffDirectorySnapshots(
    uri: Uri,
    previous: DirectorySnapshot,
    current: DirectorySnapshot,
  ): FileChangeEvent[] {
    if (!previous.complete || !current.complete) {
      return this.directorySnapshotChanged(previous, current)
        ? this.conservativeDirectoryChange(uri)
        : [];
    }
    const deleted: SnapshotEntry[] = [];
    const created: SnapshotEntry[] = [];
    const changed: SnapshotEntry[] = [];

    for (const [key, previousEntry] of previous.entries) {
      const currentEntry = current.entries.get(key);
      if (!currentEntry) {
        deleted.push(previousEntry);
        continue;
      }
      if (currentEntry.type !== previousEntry.type) {
        deleted.push(previousEntry);
        created.push(currentEntry);
      } else if (
        currentEntry.mtime !== previousEntry.mtime ||
        currentEntry.size !== previousEntry.size
      ) {
        changed.push(currentEntry);
      }
    }

    for (const [key, currentEntry] of current.entries) {
      if (!previous.entries.has(key)) {
        created.push(currentEntry);
      }
    }

    return [
      ...this.collapseNestedEntries(deleted).map((entry) => ({
        type: this.vs.FileChangeType.Deleted,
        uri: entry.uri,
      })),
      ...this.collapseNestedEntries(created).map((entry) => ({
        type: this.vs.FileChangeType.Created,
        uri: entry.uri,
      })),
      ...changed.map((entry) => ({
        type: this.vs.FileChangeType.Changed,
        uri: entry.uri,
      })),
    ];
  }

  private conservativeDirectoryChange(uri: Uri): FileChangeEvent[] {
    return [{ type: this.vs.FileChangeType.Changed, uri }];
  }

  private directorySnapshotChanged(
    previous: DirectorySnapshot,
    current: DirectorySnapshot,
  ): boolean {
    if (previous.complete !== current.complete) {
      return true;
    }
    if (previous.entries.size !== current.entries.size) {
      return true;
    }
    for (const [key, previousEntry] of previous.entries) {
      const currentEntry = current.entries.get(key);
      if (!currentEntry) {
        return true;
      }
      if (
        currentEntry.type !== previousEntry.type ||
        currentEntry.mtime !== previousEntry.mtime ||
        currentEntry.size !== previousEntry.size
      ) {
        return true;
      }
    }
    return false;
  }

  private collapseNestedEntries(
    entries: readonly SnapshotEntry[],
  ): SnapshotEntry[] {
    const collapsed: SnapshotEntry[] = [];
    const sorted = [...entries].sort(
      (a, b) => a.uri.path.length - b.uri.path.length,
    );
    for (const entry of sorted) {
      const covered = collapsed.some((candidate) => {
        return (
          candidate.type === this.vs.FileType.Directory &&
          this.contains(candidate.uri, entry.uri)
        );
      });
      if (!covered) {
        collapsed.push(entry);
      }
    }
    return collapsed;
  }

  private async readCurrentWatchState(
    watch: WatchState,
    signal: AbortSignal,
  ): Promise<CurrentWatchState> {
    const client = await this.getExistingClient(watch.uri);
    if (!client) {
      return {
        skipped: true,
      };
    }
    if (isAborted(signal)) {
      return { skipped: true };
    }
    const content = await this.getContentMetadata(
      client,
      watch.uri.path,
      signal,
    );
    if (!content) {
      return {
        present: false,
      };
    }

    const type = toFileType(this.vs, content.type);
    if (type === this.vs.FileType.Directory) {
      return {
        kind: 'directory',
        present: true,
        snapshot: await this.collectDirectorySnapshot(client, watch, signal),
      };
    }

    return {
      kind: 'file',
      present: true,
      snapshot: {
        mtime: new Date(content.lastModified).getTime(),
        size: content.size ?? 0,
      },
    };
  }

  private async collectDirectorySnapshot(
    client: ContentsApi,
    watch: WatchState,
    signal: AbortSignal,
  ): Promise<DirectorySnapshot> {
    const snapshot = new Map<string, SnapshotEntry>();
    const contents = await this.getDirectoryContents(
      client,
      watch.uri.path,
      signal,
    );
    const pending: PendingDirectorySnapshot[] = [
      {
        uri: watch.uri,
        contents,
        remainingDepth: MAX_WATCH_DEPTH,
      },
    ];
    const budget: SnapshotCollectionBudget = { entryCount: 0 };
    let complete = true;

    while (pending.length > 0 && !isAborted(signal)) {
      const nextRequests: PendingDirectoryRequest[] = [];
      const currentLevel = pending.splice(0);
      for (const directory of currentLevel) {
        if (isAborted(signal)) {
          break;
        }
        const directoryComplete = this.collectDirectorySnapshotEntries(
          snapshot,
          directory,
          watch,
          budget,
          nextRequests,
        );
        complete = directoryComplete && complete;
        if (
          !directoryComplete &&
          budget.entryCount >= this.watchConfig.maxSnapshotEntries
        ) {
          return { entries: snapshot, complete };
        }
      }
      if (
        budget.entryCount >= this.watchConfig.maxSnapshotEntries &&
        nextRequests.length > 0
      ) {
        return { entries: snapshot, complete: false };
      }

      for (
        let i = 0;
        i < nextRequests.length && !isAborted(signal);
        i += this.watchConfig.snapshotRequestConcurrency
      ) {
        const batch = nextRequests.slice(
          i,
          i + this.watchConfig.snapshotRequestConcurrency,
        );
        const childSnapshots = await Promise.all(
          batch.map(async (request) => {
            const nested = await this.getOptionalDirectoryContents(
              client,
              request.uri.path,
              signal,
            );
            if (!nested) {
              complete = false;
              return undefined;
            }
            return {
              uri: request.uri,
              contents: nested,
              remainingDepth: request.remainingDepth,
            };
          }),
        );
        pending.push(
          ...childSnapshots.filter(
            (snapshot): snapshot is PendingDirectorySnapshot =>
              Boolean(snapshot),
          ),
        );
      }
    }
    if (pending.length > 0) {
      complete = false;
    }
    return { entries: snapshot, complete };
  }

  private collectDirectorySnapshotEntries(
    snapshot: Map<string, SnapshotEntry>,
    directory: PendingDirectorySnapshot,
    watch: WatchState,
    budget: SnapshotCollectionBudget,
    nextRequests: PendingDirectoryRequest[],
  ): boolean {
    let complete = true;
    for (const child of directory.contents.content) {
      const childUri = this.vs.Uri.joinPath(directory.uri, child.name);
      const childType = toFileType(this.vs, child.type);
      const shouldDescend =
        watch.recursive && childType === this.vs.FileType.Directory;
      if (budget.entryCount >= this.watchConfig.maxSnapshotEntries) {
        return false;
      }
      snapshot.set(childUri.toString(), {
        uri: childUri,
        type: childType,
        mtime: new Date(child.lastModified).getTime(),
        size: child.size ?? 0,
      });
      budget.entryCount += 1;
      if (
        shouldDescend &&
        directory.remainingDepth > 0 &&
        budget.entryCount < this.watchConfig.maxSnapshotEntries
      ) {
        nextRequests.push({
          uri: childUri,
          remainingDepth: directory.remainingDepth - 1,
        });
      } else if (shouldDescend) {
        complete = false;
      }
    }
    return complete;
  }

  private async getContentMetadata(
    client: ContentsApi,
    path: string,
    signal?: AbortSignal,
  ): Promise<Contents | undefined> {
    try {
      return await client.get({ path, content: 0 }, { signal });
    } catch (error: unknown) {
      if (error instanceof ResponseError && error.response.status === 404) {
        return undefined;
      }
      throw error;
    }
  }

  private async getDirectoryContents(
    client: ContentsApi,
    path: string,
    signal?: AbortSignal,
  ): Promise<DirectoryContents> {
    const contents = await client.get(
      {
        path,
        type: ContentsGetTypeEnum.Directory,
      },
      { signal },
    );
    if (!isDirectoryContents(contents)) {
      throw this.vs.FileSystemError.FileNotADirectory(this.vs.Uri.parse(path));
    }
    return contents;
  }

  private async getOptionalDirectoryContents(
    client: ContentsApi,
    path: string,
    signal?: AbortSignal,
  ): Promise<DirectoryContents | undefined> {
    try {
      const contents = await client.get(
        {
          path,
          type: ContentsGetTypeEnum.Directory,
        },
        { signal },
      );
      return isDirectoryContents(contents) ? contents : undefined;
    } catch (error: unknown) {
      if (error instanceof ResponseError && error.response.status === 404) {
        return undefined;
      }
      throw error;
    }
  }

  private buildWatchKey(uri: Uri, recursive: boolean): string {
    return `${uri.toString()}::${recursive ? 'recursive' : 'direct'}`;
  }

  private isWatchRegistered(watch: WatchState): boolean {
    return (
      this.watches.get(this.buildWatchKey(watch.uri, watch.recursive)) === watch
    );
  }

  private contains(parent: Uri, child: Uri): boolean {
    if (
      parent.scheme !== child.scheme ||
      parent.authority !== child.authority
    ) {
      return false;
    }
    if (parent.path === child.path) {
      return true;
    }
    const parentPath = parent.path.endsWith('/')
      ? parent.path
      : `${parent.path}/`;
    return child.path.startsWith(parentPath);
  }

  private coalesceFileEvents(
    events: readonly FileChangeEvent[],
  ): FileChangeEvent[] {
    const coalesced = new Map<string, FileChangeEvent>();
    for (const event of events) {
      // Keep the event type in the key so a create/delete pair for a URI
      // survives coalescing; VS Code consumers need to observe both edges.
      coalesced.set(`${event.type.toString()}:${event.uri.toString()}`, event);
    }
    return Array.from(coalesced.values());
  }
}

export const TEST_ONLY = {
  WATCH_POLL_INTERVAL_MS,
  WATCH_TASK_TIMEOUT_MS,
  MAX_WATCH_DEPTH,
  WATCH_SNAPSHOT_REQUEST_CONCURRENCY,
  MAX_WATCH_SNAPSHOT_ENTRIES,
};
