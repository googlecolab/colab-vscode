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
import { log } from '../../common/logging';
import { OverrunPolicy, SequentialTaskRunner } from '../../common/task-runner';
import {
  AssignmentChangeEvent,
  AssignmentManager,
} from '../../jupyter/assignments';
import { ColabAssignedServer } from '../../jupyter/servers';
import { ExperimentFlag } from '../api';
import { ColabClient } from '../client';
import { getFlag } from '../experiment-state';
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
  private readonly refreshRunner?: SequentialTaskRunner;
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

    // Read poll interval from experiment config once at runner initialization.
    const refreshIntervalMs = getFlag(ExperimentFlag.ResourcePollIntervalMs);
    if (typeof refreshIntervalMs === 'number') {
      this.refreshRunner = new SequentialTaskRunner(
        {
          intervalTimeoutMs: Math.max(
            refreshIntervalMs,
            MIN_REFRESH_INTERVAL_MS,
          ),
          taskTimeoutMs: REFRESH_TIMEOUT_MS,
          abandonGraceMs: 0, // Nothing to cleanup, abandon immediately.
        },
        {
          name: ResourceTreeProvider.name,
          run: () => {
            this.refresh.call(this);
            return Promise.resolve();
          },
        },
        OverrunPolicy.AllowToComplete,
      );
    }
  }

  /**
   * Disposes of the provider, cleaning up any resources.
   */
  dispose() {
    if (this.isDisposed) {
      return;
    }
    this.refreshRunner?.dispose();
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
   * Each call returns its own snapshot of the current state, intentionally not
   * coalesced or cancelled when other calls overlap.
   * {@link TreeDataProvider.onDidChangeTreeData} is the mechanism that signals
   * VS Code to re-query for fresh data.
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

    // If a resource element is passed in.
    if (element) {
      // All resource items other than 'server' have no children.
      if (element.type !== ResourceType.SERVER) {
        return [];
      }
      // Otherwise, return corresponding cached resources.
      return this.resourceItemsByEndpoint.get(element.endpoint) ?? [];
    }

    // If no element is passed (requested at root level), fetch and return
    // all servers as root items.
    return this.getRootChildren();
  }

  /**
   * Fetches and caches all servers and their resources.
   *
   * @returns A promise that resolves to an array of {@link ResourceItem}
   * representing servers.
   */
  private async getRootChildren(): Promise<ResourceItem[]> {
    const servers = await this.assignments.getServers('extension');
    return Promise.all(
      servers.map(async (s) => {
        try {
          await this.fetchAndCacheResourceItems(s);
        } catch (e: unknown) {
          const errLabel = 'Failed to fetch resources';
          log.error(`${errLabel}:`, e);
          // Add an error item when fetch failed
          this.resourceItemsByEndpoint.set(s.endpoint, [
            new ResourceItem(s.endpoint, errLabel, ResourceType.ERROR),
          ]);
        }
        return ResourceItem.fromServer(s);
      }),
    );
  }

  private async fetchAndCacheResourceItems(
    server: ColabAssignedServer,
  ): Promise<void> {
    const endpoint = server.endpoint;
    const resources = await this.client.getResources(server);
    const resourceItems: ResourceItem[] = [];
    resourceItems.push(ResourceItem.fromMemory(endpoint, resources.memory));
    if (resources.gpus.length > 0) {
      resourceItems.push(ResourceItem.fromGpus(endpoint, resources.gpus));
    }
    for (const disk of resources.disks) {
      resourceItems.push(ResourceItem.fromDisk(endpoint, disk));
    }
    this.resourceItemsByEndpoint.set(endpoint, resourceItems);
  }

  private guardDisposed() {
    if (this.isDisposed) {
      throw new Error(
        'Cannot use ResourceTreeProvider after it has been disposed',
      );
    }
  }

  private handleAuthChange(e: AuthChangeEvent) {
    if (this.isAuthorized === e.hasValidSession) {
      return;
    }
    this.isAuthorized = e.hasValidSession;
    this.refresh();
    if (this.isAuthorized) {
      this.refreshRunner?.start();
    } else {
      this.refreshRunner?.stop();
    }
  }
}

// The refresh() call should be instant, but giving it a 2s timeout to be safe.
const REFRESH_TIMEOUT_MS = 2000; // 2 seconds.
const MIN_REFRESH_INTERVAL_MS = 5000; // 5 seconds.
