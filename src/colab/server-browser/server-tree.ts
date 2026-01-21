/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Disposable,
  Event,
  EventEmitter,
  FileChangeEvent,
  FileChangeType,
  FileType,
  TreeDataProvider,
  TreeItem,
  Uri,
  workspace,
} from 'vscode';
import { AuthChangeEvent } from '../../auth/auth-provider';
import { log } from '../../common/logging';
import {
  AssignmentChangeEvent,
  AssignmentManager,
} from '../../jupyter/assignments';
import { ServerItem } from './server-item';

/**
 * A TreeDataProvider for the server browser view.
 *
 * Handles displaying servers and their file/folder structure. Reacts to
 * authorization state, assignment and file changes.
 */
export class ServerTreeProvider
  implements TreeDataProvider<ServerItem>, Disposable
{
  private changeEmitter = new EventEmitter<
    ServerItem | ServerItem[] | undefined
  >();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly authListener: Disposable;
  private readonly assignmentListener: Disposable;
  private readonly fileListener: Disposable;
  // VS Code uses referential equality to identify TreeItems, so we need to
  // cache them to ensure we event with the same instance as returned by
  // `getChildren`.
  private serverItemsByUri = new Map<string, ServerItem>();
  private isAuthorized = false;
  private isDisposed = false;

  constructor(
    private readonly assignments: AssignmentManager,
    authChange: Event<AuthChangeEvent>,
    assignmentChange: Event<AssignmentChangeEvent>,
    fileChange: Event<FileChangeEvent[]>,
    private readonly scheme = 'colab',
  ) {
    this.authListener = authChange(this.handleAuthChange.bind(this));
    this.assignmentListener = assignmentChange(this.refresh.bind(this));
    this.fileListener = fileChange(this.handleFileChange.bind(this));
  }

  dispose() {
    if (this.isDisposed) {
      return;
    }
    this.authListener.dispose();
    this.assignmentListener.dispose();
    this.fileListener.dispose();
    this.serverItemsByUri.clear();
    this.isDisposed = true;
  }

  refresh(): void {
    this.guardDisposed();
    this.serverItemsByUri.clear();
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(element: ServerItem): TreeItem {
    this.guardDisposed();
    return element;
  }

  async getChildren(element?: ServerItem): Promise<ServerItem[]> {
    this.guardDisposed();
    if (!this.isAuthorized) {
      return [];
    }
    if (element?.uri) {
      return this.getServerItems(element.uri);
    }
    const servers = await this.assignments.getServers('extension');
    const items: ServerItem[] = [];
    for (const s of servers) {
      const rootUri = Uri.parse(`${this.scheme}://${s.endpoint}/content`);
      const uriString = rootUri.toString();
      const existing = this.serverItemsByUri.get(uriString);
      if (existing) {
        items.push(existing);
        continue;
      }

      const root = new ServerItem(
        s.endpoint,
        s.label,
        FileType.Directory,
        rootUri,
      );
      items.push(root);
      this.serverItemsByUri.set(uriString, root);
    }
    return items;
  }

  private handleAuthChange(e: AuthChangeEvent) {
    if (this.isAuthorized === e.hasValidSession) {
      return;
    }
    this.isAuthorized = e.hasValidSession;
    this.refresh();
  }

  private handleFileChange(events: FileChangeEvent[]) {
    const items = new Set<ServerItem>();
    for (const event of events) {
      if (event.type === FileChangeType.Changed) {
        // File mutations don't affect the tree structure.
        continue;
      }
      if (event.type === FileChangeType.Deleted) {
        this.removeItemsRecursively(event.uri.toString());
      }
      const parentUri = getParent(event.uri);
      if (!parentUri || parentUri.path === '/') {
        this.refresh();
        return;
      }
      const item = this.serverItemsByUri.get(parentUri.toString());
      if (item) {
        items.add(item);
      }
    }
    if (items.size > 0) {
      this.changeEmitter.fire(Array.from(items));
    }
  }

  private async getServerItems(uri: Uri): Promise<ServerItem[]> {
    try {
      const entries = await workspace.fs.readDirectory(uri);

      // Sort: Directories first, then alphabetical by name.
      entries.sort((a, b) => {
        const [aName, aType] = a;
        const [bName, bType] = b;
        if (aType !== bType) {
          return bType === FileType.Directory ? 1 : -1;
        }
        return aName.localeCompare(bName);
      });

      return entries.map(([name, type]) => {
        const itemUri = Uri.joinPath(uri, name);
        const uriString = itemUri.toString();
        const existing = this.serverItemsByUri.get(uriString);
        if (existing?.type === type) {
          return existing;
        }

        const item = new ServerItem(uri.authority, name, type, itemUri);
        this.serverItemsByUri.set(uriString, item);
        return item;
      });
    } catch (error) {
      log.error(`Error reading directory: ${uri.toString()}`, error);
      return [];
    }
  }

  private removeItemsRecursively(uriString: string) {
    this.serverItemsByUri.delete(uriString);
    // Also remove any children that might be in the cache.
    for (const key of this.serverItemsByUri.keys()) {
      if (key.startsWith(uriString + '/')) {
        this.serverItemsByUri.delete(key);
      }
    }
  }

  private guardDisposed() {
    if (this.isDisposed) {
      throw new Error(
        'ServerTreeProvider cannot be used after it has been disposed.',
      );
    }
  }
}

function getParent(uri: Uri): Uri | undefined {
  if (uri.path === '/') {
    return undefined;
  }
  return Uri.joinPath(uri, '..');
}
