/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import { TreeItemCollapsibleState, Uri } from 'vscode';
import { FileType } from '../../test/helpers/vscode';
import { ContentItem } from './content-item';

describe('ContentItem', () => {
  it('constructs servers', () => {
    const serverUri = Uri.parse('colab://m-s-foo/content');

    const item = new ContentItem(
      'm-s-foo',
      'Foo Server',
      FileType.Directory,
      serverUri,
    );

    expect(item).to.deep.equal({
      id: 'colab://m-s-foo/content',
      endpoint: 'm-s-foo',
      type: FileType.Directory,
      uri: serverUri,
      resourceUri: serverUri,
      label: 'Foo Server',
      collapsibleState: TreeItemCollapsibleState.Collapsed,
      contextValue: 'server',
    });
  });

  it('constructs files', () => {
    const serverUri = Uri.parse('colab://m-s-foo/bar.txt');

    const item = new ContentItem(
      'm-s-foo',
      'Foo Server',
      FileType.File,
      serverUri,
    );

    expect(item).to.deep.equal({
      id: 'colab://m-s-foo/bar.txt',
      endpoint: 'm-s-foo',
      type: FileType.File,
      uri: serverUri,
      resourceUri: serverUri,
      label: 'Foo Server',
      collapsibleState: TreeItemCollapsibleState.None,
      contextValue: 'file',
      command: {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [serverUri],
      },
    });
  });

  it('constructs folders', () => {
    const serverUri = Uri.parse('colab://m-s-foo/bar');

    const item = new ContentItem(
      'm-s-foo',
      'Foo Server',
      FileType.Directory,
      serverUri,
    );

    expect(item).to.deep.equal({
      id: 'colab://m-s-foo/bar',
      endpoint: 'm-s-foo',
      type: FileType.Directory,
      uri: serverUri,
      resourceUri: serverUri,
      label: 'Foo Server',
      collapsibleState: TreeItemCollapsibleState.Collapsed,
      contextValue: 'folder',
    });
  });
});
