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
  WorkspaceFoldersChangeEvent,
} from 'vscode';
import { buildColabFileUri } from '../../colab/files';
import { log } from '../../common/logging';
import { traceMethod } from '../../common/logging/decorators';
import {
  isDirectoryContents,
  toFileStat,
  toFileType,
} from '../client/converters';
import {
  ContentsApi,
  ContentsGetTypeEnum,
  ContentsSaveRequest,
  ResponseError,
} from '../client/generated';
import { ColabAssignedServer } from '../servers';
import { JupyterConnectionManager } from './sessions';

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
   * *Note:* It is important that the metadata of the file that changed provides
   * an updated `mtime` that advanced from the previous value in the
   * {@link FileStat | stat} and a correct `size` value. Otherwise there may be
   * optimizations in place that will not show the change in an editor for
   * example.
   */
  private readonly changeEmitter: EventEmitter<FileChangeEvent[]>;
  private readonly workspaceListener: Disposable;
  private readonly connectionListener: Disposable;

  constructor(
    private readonly vs: typeof vscode,
    private readonly jupyterConnections: JupyterConnectionManager,
  ) {
    this.changeEmitter = new vs.EventEmitter<FileChangeEvent[]>();
    this.onDidChangeFile = this.changeEmitter.event;
    this.workspaceListener = vs.workspace.onDidChangeWorkspaceFolders(
      this.dropMatchingConnection.bind(this),
    );
    this.connectionListener = jupyterConnections.onDidRevokeConnections(
      this.removeWorkspaceFolders.bind(this),
    );
  }

  dispose() {
    this.workspaceListener.dispose();
    this.connectionListener.dispose();
    this.isDisposed = true;
  }

  /**
   * Mounts the provided {@link ColabAssignedServer | server} to the workspace.
   *
   * @param server - The server to mount as a workspace folder.
   * @returns True if the server was mounted, false otherwise (if the server is
   * already mounted).
   */
  // TODO: Only add the workspace folder if it's a new server (this.servers).
  // Otherwise, need to verify if you can "close" workspace folders and what
  // that does. Do we re-add it?
  mount(server: ColabAssignedServer): void {
    this.guardDisposed();

    const uri = buildColabFileUri(this.vs, server);
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
   * All calls are no-op'd with an empty {@link Disposable} returned. Calls for
   * `.vscode` files always throw the relevant not-found error.
   *
   * The Jupyter Server REST API does not support watching and Colab has no
   * socket-based implementation that can easily be used.
   *
   * In the future we may consider adding time-based polling to fire events for
   * files/directories that have been `watch`-ed.
   */
  @traceMethod
  watch(
    uri: Uri,
    _options: {
      readonly recursive: boolean;
      readonly excludes: readonly string[];
    },
  ): Disposable {
    this.guardDisposed();
    this.throwForVsCodeFile(uri);
    return {
      dispose: () => {
        // No-op
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
    const path = this.uriToPath(uri);
    try {
      const client = await this.getOrCreateClient(uri);
      const content = await client.get({ path, content: 0 });
      return toFileStat(this.vs, content);
    } catch (error) {
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
    const path = this.uriToPath(uri);
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
    } catch (error) {
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
    const path = this.uriToPath(uri);
    try {
      const client = await this.getOrCreateClient(uri);
      await client.save({
        path,
        model: {
          type: ContentsGetTypeEnum.Directory,
        },
      });
      this.changeEmitter.fire([{ type: this.vs.FileChangeType.Created, uri }]);
    } catch (error) {
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
    const path = this.uriToPath(uri);
    try {
      const client = await this.getOrCreateClient(uri);
      const content = await client.get({
        path,
        format: 'base64',
      });

      if (
        isDirectoryContents(content) ||
        content.format !== 'base64' ||
        typeof content.content !== 'string'
      ) {
        throw this.vs.FileSystemError.FileIsADirectory(uri);
      }

      return Buffer.from(content.content, 'base64');
    } catch (error) {
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
    const path = this.uriToPath(uri);
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
    } catch (error) {
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
    const path = this.uriToPath(uri);
    try {
      if (!options.recursive) {
        const stat = await this.stat(uri);
        if (stat.type === this.vs.FileType.Directory) {
          const children = await this.readDirectory(uri);
          if (children.length > 0) {
            throw this.vs.FileSystemError.NoPermissions(
              'Cannot delete non-empty directory without recursive flag',
            );
          }
        }
      }

      const client = await this.getOrCreateClient(uri);
      await client.delete({ path });
      this.changeEmitter.fire([{ type: this.vs.FileChangeType.Deleted, uri }]);
    } catch (error) {
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
    const oldPath = this.uriToPath(oldUri);
    const newPath = this.uriToPath(newUri);

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
    } catch (error) {
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
    } catch (e) {
      log.error(`Unable to get or create Jupyter client for ${endpoint}`, e);
      // This should only happen if a file-system call was made to and endpoint
      // which hasn't been mounted.
      throw this.vs.FileSystemError.Unavailable(endpoint);
    }
  }

  private async fileExists(
    client: ContentsApi,
    path: string,
  ): Promise<boolean> {
    try {
      await client.get({ path, content: 0 });
      return true;
    } catch (error) {
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
      this.jupyterConnections.drop(s.uri.authority, true);
    }
  }

  private removeWorkspaceFolders(endpoints: string[]): void {
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

  // Jupyter expects paths relative to root, without the leading slash.
  // We want the workspace root to correspond to `/content` on the Jupyter server.
  private uriToPath(uri: Uri): string {
    let path = uri.path;
    if (path.startsWith('/')) {
      path = path.slice(1);
    }
    return path ? `content/${path}` : 'content';
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
   */
  private throwForVsCodeFile(uri: Uri) {
    if (uri.path === '/.vscode' || uri.path.startsWith('/.vscode/')) {
      throw this.vs.FileSystemError.FileNotFound(uri);
    }
  }
}
