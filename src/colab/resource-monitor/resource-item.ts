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
  /** The server itself, shown as the root of the tree. */
  SERVER = 'server',
  /** System RAM resource. */
  MEMORY = 'memory',
  /** Disk resource. */
  DISK = 'disk',
  /** GPU RAM resource, applicable for GPU accelerators only. */
  GPU = 'gpu',
  /** Represents a resource fetching error record. */
  ERROR = 'error',
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
    const used = bytesToGbString(usedBytes);
    const total = bytesToGbString(memory.totalBytes);
    const label = `System RAM: ${used} / ${total} GB`;
    const tooltip = asPercentUsed(usedBytes, memory.totalBytes);
    return new ResourceItem(endpoint, label, ResourceType.MEMORY, tooltip);
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
      if (diskName !== undefined) {
        diskSubLabel = ` [ ${diskName} ]`;
      }
    }
    const used = bytesToGbString(filesystem.usedBytes);
    const total = bytesToGbString(filesystem.totalBytes);
    const label = `Disk${diskSubLabel}: ${used} / ${total} GB`;
    const tooltip = asPercentUsed(filesystem.usedBytes, filesystem.totalBytes);
    return new ResourceItem(endpoint, label, ResourceType.DISK, tooltip);
  }

  /**
   * Creates a new instance of {@link ResourceItem} representing GPU usage.
   *
   * If multiple GPUs are present, their memory usage is aggregated into a
   * single item.
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
    const used = bytesToGbString(gpuUsage.memoryUsedBytes);
    const total = bytesToGbString(gpuUsage.memoryTotalBytes);
    const label = `GPU RAM: ${used} / ${total} GB`;
    const tooltip = asPercentUsed(
      gpuUsage.memoryUsedBytes,
      gpuUsage.memoryTotalBytes,
    );
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

function asPercentUsed(
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
