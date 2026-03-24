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
import { ContentItem } from './content-item';

/**
 * A {@link TreeDataProvider} for the server content browser view.
 *
 * Handles displaying servers and their file/folder structure. Reacts to
 * authorization state, assignment and file changes.
 */
export class ContentTreeProvider
  implements TreeDataProvider<ContentItem>, Disposable
{
  private changeEmitter = new EventEmitter<
    ContentItem | ContentItem[] | undefined
  >();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly authListener: Disposable;
  private readonly assignmentListener: Disposable;
  private readonly fileListener: Disposable;
  // VS Code uses referential equality to identify TreeItems, so we need to
  // cache them to ensure we event with the same instance as returned by
  // `getChildren`.
  private contentItemsByUri = new Map<string, ContentItem>();
  private isAuthorized = false;
  private isDisposed = false;

  /**
   * Initializes a new instance.
   *
   * @param assignments - The assignment manager instance.
   * @param authChange - The Auth change event.
   * @param assignmentChange - The Assignment change event.
   * @param fileChange - The File change event.
   * @param scheme - The URI scheme to use for the tree items.
   */
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

  /**
   * Disposes of the provider, cleaning up any resources.
   */
  dispose() {
    if (this.isDisposed) {
      return;
    }
    this.authListener.dispose();
    this.assignmentListener.dispose();
    this.fileListener.dispose();
    this.contentItemsByUri.clear();
    this.isDisposed = true;
  }

  /**
   * Refreshes the tree view, optionally for specific items.
   */
  refresh(): void {
    this.guardDisposed();
    this.contentItemsByUri.clear();
    this.changeEmitter.fire(undefined);
  }

  /**
   * Gets the {@link TreeItem} representation of a {@link ContentItem} for the
   * tree view.
   *
   * @param element - The {@link ContentItem} element.
   * @returns The {@link TreeItem} representation of the {@link ContentItem}.
   */
  getTreeItem(element: ContentItem): TreeItem {
    this.guardDisposed();
    return element;
  }

  /**
   * Gets the children of a {@link ContentItem} for the tree view.
   *
   * @param element - The {@link ContentItem} element.
   * @returns A promise that resolves to an array of {@link ContentItem}
   * children.
   */
  async getChildren(element?: ContentItem): Promise<ContentItem[]> {
    this.guardDisposed();
    if (!this.isAuthorized) {
      return [];
    }
    if (element?.uri) {
      return this.getContentItems(element.uri);
    }
    const servers = await this.assignments.getServers('extension');
    const items: ContentItem[] = [];
    for (const s of servers) {
      const rootUri = Uri.parse(`${this.scheme}://${s.endpoint}/content`);
      const uriString = rootUri.toString();
      const existing = this.contentItemsByUri.get(uriString);
      if (existing) {
        items.push(existing);
        continue;
      }

      const root = new ContentItem(
        s.endpoint,
        s.label,
        FileType.Directory,
        rootUri,
      );
      items.push(root);
      this.contentItemsByUri.set(uriString, root);
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
    const items = new Set<ContentItem>();
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
      const item = this.contentItemsByUri.get(parentUri.toString());
      if (item) {
        items.add(item);
      }
    }
    if (items.size > 0) {
      this.changeEmitter.fire(Array.from(items));
    }
  }

  private async getContentItems(uri: Uri): Promise<ContentItem[]> {
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
        const existing = this.contentItemsByUri.get(uriString);
        if (existing?.type === type) {
          return existing;
        }

        const item = new ContentItem(uri.authority, name, type, itemUri);
        this.contentItemsByUri.set(uriString, item);
        return item;
      });
    } catch (error) {
      log.error(`Error reading directory: ${uri.toString()}`, error);
      return [];
    }
  }

  private removeItemsRecursively(uriString: string) {
    this.contentItemsByUri.delete(uriString);
    // Also remove any children that might be in the cache.
    for (const key of this.contentItemsByUri.keys()) {
      if (key.startsWith(uriString + '/')) {
        this.contentItemsByUri.delete(key);
      }
    }
  }

  private guardDisposed() {
    if (this.isDisposed) {
      throw new Error(
        'ContentTreeProvider cannot be used after it has been disposed.',
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
