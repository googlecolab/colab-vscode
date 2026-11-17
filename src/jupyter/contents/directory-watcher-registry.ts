/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Disposable, FileChangeEvent, Uri } from 'vscode';
import { ContentsApi } from '../client/generated';
import { DirectoryPoller } from './directory-poller';
import { JupyterConnectionManager } from './sessions';

interface WatchEntry {
  readonly poller: DirectoryPoller;
  readonly serverId: string;
  refCount: number;
}

/**
 * Shares one {@link DirectoryPoller} per watched directory.
 *
 * A poller is dropped when its last watch is released, its directory is gone,
 * or its server connection is revoked. Polling is suspended while the window
 * is unfocused.
 */
export class DirectoryWatcherRegistry implements Disposable {
  private readonly entries = new Map<string, WatchEntry>();
  private readonly revokeListener: Disposable;
  private readonly windowListener: Disposable;
  private isDisposed = false;

  /**
   * Initializes a new instance.
   *
   * @param vs - The VS Code API instance.
   * @param jupyterConnections - The Jupyter connections manager.
   * @param onDidChangeFile - Receives changes from watched directories.
   */
  constructor(
    private readonly vs: typeof vscode,
    private readonly jupyterConnections: JupyterConnectionManager,
    private readonly onDidChangeFile: (events: FileChangeEvent[]) => void,
  ) {
    this.revokeListener = jupyterConnections.onDidRevokeConnections(
      (serverIds) => {
        for (const [key, entry] of this.entries) {
          if (serverIds.includes(entry.serverId)) {
            this.remove(key, entry);
          }
        }
      },
    );
    this.windowListener = vs.window.onDidChangeWindowState(({ focused }) => {
      for (const { poller } of this.entries.values()) {
        if (focused) {
          poller.resume();
        } else {
          poller.suspend();
        }
      }
    });
  }

  /** Stops all polling and removes the connection and focus listeners. */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    this.revokeListener.dispose();
    this.windowListener.dispose();
    for (const { poller } of this.entries.values()) {
      poller.dispose();
    }
    this.entries.clear();
  }

  /**
   * Watches a directory, sharing its poller with other watches of the same URI.
   *
   * @param uri - The directory to watch.
   * @returns A handle that releases this watch. Disposing it again is a no-op.
   */
  watch(uri: Uri): Disposable {
    this.guardDisposed();
    const key = uri.toString();
    const entry = this.entries.get(key) ?? this.add(key, uri);
    entry.refCount++;
    let isReleased = false;
    return {
      dispose: () => {
        if (isReleased) {
          return;
        }
        isReleased = true;
        entry.refCount--;
        if (entry.refCount === 0) {
          this.remove(key, entry);
        }
      },
    };
  }

  private guardDisposed(): void {
    if (this.isDisposed) {
      throw new Error(
        'Cannot use DirectoryWatcherRegistry after it has been disposed',
      );
    }
  }

  private add(key: string, uri: Uri): WatchEntry {
    const entry: WatchEntry = {
      serverId: uri.authority,
      refCount: 0,
      poller: new DirectoryPoller({
        vs: this.vs,
        uri,
        getClient: () => this.getClient(uri.authority),
        onDidChangeFile: this.onDidChangeFile,
        onDidTerminate: () => {
          this.remove(key, entry);
        },
      }),
    };
    this.entries.set(key, entry);
    if (!this.vs.window.state.focused) {
      entry.poller.suspend();
    }
    return entry;
  }

  /**
   * Disposes the entry's poller and drops the entry unless a newer watch has
   * already replaced it, since handles of a dropped entry can outlive it.
   *
   * @param key - The watched URI string.
   * @param entry - The entry to remove.
   */
  private remove(key: string, entry: WatchEntry): void {
    if (this.entries.get(key) === entry) {
      this.entries.delete(key);
    }
    entry.poller.dispose();
  }

  private async getClient(serverId: string): Promise<ContentsApi | undefined> {
    try {
      return await this.jupyterConnections.get(serverId);
    } catch {
      // Only thrown while signed out, and signing out revokes these pollers.
      return undefined;
    }
  }
}
