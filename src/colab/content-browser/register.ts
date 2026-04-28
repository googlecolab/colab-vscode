/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Disposable } from 'vscode';
import { registerCommand } from '../../common/commands';
import { ResourceTreeProvider } from '../resource-monitor/resource-tree';
import {
  deleteFile,
  download,
  newFile,
  newFolder,
  renameFile,
} from './commands';
import { ContentItem } from './content-item';
import { ContentTreeProvider } from './content-tree';

/** Dependencies required to register content-browser commands. */
export interface ContentBrowserCommandDeps {
  /** Used by the refresh-content-view command. */
  readonly contentTree: ContentTreeProvider;
  /** Used by the refresh-resource-view command. */
  readonly resourceTree: ResourceTreeProvider;
}

/**
 * Registers the content-browser tree view commands (refresh views and the
 * file CRUD commands).
 *
 * @param vs - The VS Code API instance.
 * @param deps - The tree providers the commands operate on.
 * @returns The disposables for each registered command.
 */
export function registerContentBrowserCommands(
  vs: typeof vscode,
  deps: ContentBrowserCommandDeps,
): Disposable[] {
  const { contentTree, resourceTree } = deps;
  return [
    registerCommand(vs, 'colab.refreshServerContentView', () => {
      contentTree.refresh();
    }),
    registerCommand(vs, 'colab.refreshServerResourceView', () => {
      resourceTree.refresh();
    }),
    registerCommand(vs, 'colab.newFile', (item: ContentItem) => {
      void newFile(vs, item);
    }),
    registerCommand(vs, 'colab.newFolder', (item: ContentItem) => {
      void newFolder(vs, item);
    }),
    registerCommand(vs, 'colab.download', (item: ContentItem) => {
      void download(vs, item);
    }),
    registerCommand(vs, 'colab.renameFile', (item: ContentItem) => {
      void renameFile(vs, item);
    }),
    registerCommand(vs, 'colab.deleteFile', (item: ContentItem) => {
      void deleteFile(vs, item);
    }),
  ];
}
