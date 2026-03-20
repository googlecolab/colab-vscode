/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ColabAssignedServer } from '../../jupyter/servers';
import { Disk, GpuInfo, Memory } from '../api';

/**
 * Types of resources that can be displayed in resource monitor tree view.
 */
export enum ResourceType {
  // The server itself, shown as the root of the tree.
  SERVER = 'server',
  // System RAM resource.
  RAM = 'ram',
  // Disk resource.
  DISK = 'disk',
  // GPU RAM resource, applicable for GPU accelerators only.
  GPU = 'gpu',
}

/**
 * A {@link TreeItem} representing a resource item or the server itself.
 */
export class ResourceItem extends TreeItem {
  override contextValue: ResourceType;

  /**
   * Creates a new instance of {@link ResourceItem} representing a Colab server.
   *
   * @param server - A Colab server instance.
   * @returns A {@link ResourceItem} instance for the given server.
   */
  static fromServer(server: ColabAssignedServer): ResourceItem {
    return new ResourceItem(server.endpoint, server.label, ResourceType.SERVER);
  }

  /**
   * Creates a new instance of {@link ResourceItem} representing memory usage.
   *
   * @param endpoint - The server endpoint URL.
   * @param memory - Colab server memory usage information.
   * @returns A {@link ResourceItem} instance representing memory usage.
   */
  static fromMemory(endpoint: string, memory: Memory): ResourceItem {
    const usedBytes = memory.totalBytes - memory.freeBytes;
    const tooltip = percentUsedString(usedBytes, memory.totalBytes);
    const label = `System RAM: ${bytesToGbString(usedBytes)} / ${bytesToGbString(memory.totalBytes)} GB`;
    return new ResourceItem(endpoint, label, ResourceType.RAM, tooltip);
  }

  /**
   * Creates a new instance of {@link ResourceItem} representing disk usage.
   *
   * @param endpoint - The server endpoint URL.
   * @param disk - Colab server disk usage information.
   * @returns A {@link ResourceItem} instance representing disk usage.
   */
  static fromDisk(endpoint: string, disk: Disk): ResourceItem {
    const filesystem = disk.filesystem;
    let diskSubLabel = '';
    if (filesystem.label?.length && filesystem.label !== 'kernel') {
      const diskName = filesystem.label.split('/').pop();
      if (diskName) {
        diskSubLabel = ` [ ${diskName} ]`;
      }
    }
    const tooltip = percentUsedString(
      filesystem.usedBytes,
      filesystem.totalBytes,
    );
    const label = `Disk${diskSubLabel}: ${bytesToGbString(filesystem.usedBytes)} / ${bytesToGbString(filesystem.totalBytes)} GB`;
    return new ResourceItem(endpoint, label, ResourceType.DISK, tooltip);
  }

  /**
   * Creates a new instance of {@link ResourceItem} representing memory usage.
   *
   * @param endpoint - The server endpoint URL.
   * @param gpus - An array of GPU usage information.
   * @returns A {@link ResourceItem} instance representing GPU usage.
   */
  static fromGpus(endpoint: string, gpus: GpuInfo[]): ResourceItem {
    const gpuUsage = gpus.reduce(
      (acc, gpu) => ({
        memoryUsedBytes: acc.memoryUsedBytes + gpu.memoryUsedBytes,
        memoryTotalBytes: acc.memoryTotalBytes + gpu.memoryTotalBytes,
      }),
      { memoryUsedBytes: 0, memoryTotalBytes: 0 },
    );
    const tooltip = percentUsedString(
      gpuUsage.memoryUsedBytes,
      gpuUsage.memoryTotalBytes,
    );
    const label = `GPU RAM: ${bytesToGbString(gpuUsage.memoryUsedBytes)} / ${bytesToGbString(gpuUsage.memoryTotalBytes)} GB`;
    return new ResourceItem(endpoint, label, ResourceType.GPU, tooltip);
  }

  /**
   * Initializes a new {@link ResourceItem} instance.
   *
   * @param endpoint - The server endpoint URL.
   * @param label - The display label.
   * @param type - The item type.
   * @param tooltip - Optional tooltip text to show on hover.
   */
  constructor(
    readonly endpoint: string,
    label: string,
    readonly type: ResourceType,
    override tooltip?: string,
  ) {
    super(label);
    this.contextValue = type;

    if (type === ResourceType.SERVER) {
      this.collapsibleState = TreeItemCollapsibleState.Expanded;
    }
  }
}

function bytesToGbString(bytes: number, precision = 2): string {
  return (bytes / (1024 * 1024 * 1024)).toFixed(precision);
}

function percentUsedString(
  usedBytes: number,
  totalBytes: number,
  precision = 2,
): string | undefined {
  if (totalBytes === 0) {
    return undefined;
  }
  const percentUsed = (usedBytes / totalBytes) * 100;
  return `${percentUsed.toFixed(precision)}%`;
}
