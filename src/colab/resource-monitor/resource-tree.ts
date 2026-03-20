/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Disposable,
  Event,
  EventEmitter,
  TreeDataProvider,
  TreeItem,
} from 'vscode';
import { AuthChangeEvent } from '../../auth/auth-provider';
import {
  AssignmentChangeEvent,
  AssignmentManager,
} from '../../jupyter/assignments';
import { ColabClient } from '../client';
import { ResourceItem, ResourceType } from './resource-item';

/**
 * A {@link TreeDataProvider} for the server resource monitor view.
 *
 * Handles displaying servers and their resource items (i.e. RAM, Disk, GPU).
 * Reacts to authorization state and assignment changes.
 */
export class ResourceTreeProvider
  implements TreeDataProvider<ResourceItem>, Disposable
{
  private changeEmitter = new EventEmitter<
    ResourceItem | ResourceItem[] | undefined
  >();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  private readonly assignmentListener: Disposable;
  private readonly authListener: Disposable;
  // Cache of resource items by server endpoint to avoid invoking resource API
  // too frequently.
  private resourceItemsByEndpoint = new Map<string, ResourceItem[]>();
  private isAuthorized = false;
  private isDisposed = false;

  /**
   * Initializes a new instance.
   *
   * @param assignments - The assignment manager instance.
   * @param assignmentChange - The Assignment change event.
   * @param authChange - The Auth change event.
   * @param client - The API client instance.
   */
  constructor(
    private readonly assignments: AssignmentManager,
    assignmentChange: Event<AssignmentChangeEvent>,
    authChange: Event<AuthChangeEvent>,
    private readonly client: ColabClient,
  ) {
    this.assignmentListener = assignmentChange(this.refresh.bind(this));
    this.authListener = authChange(this.handleAuthChange.bind(this));
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
    this.resourceItemsByEndpoint.clear();
    this.isDisposed = true;
  }

  /**
   * Refreshes the tree view, optionally for specific items.
   */
  refresh(): void {
    this.guardDisposed();
    this.resourceItemsByEndpoint.clear();
    this.changeEmitter.fire(undefined);
  }

  /**
   * Gets the {@link TreeItem} representation of a {@link ResourceItem} for the
   * tree view.
   *
   * @param element - The {@link ResourceItem} element.
   * @returns The {@link TreeItem} representation of the {@link ResourceItem}.
   */
  getTreeItem(element: ResourceItem): TreeItem {
    this.guardDisposed();
    return element;
  }

  /**
   * Gets the children of a {@link ResourceItem} for the tree view.
   *
   * @param element - The {@link ResourceItem} element.
   * @returns A promise that resolves to an array of {@link ResourceItem}
   * children.
   */
  async getChildren(element?: ResourceItem): Promise<ResourceItem[]> {
    this.guardDisposed();
    if (!this.isAuthorized) {
      return [];
    }

    // If the item is a 'server', return corresponding cached resources.
    if (element?.type === ResourceType.SERVER) {
      return this.resourceItemsByEndpoint.get(element.endpoint) ?? [];
    }

    // All resource items other than 'server' have no children.
    if (element) {
      return [];
    }

    // If no element is passed (requested at root level), fetch and cache all
    // servers and their resources.
    const servers = await this.assignments.getServers('extension');
    const serverItems: ResourceItem[] = [];
    for (const s of servers) {
      const resources = await this.client.getResources(s);
      const resourceItems: ResourceItem[] = [];
      resourceItems.push(ResourceItem.fromMemory(s.endpoint, resources.memory));
      if (resources.gpus.length > 0) {
        resourceItems.push(ResourceItem.fromGpus(s.endpoint, resources.gpus));
      }
      for (const disk of resources.disks) {
        resourceItems.push(ResourceItem.fromDisk(s.endpoint, disk));
      }
      this.resourceItemsByEndpoint.set(s.endpoint, resourceItems);
      serverItems.push(ResourceItem.fromServer(s));
    }
    return serverItems;
  }

  private handleAuthChange(e: AuthChangeEvent) {
    if (this.isAuthorized === e.hasValidSession) {
      return;
    }
    this.isAuthorized = e.hasValidSession;
    this.refresh();
  }

  private guardDisposed() {
    if (this.isDisposed) {
      throw new Error(
        'ResourceTreeProvider cannot be used after it has been disposed.',
      );
    }
  }
}
