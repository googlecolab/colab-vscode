/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileType, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';

/**
 * A TreeItem representing a file, folder or the server itself.
 *
 * {@link TreeItem.contextValue} is set as follows:
 *
 * - 'server' for the server
 * - 'folder' for directories
 * - 'file' for files
 */
export class ServerItem extends TreeItem {
  constructor(
    readonly endpoint: string,
    label: string,
    readonly type: FileType,
    readonly uri: Uri,
  ) {
    super(label);

    this.id = uri.toString();

    // Use built-in resource URI for automatic file icons.
    this.resourceUri = uri;

    this.collapsibleState =
      type === FileType.Directory
        ? TreeItemCollapsibleState.Collapsed
        : TreeItemCollapsibleState.None;

    // Open the file on click.
    if (type === FileType.File) {
      this.command = {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [uri],
      };
    }
    if (uri.path === '/') {
      this.contextValue = 'server';
    } else {
      this.contextValue = type === FileType.Directory ? 'folder' : 'file';
    }
  }
}
