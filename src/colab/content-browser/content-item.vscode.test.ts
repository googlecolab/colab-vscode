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
    const serverId = 'r-abc123';
    const serverUri = Uri.parse(`colab://${serverId}/content`);

    const item = new ContentItem(
      serverId,
      'Foo Server',
      FileType.Directory,
      serverUri,
    );

    expect(item).to.deep.equal({
      id: `colab://${serverId}/content`,
      serverId,
      type: FileType.Directory,
      uri: serverUri,
      resourceUri: serverUri,
      label: 'Foo Server',
      collapsibleState: TreeItemCollapsibleState.Collapsed,
      contextValue: 'server',
    });
  });

  it('constructs files', () => {
    const serverId = 'r-abc123';
    const serverUri = Uri.parse(`colab://${serverId}/bar.txt`);

    const item = new ContentItem(
      serverId,
      'Foo Server',
      FileType.File,
      serverUri,
    );

    expect(item).to.deep.equal({
      id: `colab://${serverId}/bar.txt`,
      serverId,
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
    const serverId = 'r-abc123';
    const serverUri = Uri.parse(`colab://${serverId}/bar`);

    const item = new ContentItem(
      serverId,
      'Foo Server',
      FileType.Directory,
      serverUri,
    );

    expect(item).to.deep.equal({
      id: `colab://${serverId}/bar`,
      serverId,
      type: FileType.Directory,
      uri: serverUri,
      resourceUri: serverUri,
      label: 'Foo Server',
      collapsibleState: TreeItemCollapsibleState.Collapsed,
      contextValue: 'folder',
    });
  });
});
