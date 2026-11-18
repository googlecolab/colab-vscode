/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdtemp, rename, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { Response } from 'node-fetch';
import vscode, { Uri } from 'vscode';
import { AssignmentManager } from '../../jupyter/assignments';

/** Downloads Colab files to destinations available through VS Code. */
export interface FileDownloader {
  /**
   * Downloads a remote file to a local destination.
   *
   * @param source - The Colab file URI.
   * @param destination - The destination URI.
   * @returns The number of bytes downloaded.
   */
  download(source: Uri, destination: Uri): Promise<number>;
}

/** Streams files from a Colab runtime through a temporary host file. */
export class StreamingFileDownloader implements FileDownloader {
  /**
   * Initializes a new downloader.
   *
   * @param vs - The VS Code API instance used for provider-backed destinations.
   * @param assignments - The manager used to find the source Colab server.
   */
  constructor(
    private readonly vs: typeof vscode,
    private readonly assignments: AssignmentManager,
  ) {}

  /**
   * Downloads a Colab file without buffering it as a Base64 string.
   *
   * @param source - The Colab file URI.
   * @param destination - The destination URI.
   * @returns The number of bytes downloaded.
   */
  async download(source: Uri, destination: Uri): Promise<number> {
    if (source.scheme !== 'colab') {
      throw new Error(`Unsupported source URI scheme: ${source.scheme}`);
    }

    const servers = await this.assignments.getServers('extension');
    const server = servers.find(
      (candidate) => candidate.id === source.authority,
    );
    if (!server) {
      throw new Error(`Colab server "${source.authority}" is not available`);
    }

    const fetchFile = server.connectionInformation.fetch;
    if (!fetchFile) {
      throw new Error('The Colab server does not support file downloads');
    }

    const response = (await fetchFile(
      buildFileUrl(server.connectionInformation.baseUrl, source.path),
    )) as unknown as Response;
    if (!response.ok) {
      throw new Error(
        `Download request failed: ${response.status.toString()} ${response.statusText}`.trim(),
      );
    }

    const providerDestination = destination.scheme !== 'file';
    const stagingDirectory = providerDestination
      ? await mkdtemp(join(tmpdir(), 'colab-download-'))
      : undefined;
    const temporaryName = `.colab-${randomUUID()}.tmp`;
    const temporaryPath = join(
      stagingDirectory ?? dirname(destination.fsPath),
      temporaryName,
    );
    const providerTemporary = providerDestination
      ? this.vs.Uri.joinPath(destination, '..', temporaryName)
      : undefined;
    let downloadedBytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        downloadedBytes += chunk.byteLength;
        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        Buffer.isBuffer(response.body) || response.body instanceof Uint8Array
          ? Readable.from([response.body])
          : (response.body as unknown as NodeJS.ReadableStream),
        counter,
        createWriteStream(temporaryPath, { flags: 'wx' }),
      );
      if (providerTemporary) {
        await this.vs.workspace.fs.copy(
          this.vs.Uri.file(temporaryPath),
          providerTemporary,
          { overwrite: false },
        );
        await this.finalizeProviderDownload(providerTemporary, destination);
      } else {
        await rename(temporaryPath, destination.fsPath);
      }
      return downloadedBytes;
    } finally {
      await rm(temporaryPath, { force: true });
      if (providerTemporary) {
        try {
          await this.vs.workspace.fs.delete(providerTemporary);
        } catch {
          // A successful rename already removed the staging URI.
        }
      }
      if (stagingDirectory) {
        await rm(stagingDirectory, { recursive: true, force: true });
      }
    }
  }

  private async finalizeProviderDownload(
    temporary: Uri,
    destination: Uri,
  ): Promise<void> {
    let destinationExists = false;
    try {
      const stat = await this.vs.workspace.fs.stat(destination);
      if (stat.type & this.vs.FileType.Directory) {
        throw this.vs.FileSystemError.FileIsADirectory(destination);
      }
      destinationExists = true;
    } catch (error) {
      if ((error as { code?: string }).code !== 'FileNotFound') {
        throw error;
      }
    }

    if (!destinationExists) {
      await this.vs.workspace.fs.rename(temporary, destination, {
        overwrite: false,
      });
      return;
    }

    const backup = this.vs.Uri.joinPath(
      destination,
      '..',
      `.colab-backup-${randomUUID()}.tmp`,
    );
    await this.vs.workspace.fs.rename(destination, backup, {
      overwrite: false,
    });
    try {
      await this.vs.workspace.fs.rename(temporary, destination, {
        overwrite: false,
      });
    } catch (error) {
      try {
        await this.vs.workspace.fs.rename(backup, destination, {
          overwrite: false,
        });
      } catch {
        throw new Error(
          `Download finalization failed; the original file is preserved at ${backup.toString()}`,
          { cause: error },
        );
      }
      throw error;
    }
    try {
      await this.vs.workspace.fs.delete(backup);
    } catch (error) {
      throw new Error(
        `Download completed at ${destination.toString()}, but its backup could not be removed from ${backup.toString()}`,
        { cause: error },
      );
    }
  }
}

function buildFileUrl(baseUrl: Uri, filePath: string): string {
  const url = new URL(baseUrl.toString());
  const basePath = url.pathname.endsWith('/')
    ? url.pathname
    : `${url.pathname}/`;
  const encodedPath = filePath
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
  url.pathname = `${basePath}files/${encodedPath}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}
