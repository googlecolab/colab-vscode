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
  FileChangeType,
  FileStat,
  FileSystemError,
  FileSystemProvider,
  FileType,
  Uri,
  WorkspaceFolder,
  WorkspaceFoldersChangeEvent,
} from 'vscode';
import { AuthChangeEvent } from '../auth/auth-provider';
import { log } from '../common/logging';
import { traceMethod } from '../common/logging/decorators';
import { AssignmentChangeEvent, AssignmentManager } from './assignments';
import { JupyterClient, ProxiedJupyterClient } from './client';
import {
  ContentsApi,
  ContentsGetTypeEnum,
  ContentsSaveRequest,
  ResponseError,
} from './client/generated';
import { ColabAssignedServer } from './servers';

type Endpoint = string;

/**
 * Defines what VS Code needs to read, write, discover and manage files and
 * folders on the provided assigned Colab Jupyter
 * {@link ColabAssignedServer | server }.
 */
// TODO: Mutex where we read + write (e.g. in `write`)?
export class ContentsFileSystemProvider
  implements FileSystemProvider, Disposable
{
  /**
   * An event to signal that a resource has been created, changed, or deleted.
   * This event should fire for resources that are being
   * {@link FileSystemProvider.watch | watched} by clients of this provider.
   *
   * *Note:* It is important that the metadata of the file that changed provides
   * an updated `mtime` that advanced from the previous value in the
   * {@link FileStat | stat} and a correct `size` value. Otherwise there may be
   * optimizations in place that will not show the change in an editor for
   * example.
   */
  readonly onDidChangeFile: Event<FileChangeEvent[]>;

  private readonly servers = new Map<
    Endpoint,
    { contents: ContentsApi; dispose: () => void }
  >();
  private isAuthorized = false;
  private readonly changeEmitter = new EventEmitter<FileChangeEvent[]>();
  private readonly listeners: Disposable[];

  constructor(
    private readonly vs: typeof vscode,
    authEvent: Event<AuthChangeEvent>,
    private readonly assignments: AssignmentManager,
  ) {
    this.onDidChangeFile = this.changeEmitter.event;
    const auth = authEvent(this.removeServersWhenUnauthorized.bind(this));
    const assigns = assignments.onDidAssignmentsChange(
      this.removeRemovedServers.bind(this),
    );
    const workspaces = vs.workspace.onDidChangeWorkspaceFolders(
      this.removeRemovedServers.bind(this),
    );
    this.listeners = [auth, assigns, workspaces];
  }

  dispose() {
    for (const l of this.listeners) {
      l.dispose();
    }
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
  mount(server: ColabAssignedServer): boolean {
    if (this.isAuthorized) {
      log.error(
        `Server cannot be mounted while unauthorized: "${server.label}"`,
      );
      return false;
    }
    if (this.servers.has(server.endpoint)) {
      log.info(`Server is already mounted: "${server.label}"`);
      return false;
    }
    this.createClient(server);
    const uri = this.serverUri(server);
    const lastIdx = this.vs.workspace.workspaceFolders
      ? this.vs.workspace.workspaceFolders.length
      : 0;
    const added = this.vs.workspace.updateWorkspaceFolders(lastIdx, 0, {
      uri,
      name: server.label,
    });
    if (!added) {
      this.removeServer(server.endpoint);
      log.error(`Unable to mount server: "${server.label}"`);
      return false;
    }
    return true;
  }

  /**
   * Subscribes to file change events in the file or folder denoted by `uri`.
   * For folders, the option `recursive` indicates whether subfolders,
   * sub-subfolders, etc. should be watched for file changes as well. With
   * `recursive: false`, only changes to the files that are direct children of
   * the folder should trigger an event.
   *
   * The `excludes` array is used to indicate paths that should be excluded from
   * file watching. It is typically derived from the `files.watcherExclude`
   * setting that is configurable by the user. Each entry can be be:
   * - the absolute path to exclude
   * - a relative path to exclude (for example `build/output`)
   * - a simple glob pattern (for example `output/**`)
   *
   * It is the file system provider's job to call
   * {@link FileSystemProvider.onDidChangeFile | onDidChangeFile} for every
   * change given these rules. No event should be emitted for files that match
   * any of the provided excludes.
   *
   * @param uri - The uri of the file or folder to be watched.
   * @param options - Configures the watch.
   * @returns A disposable that tells the provider to stop watching the `uri`.
   */
  @traceMethod
  @skipVsCodeFiles
  watch(
    _uri: Uri,
    _options: {
      /**
       * When enabled also watch subfolders.
       */
      readonly recursive: boolean;
      /**
       * A list of paths and pattern to exclude from watching.
       */
      readonly excludes: readonly string[];
    },
  ): Disposable {
    // Jupyter does not provide a standard WebSocket API for watching file
    // contents. We strictly implement the interface but do not support
    // watching.
    return new Disposable(() => {
      // No-op
    });
  }

  /**
   * Retrieve metadata about a file.
   *
   * Note that the metadata for symbolic links should be the metadata of the
   * file they refer to. Still, the
   * {@link FileType.SymbolicLink | SymbolicLink}-type must be used in addition
   * to the actual type, e.g. `FileType.SymbolicLink | FileType.Directory`.
   *
   * @param uri - The uri of the file to retrieve metadata about.
   * @returns The file metadata about the file.
   * @throws {@link FileSystemError.FileNotFound | FileNotFound} when `uri`
   * doesn't exist.
   */
  @traceMethod
  @skipVsCodeFiles
  async stat(uri: Uri): Promise<FileStat> {
    const path = this.uriToPath(uri);
    try {
      const client = await this.getClient(uri);
      const content = await client.get({
        path,
        content: 0, // Metadata only
      });

      return {
        type: this.getContentType(content.type),
        ctime: content.created ? new Date(content.created).getTime() : 0,
        mtime: content.lastModified
          ? new Date(content.lastModified).getTime()
          : 0,
        size: content.size ?? 0,
      };
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
    const path = this.uriToPath(uri);
    try {
      const client = await this.getClient(uri);
      const content = await client.get({
        path,
        type: ContentsGetTypeEnum.Directory,
      });

      if (!Array.isArray(content.content)) {
        // Should not happen if type is directory
        throw FileSystemError.FileNotADirectory(uri);
      }

      // Explicitly cast content.content to Array<any> because generated types might be loose on 'content'
      const children = content.content as unknown as {
        name: string;
        type: string;
      }[];

      return children.map((child) => [
        child.name,
        this.getContentType(child.type),
      ]);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Create a new directory (Note, that new files are created via
   * `write`-calls).
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
    const path = this.uriToPath(uri);
    try {
      const client = await this.getClient(uri);
      await client.save({
        path,
        model: {
          type: ContentsGetTypeEnum.Directory,
        },
      });
      this.changeEmitter.fire([{ type: FileChangeType.Created, uri }]);
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
  @skipVsCodeFiles
  async readFile(uri: Uri): Promise<Uint8Array> {
    const path = this.uriToPath(uri);
    try {
      const client = await this.getClient(uri);
      const content = await client.get({
        path,
        format: 'base64',
      });

      if (
        content.type === ContentsGetTypeEnum.Directory ||
        content.format !== 'base64' ||
        typeof content.content !== 'string'
      ) {
        throw FileSystemError.FileIsADirectory(uri);
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
    const path = this.uriToPath(uri);

    let exists = false;
    const client = await this.getClient(uri);
    if (!options.create || !options.overwrite) {
      try {
        await client.get({ path, content: 0 });
        exists = true;
      } catch {
        // Ignore error, means file doesn't exist
      }

      if (!options.create && !exists) {
        throw FileSystemError.FileNotFound(uri);
      }
      if (!options.overwrite && exists) {
        throw FileSystemError.FileExists(uri);
      }
    }

    try {
      const model: ContentsSaveRequest = {
        content: Buffer.from(content).toString('base64'),
        format: 'base64',
        type: ContentsGetTypeEnum.File,
      };

      await client.save({ path, model });

      const eventType = exists
        ? FileChangeType.Changed
        : FileChangeType.Created;
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
    const path = this.uriToPath(uri);
    try {
      if (!options.recursive) {
        const stat = await this.stat(uri);
        if (stat.type === FileType.Directory) {
          const children = await this.readDirectory(uri);
          if (children.length > 0) {
            throw FileSystemError.NoPermissions(
              'Cannot delete non-empty directory without recursive flag',
            );
          }
        }
      }

      const client = await this.getClient(uri);
      await client.delete({ path });
      this.changeEmitter.fire([{ type: FileChangeType.Deleted, uri }]);
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
    if (oldUri.authority !== newUri.authority) {
      throw new Error('Renaming across servers is not supported');
    }

    const oldPath = this.uriToPath(oldUri);
    const newPath = this.uriToPath(newUri);

    const client = await this.getClient(oldUri);
    if (!options.overwrite) {
      try {
        await client.get({ path: newPath, content: 0 });
        throw FileSystemError.FileExists(newUri);
      } catch (e) {
        if (e instanceof FileSystemError) {
          throw e;
        }
        // Safe to assume not-found, proceed with the rename.
      }
    }

    try {
      await client.rename({ path: oldPath, rename: { path: newPath } });
      this.changeEmitter.fire([
        { type: FileChangeType.Deleted, uri: oldUri },
        { type: FileChangeType.Created, uri: newUri },
      ]);
    } catch (error) {
      this.handleError(error);
    }
  }

  private removeServersWhenUnauthorized(e: AuthChangeEvent) {
    if (e.hasValidSession) {
      if (!this.isAuthorized) {
        this.changeEmitter.fire([
          { type: FileChangeType.Created, uri: Uri.from({ scheme: 'colab' }) },
        ]);
      }
      this.isAuthorized = true;
    }
    this.isAuthorized = false;
    for (const [endpoint] of this.servers) {
      this.removeServer(endpoint);
    }
  }

  private removeRemovedServers(
    e: AssignmentChangeEvent | WorkspaceFoldersChangeEvent,
  ) {
    for (const s of e.removed) {
      if ('server' in s) {
        this.removeServer(s.server.endpoint);
      } else if (s.uri.scheme === 'colab') {
        this.removeServer(s.uri.authority);
      }
    }
  }

  private removeServer(endpoint: string): void {
    const client = this.servers.get(endpoint);
    this.removeWorkspaceFolderServer(endpoint);
    client?.dispose();
    this.servers.delete(endpoint);
  }

  private removeWorkspaceFolderServer(
    endpoint: string,
  ): vscode.WorkspaceFolder | undefined {
    const folder = this.findWorkspaceFolder(endpoint);
    if (folder) {
      this.vs.workspace.updateWorkspaceFolders(folder.index, 1);
    }
    return folder;
  }

  private findWorkspaceFolder(endpoint: string): WorkspaceFolder | undefined {
    return this.vs.workspace.workspaceFolders?.find(
      (f) => f.uri.scheme === 'colab' && f.uri.authority === endpoint,
    );
  }

  private serverUri(server: ColabAssignedServer): Uri {
    return this.vs.Uri.from({
      scheme: 'colab',
      authority: server.endpoint,
      path: '/',
    });
  }

  private async getClient(uri: Uri): Promise<ContentsApi> {
    const endpoint = uri.authority;
    const client = this.servers.get(endpoint);
    if (client) {
      return client.contents;
    }
    const servers = await this.assignments.getServers('extension');
    const server = servers.find((s) => s.endpoint === endpoint);
    if (!server) {
      throw FileSystemError.Unavailable(
        `Server '${uri.authority}' has been removed`,
      );
    }
    return this.createClient(server).contents;
  }

  private createClient(server: ColabAssignedServer): JupyterClient {
    const client = ProxiedJupyterClient.withRefreshingConnection(
      server,
      this.assignments.onDidAssignmentsChange,
    );
    this.servers.set(server.endpoint, {
      contents: client.contents,
      dispose: () => {
        client.dispose();
      },
    });
    return client;
  }

  private uriToPath(uri: Uri): string {
    // Jupyter expects paths relative to root, without leading slash.
    // We want the workspace root to correspond to `/content` on the Jupyter server.
    let path = uri.path;
    if (path.startsWith('/')) {
      path = path.slice(1);
    }
    return path ? `content/${path}` : 'content';
  }

  private getContentType(type?: string): FileType {
    switch (type) {
      case 'directory':
        return FileType.Directory;
      case 'notebook':
      case 'file':
      default:
        return FileType.File;
    }
  }

  private handleError(error: unknown): never {
    if (error instanceof ResponseError) {
      if (error.response.status === 404) {
        throw FileSystemError.FileNotFound();
      }
      if (error.response.status === 409) {
        throw FileSystemError.FileExists();
      }
      const code = error.response.status.toString();
      const text = error.response.statusText;
      throw new Error(`Jupyter contents error: ${code} ${text}`);
    }
    throw error;
  }
}

/**
 * A decorator which can apply to functions with a {@link Uri} as the first
 * argument so we don't unnecessarily round-trip to the server for files we know
 * VS Code looks for, which we don't have.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function skipVsCodeFiles<T extends (uri: Uri, ...args: any[]) => unknown>(
  _target: unknown,
  _propertyKey: string,
  descriptor: TypedPropertyDescriptor<T>,
) {
  const originalMethod = descriptor.value;
  if (!originalMethod) {
    return descriptor;
  }
  descriptor.value = function (this: unknown, uri: Uri, ...args: unknown[]) {
    // The .vscode folder itself or a file in it.
    if (uri.path === '/.vscode' || uri.path.startsWith('/.vscode/')) {
      throw FileSystemError.FileNotFound(uri);
    }
    return originalMethod.apply(this, [uri, ...args]);
  } as T;
  return descriptor;
}
