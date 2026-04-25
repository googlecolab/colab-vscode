/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Buffer } from 'buffer';
import vscode, {
  Disposable,
  Event,
  EventEmitter,
  FileChangeEvent,
  FileStat,
  FileSystemProvider,
  FileType,
  Uri,
  WorkspaceConfiguration,
  WorkspaceFoldersChangeEvent,
} from 'vscode';
import { buildColabFileUri } from '../../colab/files';
import { log } from '../../common/logging';
import { traceMethod } from '../../common/logging/decorators';
import {
  OverrunPolicy,
  SequentialTaskRunner,
  StartMode,
} from '../../common/task-runner';
import {
  DirectoryContents,
  isDirectoryContents,
  toFileStat,
  toFileType,
} from '../client/converters';
import {
  Contents,
  ContentsApi,
  ContentsGetFormatEnum,
  ContentsGetTypeEnum,
  ContentsSaveRequest,
  ResponseError,
} from '../client/generated';
import { ColabAssignedServer } from '../servers';
import { JupyterConnectionManager } from './sessions';

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

type DirectorySnapshot = ReadonlyMap<string, SnapshotEntry>;
type WatchKind = 'directory' | 'file';
type WatchSnapshot = DirectorySnapshot | FileSnapshot;

function isFileSnapshot(snapshot: WatchSnapshot): snapshot is FileSnapshot {
  return !isDirectorySnapshot(snapshot);
}

