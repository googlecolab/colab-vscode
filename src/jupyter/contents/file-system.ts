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
import { z } from 'zod';
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
  ContentsGetFormatEnum,
  ContentsGetTypeEnum,
  ContentsSaveRequest,
  FetchError,
  ResponseError,
} from '../client/generated';
import { ColabAssignedServer } from '../servers';
import { JupyterConnectionManager } from './sessions';

/**
 * Files larger than this are uploaded in chunks of this size, using the
 * Contents API's chunked save, rather than in a single request. This keeps each
 * request well below the Colab runtime proxy's request size limit, and matches
 * the chunk size used by the Colab web client.
 */
export const UPLOAD_CHUNK_SIZE_BYTES = 1024 * 1024;

/**
 * How many times a failed chunk upload is retried before the upload fails.
 */
export const UPLOAD_CHUNK_MAX_RETRIES = 3;

/**
 * Delay before the first retry of a failed chunk upload. Doubles with each
 * subsequent retry.
 */
export const UPLOAD_CHUNK_RETRY_BASE_DELAY_MS = 500;

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
    this.changeEmitter = new vs.EventEmitter<FileChangeEvent[]>();
    this.onDidChangeFile = this.changeEmitter.event;
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
   * All calls are no-ops.
   *
   * The Jupyter Server REST API does not support watching and Colab has no
   * socket-based implementation that can easily be used.
   *
   * In the future we may consider adding time-based polling to fire events for
   * files/directories that have been `watch`-ed.
   *
   * @param uri - The URI of the resource.
   * @param _options - Configuration options for the operation.
   * @returns A no-op disposable.
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
    const path = uri.path;
    try {
      const client = await this.getOrCreateClient(uri);
      const content = await client.get({ path, content: 0 });
      return toFileStat(this.vs, content);
    } catch (error: unknown) {
      return await this.handleError(error);
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
      return await this.handleError(error);
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
      await this.handleError(error);
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
      return await this.handleError(error);
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

      // A file that fits in one chunk is saved in a single, non-chunked
      // request. Chunked saves need at least two requests: chunk 1 truncates
      // the file, but a lone chunk -1 would append to an existing file instead.
      if (content.byteLength <= UPLOAD_CHUNK_SIZE_BYTES) {
        await client.save({ path, model: toSaveRequest(content) });
      } else {
        await this.saveInChunks(client, uri, content, exists);
      }

      const eventType = exists
        ? this.vs.FileChangeType.Changed
        : this.vs.FileChangeType.Created;
      this.changeEmitter.fire([{ type: eventType, uri }]);
    } catch (error: unknown) {
      await this.handleError(error);
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
      await this.handleError(error);
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
      await this.handleError(error);
    }
  }

  private guardDisposed() {
    if (this.isDisposed) {
      throw new Error(
        'Cannot use ContentsFileSystemProvider after it has been disposed',
      );
    }
  }

  private async getOrCreateClient(uri: Uri): Promise<ContentsApi> {
    const serverId = uri.authority;
    try {
      const client = await this.jupyterConnections.getOrCreate(serverId);
      return client;
    } catch (e: unknown) {
      log.error(`Unable to get or create Jupyter client for ${serverId}`, e);
      // This should only happen if a file-system call was made to a server
      // which hasn't been mounted.
      throw this.vs.FileSystemError.Unavailable(serverId);
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

  /**
   * Uploads `content` with the Contents API's chunked save.
   *
   * The chunks go to a temporary file next to the target, which is moved over
   * the target once complete, so a failed upload never touches an existing
   * file. Within the temporary file, the first chunk creates or truncates it,
   * later chunks append to it, and the last one is sent as chunk `-1` to
   * complete the save.
   *
   * A chunk that fails with a network error or a 5xx response is retried up to
   * {@link UPLOAD_CHUNK_MAX_RETRIES} times with exponential backoff. Since a
   * failed append may have been partially written, each retry first reads the
   * temporary file's size on the server and resumes from that byte.
   *
   * If the upload still fails, the error is rethrown and the temporary file is
   * left in place; the next upload of the same file overwrites it.
   *
   * @param client - The Contents API client for the server.
   * @param uri - The file being written.
   * @param content - The full file content. Must be larger than one chunk.
   * @param existed - Whether the file existed before this write.
   */
  private async saveInChunks(
    client: ContentsApi,
    uri: Uri,
    content: Uint8Array,
    existed: boolean,
  ): Promise<void> {
    const tempPath = partialPath(uri.path);
    const totalBytes = content.byteLength;
    const start = Date.now();
    log.debug(
      `Uploading ${uri.toString()} (${String(totalBytes)} bytes) via ${tempPath} in chunks of ${String(UPLOAD_CHUNK_SIZE_BYTES)} bytes`,
    );

    // The number of bytes the server is known to have.
    let offset = 0;
    let chunk = 1;
    // Retries of the current chunk, and of the whole upload.
    let retries = 0;
    let totalRetries = 0;
    // Whether the server's file size must be re-read before the next append,
    // because the previous one failed and may have been partially written.
    let resync = false;
    try {
      while (offset < totalBytes) {
        // A large upload spans many requests; stop if the provider was
        // disposed part-way through.
        this.guardDisposed();
        try {
          if (resync) {
            offset = await this.resumeOffset(
              client,
              tempPath,
              offset,
              totalBytes,
            );
            resync = false;
            log.debug(
              `Resuming upload of ${uri.toString()} at byte ${String(offset)} of ${String(totalBytes)}`,
            );
            continue;
          }
          const end = Math.min(offset + UPLOAD_CHUNK_SIZE_BYTES, totalBytes);
          await client.save({
            path: tempPath,
            model: {
              ...toSaveRequest(content.subarray(offset, end)),
              chunk: end === totalBytes ? -1 : chunk,
            },
          });
          log.trace(
            `Uploaded bytes ${String(offset)}-${String(end)} of ${uri.toString()} (chunk ${String(chunk)})`,
          );
          offset = end;
          chunk++;
          retries = 0;
        } catch (error: unknown) {
          if (!shouldRetry(error) || retries >= UPLOAD_CHUNK_MAX_RETRIES) {
            throw error;
          }
          retries++;
          totalRetries++;
          const delay = UPLOAD_CHUNK_RETRY_BASE_DELAY_MS * 2 ** (retries - 1);
          log.warn(
            `Chunk ${String(chunk)} of ${uri.toString()} failed, retrying in ${String(delay)} ms (${String(retries)}/${String(UPLOAD_CHUNK_MAX_RETRIES)})`,
            error,
          );
          await sleep(delay);
          // Chunk 1 is written atomically and truncates the file, so it can
          // simply be sent again. Appends may have been partially written.
          resync = chunk > 1;
        }
      }
      this.guardDisposed();
      await this.replaceWith(client, uri.path, tempPath, existed);
    } catch (error: unknown) {
      log.warn(
        `Upload of ${uri.toString()} failed at byte ${String(offset)} of ${String(totalBytes)}; the partial upload is left at ${tempPath}`,
        error,
      );
      throw error;
    }

    log.debug(
      `Uploaded ${uri.toString()} (${String(totalBytes)} bytes) in ${String(Date.now() - start)} ms with ${String(totalRetries)} retries`,
    );
  }

  /**
   * Moves a completed upload over its target.
   *
   * Jupyter's rename refuses to overwrite, so an existing target is deleted
   * first. Between the two requests the target briefly doesn't exist.
   *
   * @param client - The Contents API client for the server.
   * @param path - The target path.
   * @param tempPath - The path of the completed upload.
   * @param existed - Whether the target existed before this write.
   */
  private async replaceWith(
    client: ContentsApi,
    path: string,
    tempPath: string,
    existed: boolean,
  ): Promise<void> {
    if (existed) {
      try {
        await client.delete({ path });
      } catch (error: unknown) {
        // Something else may have removed it since; that's fine.
        if (
          !(error instanceof ResponseError && error.response.status === 404)
        ) {
          throw error;
        }
      }
    }
    await client.rename({ path: tempPath, rename: { path } });
  }

  /**
   * Determines where to resume a chunked upload after a failed append.
   *
   * @param client - The Contents API client for the server.
   * @param path - The path of the file being written.
   * @param offset - The number of bytes the server had before the failed
   * append.
   * @param totalBytes - The size of the complete file.
   * @returns The number of bytes the server now has, which is where the upload
   * resumes.
   * @throws Error when the server's file size can't have resulted from the
   * failed append, which means the file was changed by something other than
   * this upload.
   */
  private async resumeOffset(
    client: ContentsApi,
    path: string,
    offset: number,
    totalBytes: number,
  ): Promise<number> {
    const end = Math.min(offset + UPLOAD_CHUNK_SIZE_BYTES, totalBytes);
    const { size } = await client.get({ path, content: 0 });
    if (size === undefined || size < offset || size > end) {
      throw new Error(
        `Cannot resume upload of ${path}: expected between ${String(offset)} and ${String(end)} bytes on the server, found ${String(size)}`,
      );
    }
    return size;
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
      this.jupyterConnections.drop(s.uri.authority, true);
    }
  }

  private removeWorkspaceFolders(serverIds: string[]): void {
    const currentFolders = this.vs.workspace.workspaceFolders;
    if (!currentFolders || currentFolders.length === 0) {
      return;
    }
    const foldersToKeep = currentFolders
      .filter(
        (f) =>
          !(f.uri.scheme === 'colab' && serverIds.includes(f.uri.authority)),
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

  /**
   * Converts a Contents API error into the error to surface to VS Code, and
   * throws it. It always throws; it is async only to read the error response
   * body. Callers that return a value must `return await` it, since TypeScript
   * doesn't treat awaiting a `Promise<never>` as ending the function.
   *
   * @param error - The error thrown by the Contents API client.
   */
  private async handleError(error: unknown): Promise<never> {
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
      const detail =
        (await readJupyterErrorMessage(error.response)) ??
        error.response.statusText;
      throw new Error(`Jupyter contents error: ${code} ${detail}`);
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
}

/**
 * The body of a Jupyter Server API error response. `reason` is `null` for
 * errors that aren't `HTTPError`s.
 */
const JupyterErrorSchema = z.object({
  message: z.string().min(1),
  // Optional context; an unexpected value shouldn't cost us the message.
  reason: z.string().nullish().catch(undefined),
});

/**
 * Reads the error message from a Jupyter Server error response.
 *
 * @param response - The error response.
 * @returns The message, with the reason appended when present, or `undefined`
 * if the body is empty, isn't JSON or has no message (e.g. when the request was
 * rejected by a proxy before it reached Jupyter).
 */
async function readJupyterErrorMessage(
  response: Response,
): Promise<string | undefined> {
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return undefined;
  }
  const parsed = JupyterErrorSchema.safeParse(body);
  if (!parsed.success) {
    return undefined;
  }
  const { message, reason } = parsed.data;
  return reason ? `${message} (${reason})` : message;
}

/**
 * Builds the path of the temporary file a chunked upload writes to before it
 * is moved over `path`. It sits next to the target so the move is a rename
 * within one directory, and has a fixed name so a partial upload left by a
 * failed attempt is overwritten by the next one rather than piling up. It must
 * not start with a dot, since Jupyter refuses to write hidden files unless
 * configured to allow them.
 *
 * @param path - The path of the file being uploaded.
 * @returns The temporary file's path, e.g. `/content/foo.bin.partial`.
 */
export function partialPath(path: string): string {
  return `${path}.partial`;
}

/**
 * Whether a failed Contents API request may succeed if retried: network errors
 * and 5xx responses.
 *
 * @param error - The error thrown by the Contents API client.
 * @returns True if the request should be retried.
 */
function shouldRetry(error: unknown): boolean {
  if (error instanceof FetchError) {
    return true;
  }
  return error instanceof ResponseError && error.response.status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Builds a Contents API save request for a file with the given bytes.
 *
 * @param bytes - The file content, or one chunk of it.
 * @returns The save request, with the content base64-encoded.
 */
function toSaveRequest(bytes: Uint8Array): ContentsSaveRequest {
  return {
    // Wrap the existing memory rather than copying it.
    content: Buffer.from(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).toString('base64'),
    format: 'base64',
    type: ContentsGetTypeEnum.File,
  };
}