function isDirectorySnapshot(
  snapshot: WatchSnapshot,
): snapshot is DirectorySnapshot {
  return snapshot instanceof Map;
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
 * Defines what VS Code needs to read, write, discover and manage files and
 * folders on the provided assigned Colab Jupyter
 * {@link ColabAssignedServer | server }.
 *
 * This provider is built atop Jupyter Server's Contents REST API.
 *
 * Naturally, this is just *one* client to Jupyter's contents directory. Users
 * of the server can modify it directly, other clients may too. Rather than
 * introduce a complex locking mechanism, which will really slow down and hinder
 * the UI, we rely extensively on Jupyter's API responses to guard against race
 * conditions.
 */
export class ContentsFileSystemProvider
  implements FileSystemProvider, Disposable
{
  /**
   * An event to signal that a resource has been created, changed, or deleted.
   * This event should fire for resources that are being
   * {@link FileSystemProvider.watch | watched} by clients of this provider.
   */
  readonly onDidChangeFile: Event<FileChangeEvent[]>;

  private isDisposed = false;
  /**
   * Note:* It is important that the metadata of the file that changed provides
   * an updated `mtime` that advanced from the previous value in the
   * {@link FileStat | stat} and a correct `size` value. Otherwise there may be
   * optimizations in place that will not show the change in an editor for
   * example.
   */
  private readonly changeEmitter: EventEmitter<FileChangeEvent[]>;
  private readonly workspaceListener: Disposable;
  private readonly connectionListener: Disposable;
  private readonly watchRunner: SequentialTaskRunner;
  private readonly watchConfig: WatchConfig;
  private readonly watches = new Map<string, WatchState>();

  /**
   * Initializes a new instance.
   *
   * @param vs - The VS Code API instance.
   * @param jupyterConnections - The Jupyter connections manager.
   */
  constructor(
    private readonly vs: typeof vscode,
    private readonly jupyterConnections: JupyterConnectionManager,
  ) {
    this.watchConfig = readWatchConfig(vs.workspace.getConfiguration('colab'));
    this.changeEmitter = new vs.EventEmitter<FileChangeEvent[]>();
    this.onDidChangeFile = this.changeEmitter.event;
    this.watchRunner = new SequentialTaskRunner(
      {
        intervalTimeoutMs: this.watchConfig.pollIntervalMs,
        taskTimeoutMs: WATCH_TASK_TIMEOUT_MS,
        abandonGraceMs: 0,
      },
      {
        name: `${ContentsFileSystemProvider.name}.watch`,
        run: this.pollWatches.bind(this),
      },
      OverrunPolicy.AllowToComplete,
    );
    this.workspaceListener = vs.workspace.onDidChangeWorkspaceFolders(
      this.dropMatchingConnection.bind(this),
    );
    this.connectionListener = jupyterConnections.onDidRevokeConnections(
      this.removeWorkspaceFolders.bind(this),
    );
  }

  /**
   * Dispose the provider, removing all listeners and references.
   */
  dispose() {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.workspaceListener.dispose();
    this.connectionListener.dispose();
    this.watches.clear();
    this.watchRunner.dispose();
    this.changeEmitter.dispose();
  }

  /**
   * Mounts the provided {@link ColabAssignedServer | server} to the workspace.
   *
   * @param server - The server to mount as a workspace folder.
   */
  // TODO: Only add the workspace folder if it's a new server (this.servers).
  // Otherwise, need to verify if you can "close" workspace folders and what
  // that does. Do we re-add it?
  mount(server: ColabAssignedServer): void {
    this.guardDisposed();

    const uri = buildColabFileUri(this.vs, server, 'content');
    const existingFolder = this.vs.workspace.getWorkspaceFolder(uri);
    if (existingFolder) {
      log.info(`Server is already mounted: "${server.label}"`, existingFolder);
      return;
    }
    const lastIdx = this.vs.workspace.workspaceFolders?.length ?? 0;
    // TODO: Consider adding a mechanism to listen for the next workspace folder
    // change that corresponds to the addition, and render then dismiss a
    // notification.
    const added = this.vs.workspace.updateWorkspaceFolders(lastIdx, 0, {
      uri,
      name: server.label,
    });
    if (!added) {
      const msg = `Unable to mount server "${server.label}"`;
      log.error(msg, server);
      throw new Error(msg);
    }
  }

  /**
   * Polls watched resources for changes.
   *
   * The Jupyter Server REST API does not support native watching and Colab has
   * no socket-based implementation that can easily be used. Instead, watched
   * resources are polled on a fixed interval and translated to file change
   * events.
   *
   * @param uri - The URI of the resource.
   * @param options - Configuration options for the operation.
   * @returns A disposable that stops polling this watch registration.
   */
  @traceMethod
  watch(
    uri: Uri,
    options: {
      readonly recursive: boolean;
      readonly excludes: readonly string[];
    },
  ): Disposable {
    this.guardDisposed();
    this.throwForVsCodeFile(uri);
    const key = this.buildWatchKey(uri, options.recursive);
    const existing = this.watches.get(key);
    if (existing) {
      existing.refCount += 1;
    } else {
      this.watches.set(key, {
        uri,
        recursive: options.recursive,
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

    return {
      dispose: () => {
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
   * Retrieve metadata about a file.
   *
   * @param uri - The uri of the file to retrieve metadata about.
   * @returns The file metadata about the file.
   * @throws {@link FileSystemError.FileNotFound | FileNotFound} when `uri`
   * doesn't exist.
   */
  @traceMethod
  async stat(uri: Uri): Promise<FileStat> {
    this.guardDisposed();
    this.throwForVsCodeFile(uri);
    const path = uri.path;
    try {
      const client = await this.getOrCreateClient(uri);
      const content = await client.get({ path, content: 0 });
      return toFileStat(this.vs, content);
    } catch (error: unknown) {
      this.handleError(error);
    }
  }

  /**
   * Retrieve all entries of a {@link FileType.Directory | directory}.
   *
   * @param uri - The uri of the folder.
   * @returns An array of name/type-tuples or a thenable that resolves to such.
   * @throws {@link FileSystemError.FileNotFound | FileNotFound} when `uri`
   * doesn't exist.
   */
  @traceMethod
  async readDirectory(uri: Uri): Promise<[string, FileType][]> {
    this.guardDisposed();
    this.throwForVsCodeFile(uri);
    const path = uri.path;
    try {
      const client = await this.getOrCreateClient(uri);
      const dir = await client.get({
        path,
        type: ContentsGetTypeEnum.Directory,
      });
      if (!isDirectoryContents(dir)) {
        throw this.vs.FileSystemError.FileNotADirectory(uri);
      }

      return dir.content.map((child) => [
        child.name,
        toFileType(this.vs, child.type),
      ]);
    } catch (error: unknown) {
      this.handleError(error);
    }
  }

  /**
   * Create a new directory.
   *
   * @param uri - The uri of the new folder.
   * @throws {@link FileSystemError.FileNotFound | FileNotFound} when the parent
   * of `uri` doesn't exist, e.g. no mkdirp-logic required.
   * @throws {@link FileSystemError.FileExists | FileExists} when `uri` already
   * exists.
   * @throws {@link FileSystemError.NoPermissions | NoPermissions} when
   * permissions aren't sufficient.
   */
  @traceMethod
  async createDirectory(uri: Uri): Promise<void> {
    this.guardDisposed();
    this.throwForVsCodeFile(uri);
    const path = uri.path;
    try {
      const client = await this.getOrCreateClient(uri);
      await client.save({
        path,
        model: {
          type: ContentsGetTypeEnum.Directory,
        },
      });
      this.changeEmitter.fire([{ type: this.vs.FileChangeType.Created, uri }]);
    } catch (error: unknown) {
      this.handleError(error);
    }
  }

  /**
   * Read the entire contents of a file.
   *
   * @param uri - The uri of the file.
   * @returns An array of bytes or a thenable that resolves to such.
   * @throws {@link FileSystemError.FileNotFound | FileNotFound } when `uri`
   * doesn't exist.
   */
  @traceMethod
  async readFile(uri: Uri): Promise<Uint8Array> {
    this.guardDisposed();
    this.throwForVsCodeFile(uri);
    const path = uri.path;
    try {
      const client = await this.getOrCreateClient(uri);
      const content = await client.get({
        path,
        format: ContentsGetFormatEnum.Base64,
        type: ContentsGetTypeEnum.File,
      });

      if (typeof content.content !== 'string') {
        const err = new Error(
          'Unexpected content format received from Jupyter Server',
        );
        log.error(`Cannot read file "${uri.toString()}"`, err, content);
        throw err;
      }

      return Buffer.from(content.content, 'base64');
    } catch (error: unknown) {
      this.handleError(error);
    }
  }

  /**
   * Write data to a file, replacing its entire contents.
   *
   * @param uri - The uri of the file.
   * @param content - The new content of the file.
   * @param options - Defines if missing files should or must be created.
   * @throws {@link FileSystemError.FileNotFound | FileNotFound} when `uri`
   * doesn't exist and `create` is not set.
   * @throws {@link FileSystemError.FileNotFound | FileNotFound} when the parent
   * of `uri` doesn't exist and `create` is set, e.g. no mkdirp-logic required.
   * @throws {@link FileSystemError.FileExists | FileExists} when `uri` already
   * exists, `create` is set but `overwrite` is not set.
   * @throws {@link FileSystemError.NoPermissions | NoPermissions} when
   * permissions aren't sufficient.
   */
  @traceMethod
  async writeFile(
    uri: Uri,
    content: Uint8Array,
    options: {
      readonly create: boolean;
      readonly overwrite: boolean;
    },
  ): Promise<void> {
    this.guardDisposed();
    this.throwForVsCodeFile(uri);
    const client = await this.getOrCreateClient(uri);
    const path = uri.path;
    try {
      const exists = await this.fileExists(client, path);
      if (!options.create && !exists) {
        throw this.vs.FileSystemError.FileNotFound(uri);
      }
      if (!options.overwrite && exists) {
        throw this.vs.FileSystemError.FileExists(uri);
      }

      const model: ContentsSaveRequest = {
        content: Buffer.from(content).toString('base64'),
        format: 'base64',
        type: ContentsGetTypeEnum.File,
      };

      await client.save({ path, model });

      const eventType = exists
        ? this.vs.FileChangeType.Changed
        : this.vs.FileChangeType.Created;
      this.changeEmitter.fire([{ type: eventType, uri }]);
    } catch (error: unknown) {
      this.handleError(error);
    }
  }

  /**
   * Delete a file.
   *
   * @param uri - The resource that is to be deleted.
   * @param options - Defines if deletion of folders is recursive.
   * @throws {@link FileSystemError.FileNotFound | FileNotFound} when `uri`
   * doesn't exist.
   * @throws {@link FileSystemError.NoPermissions | NoPermissions} when
   * permissions aren't sufficient.
   */
  @traceMethod
  async delete(
    uri: Uri,
    options: {
      readonly recursive: boolean;
    },
  ): Promise<void> {
    this.guardDisposed();
    this.throwForVsCodeFile(uri);
    try {
      await this.deleteInternal(uri, options);
      this.changeEmitter.fire([{ type: this.vs.FileChangeType.Deleted, uri }]);
    } catch (error: unknown) {
      this.handleError(error);
    }
  }

  /**
   * Rename a file or folder.
   *
   * @param oldUri - The existing file.
   * @param newUri - The new location.
   * @param options - Defines if existing files should be overwritten.
   * @throws {@link FileSystemError.FileNotFound | FileNotFound} when `oldUri`
   * doesn't exist.
   * @throws {@link FileSystemError.FileNotFound | FileNotFound} when parent of
   * `newUri` doesn't exist, e.g. no mkdirp-logic required.
   * @throws {@link FileSystemError.FileExists | FileExists} when `newUri`
   * exists and when the `overwrite` option is not `true`.
   * @throws {@link FileSystemError.NoPermissions | NoPermissions} when
   * permissions aren't sufficient.
   */
  @traceMethod
  async rename(
    oldUri: Uri,
    newUri: Uri,
    options: {
      readonly overwrite: boolean;
    },
  ): Promise<void> {
    this.guardDisposed();
    this.throwForVsCodeFile(oldUri);
    this.throwForVsCodeFile(newUri);
    if (oldUri.authority !== newUri.authority) {
      throw new Error('Renaming across servers is not supported');
    }

    const client = await this.getOrCreateClient(oldUri);
    const oldPath = oldUri.path;
    const newPath = newUri.path;

    const newUriExists = await this.fileExists(client, newPath);
    if (!options.overwrite) {
      if (newUriExists) {
        throw this.vs.FileSystemError.FileExists(newUri);
      }
    }

    try {
      await client.rename({ path: oldPath, rename: { path: newPath } });
      this.changeEmitter.fire([
        { type: this.vs.FileChangeType.Deleted, uri: oldUri },
        {
          type: newUriExists
            ? this.vs.FileChangeType.Changed
            : this.vs.FileChangeType.Created,
          uri: newUri,
        },
      ]);
    } catch (error: unknown) {
      this.handleError(error);
    }
  }

  private guardDisposed() {
    if (this.isDisposed) {
      throw new Error(
        'Cannot use ContentsFileSystemProvider after it has been disposed',
      );
    }
  }

  private async getOrCreateClient(
    endpoint: string | Uri,
  ): Promise<ContentsApi> {
    endpoint = endpoint instanceof this.vs.Uri ? endpoint.authority : endpoint;
    try {
      const client = await this.jupyterConnections.getOrCreate(endpoint);
      return client;
    } catch (e: unknown) {
      log.error(`Unable to get or create Jupyter client for ${endpoint}`, e);
      // This should only happen if a file-system call was made to and endpoint
      // which hasn't been mounted.
      throw this.vs.FileSystemError.Unavailable(endpoint);
    }
  }

  private async deleteInternal(
    uri: Uri,
    options: {
      readonly recursive: boolean;
    },
  ): Promise<void> {
    const path = uri.path;
    const stat = await this.stat(uri);
    if (stat.type === this.vs.FileType.Directory) {
      const children = await this.readDirectory(uri);
      if (children.length > 0) {
        if (!options.recursive) {
          throw this.vs.FileSystemError.NoPermissions(
            'Cannot delete non-empty directory without recursive flag',
          );
        }

        // If children exist, recursively delete all children first.
        for (const child of children) {
          const childName = child[0];
          const childUri = this.vs.Uri.joinPath(uri, childName);
          await this.deleteInternal(childUri, options);
        }
      }
    }
    const client = await this.getOrCreateClient(uri);
    await client.delete({ path });
  }

  private async fileExists(
    client: ContentsApi,
    path: string,
  ): Promise<boolean> {
    try {
      await client.get({ path, content: 0 });
      return true;
    } catch (error: unknown) {
      if (error instanceof ResponseError && error.response.status === 404) {
        return false;
      }
      throw error;
    }
  }

  private dropMatchingConnection(e: WorkspaceFoldersChangeEvent) {
    for (const s of e.removed) {
      if (s.uri.scheme !== 'colab') {
        continue;
      }
      this.removeWatchesForAuthority(s.uri.authority);
      this.jupyterConnections.drop(s.uri.authority, true);
    }
  }

  private removeWorkspaceFolders(endpoints: string[]): void {
    this.removeWatchesForAuthorities(endpoints);
    const currentFolders = this.vs.workspace.workspaceFolders;
    if (!currentFolders || currentFolders.length === 0) {
      return;
    }
    const foldersToKeep = currentFolders
      .filter(
        (f) =>
          !(f.uri.scheme === 'colab' && endpoints.includes(f.uri.authority)),
      )
      .map((f) => ({
        uri: f.uri,
        name: f.name,
      }));
    if (foldersToKeep.length === currentFolders.length) {
      return;
    }
    this.vs.workspace.updateWorkspaceFolders(
      0,
      currentFolders.length,
      ...foldersToKeep,
    );
  }

  private handleError(error: unknown): never {
    if (error instanceof ResponseError) {
      if (error.response.status === 403) {
        throw this.vs.FileSystemError.NoPermissions();
      }
      if (error.response.status === 404) {
        throw this.vs.FileSystemError.FileNotFound();
      }
      if (error.response.status === 409) {
        throw this.vs.FileSystemError.FileExists();
      }
      const code = error.response.status.toString();
      const text = error.response.statusText;
      throw new Error(`Jupyter contents error: ${code} ${text}`);
    }
    throw error;
  }

  /**
   * Throw a {@link FileSystemError.FileNotFound} error for VS Code files we
   * know the server doesn't have, but VS Code looks for. Avoids the unnecessary
   * round-trip.
   *
   * @param uri - The URI of the resource.
   */
  private throwForVsCodeFile(uri: Uri) {
    if (uri.path === '/.vscode' || uri.path.startsWith('/.vscode/')) {
      throw this.vs.FileSystemError.FileNotFound(uri);
    }
  }

  private async pollWatches(signal: AbortSignal): Promise<void> {
    if (this.watches.size === 0 || signal.aborted) {
      return;
    }

    const events: FileChangeEvent[] = [];
    const coveredRoots: Uri[] = [];
    const watches = Array.from(this.watches.values()).sort((a, b) => {
      return (
        a.uri.path.length - b.uri.path.length ||
        Number(b.recursive) - Number(a.recursive)
      );
    });

    for (const watch of watches) {
      if (isAborted(signal)) {
        break;
      }
      if (coveredRoots.some((root) => this.contains(root, watch.uri))) {
        continue;
      }
      if (!this.isWatchRegistered(watch)) {
        continue;
      }

      try {
        const watchEvents = await this.pollWatch(watch, signal);
        if (!this.isWatchRegistered(watch)) {
          continue;
        }
        events.push(...watchEvents);
        if (watch.recursive) {
          coveredRoots.push(watch.uri);
        }
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

    const coalesced = this.coalesceFileEvents(events);
    if (coalesced.length > 0) {
      this.changeEmitter.fire(coalesced);
    }
  }

  private async pollWatch(
    watch: WatchState,
    signal: AbortSignal,
  ): Promise<FileChangeEvent[]> {
    const current = await this.readCurrentWatchState(watch, signal);
    if (isAborted(signal) || current.skipped) {
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
          return [{ type: this.vs.FileChangeType.Changed, uri: previous.uri }];
        }
        return this.diffDirectorySnapshots(previous.snapshot, current.snapshot);
      default:
        return assertNever(current);
    }
  }

  private diffDirectorySnapshots(
    previous: DirectorySnapshot,
    current: DirectorySnapshot,
  ): FileChangeEvent[] {
    const deleted: SnapshotEntry[] = [];
    const created: SnapshotEntry[] = [];
    const changed: SnapshotEntry[] = [];

    for (const [key, previousEntry] of previous) {
      const currentEntry = current.get(key);
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

    for (const [key, currentEntry] of current) {
      if (!previous.has(key)) {
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
        snapshot: await this.collectDirectorySnapshot(
          client,
          watch.uri,
          watch.recursive,
          signal,
        ),
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

  private async getExistingClient(
    endpoint: string | Uri,
  ): Promise<ContentsApi | undefined> {
    endpoint = endpoint instanceof this.vs.Uri ? endpoint.authority : endpoint;
    try {
      return await this.jupyterConnections.get(endpoint);
    } catch (e: unknown) {
      log.warn(`Unable to get existing Jupyter client for ${endpoint}`, e);
      return undefined;
    }
  }

  private async collectDirectorySnapshot(
    client: ContentsApi,
    uri: Uri,
    recursive: boolean,
    signal: AbortSignal,
  ): Promise<DirectorySnapshot> {
    const snapshot = new Map<string, SnapshotEntry>();
    const contents = await this.getDirectoryContents(client, uri.path, signal);
    const pending: PendingDirectorySnapshot[] = [
      {
        uri,
        contents,
        remainingDepth: MAX_WATCH_DEPTH,
      },
    ];
    const budget: SnapshotCollectionBudget = { entryCount: 0 };

    while (pending.length > 0 && !isAborted(signal)) {
      const nextRequests: PendingDirectoryRequest[] = [];
      const currentLevel = pending.splice(0);
      for (const directory of currentLevel) {
        if (isAborted(signal)) {
          break;
        }
        this.collectDirectorySnapshotEntries(
          snapshot,
          directory,
          recursive,
          budget,
          nextRequests,
        );
        if (budget.entryCount >= this.watchConfig.maxSnapshotEntries) {
          return snapshot;
        }
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
            const nested = await this.getDirectoryContents(
              client,
              request.uri.path,
              signal,
            );
            return {
              uri: request.uri,
              contents: nested,
              remainingDepth: request.remainingDepth,
            };
          }),
        );
        pending.push(...childSnapshots);
      }
    }
    return snapshot;
  }

  private collectDirectorySnapshotEntries(
    snapshot: Map<string, SnapshotEntry>,
    directory: PendingDirectorySnapshot,
    recursive: boolean,
    budget: SnapshotCollectionBudget,
    nextRequests: PendingDirectoryRequest[],
  ): void {
    for (const child of directory.contents.content) {
      if (budget.entryCount >= this.watchConfig.maxSnapshotEntries) {
        return;
      }
      const childUri = this.vs.Uri.joinPath(directory.uri, child.name);
      const childType = toFileType(this.vs, child.type);
      snapshot.set(childUri.toString(), {
        uri: childUri,
        type: childType,
        mtime: new Date(child.lastModified).getTime(),
        size: child.size ?? 0,
      });
      budget.entryCount += 1;
      if (
        recursive &&
        directory.remainingDepth > 0 &&
        childType === this.vs.FileType.Directory
      ) {
        nextRequests.push({
          uri: childUri,
          remainingDepth: directory.remainingDepth - 1,
        });
      }
    }
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

  private buildWatchKey(uri: Uri, recursive: boolean): string {
    return `${uri.toString()}::${recursive ? 'recursive' : 'direct'}`;
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

  private removeWatchesForAuthority(authority: string): void {
    this.removeWatchesForAuthorities([authority]);
  }

  private removeWatchesForAuthorities(authorities: readonly string[]): void {
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
}

export const TEST_ONLY = {
  WATCH_POLL_INTERVAL_MS,
  WATCH_TASK_TIMEOUT_MS,
  MAX_WATCH_DEPTH,
  WATCH_SNAPSHOT_REQUEST_CONCURRENCY,
  MAX_WATCH_SNAPSHOT_ENTRIES,
};
