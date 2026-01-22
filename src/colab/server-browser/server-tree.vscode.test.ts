/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'crypto';
import { assert, expect } from 'chai';
import sinon, { SinonStubbedInstance } from 'sinon';
import vscode, {
  FileChangeEvent,
  FileType,
  TreeItemCollapsibleState,
  Uri,
} from 'vscode';
import { AuthChangeEvent } from '../../auth/auth-provider';
import {
  AssignmentChangeEvent,
  AssignmentManager,
} from '../../jupyter/assignments';
import { ContentsFileSystemProvider } from '../../jupyter/contents/file-system';
import { ColabAssignedServer } from '../../jupyter/servers';
import { TestEventEmitter } from '../../test/helpers/events';
import { Variant } from '../api';
import {
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
} from '../headers';
import { ServerItem } from './server-item';
import { ServerTreeProvider } from './server-tree';

const TEST_SCHEME = 'colab-test';

const DEFAULT_SERVER: ColabAssignedServer = {
  id: randomUUID(),
  label: 'Colab GPU A100',
  variant: Variant.GPU,
  accelerator: 'A100',
  endpoint: 'm-s-foo',
  connectionInformation: {
    baseUrl: Uri.parse('https://example.com'),
    token: '123',
    tokenExpiry: new Date(Date.now() + 1000 * 60 * 60),
    headers: {
      [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]: '123',
      [COLAB_CLIENT_AGENT_HEADER.key]: COLAB_CLIENT_AGENT_HEADER.value,
    },
  },
  dateAssigned: new Date(),
};

function buildTestUri(filePath: string): Uri {
  return Uri.parse(`${TEST_SCHEME}://${DEFAULT_SERVER.endpoint}/${filePath}`);
}

const DEFAULT_SERVER_URI = buildTestUri('content');

describe('ServerTreeProvider', () => {
  let assignmentStub: SinonStubbedInstance<AssignmentManager>;
  let authChangeEmitter: TestEventEmitter<AuthChangeEvent>;
  let assignmentChangeEmitter: TestEventEmitter<AssignmentChangeEvent>;
  let fileChangeEmitter: TestEventEmitter<FileChangeEvent[]>;
  let fsStub: SinonStubbedInstance<ContentsFileSystemProvider>;
  let tree: ServerTreeProvider;
  let fsDisposable: vscode.Disposable;

  enum AuthState {
    SIGNED_OUT,
    SIGNED_IN,
  }

  /**
   * Fires the auth change event emitter, simply toggling whether there's an
   * active session or not.
   */
  function toggleAuth(s: AuthState): void {
    authChangeEmitter.fire({
      added: [],
      changed: [],
      removed: [],
      hasValidSession: s === AuthState.SIGNED_IN ? true : false,
    });
  }

  beforeEach(() => {
    assignmentStub = sinon.createStubInstance(AssignmentManager);
    authChangeEmitter = new TestEventEmitter<AuthChangeEvent>();
    assignmentChangeEmitter = new TestEventEmitter<AssignmentChangeEvent>();
    fileChangeEmitter = new TestEventEmitter<FileChangeEvent[]>();
    fsStub = sinon.createStubInstance(ContentsFileSystemProvider);
    // Needed to work around the property being readonly.
    Object.defineProperty(fsStub, 'onDidChangeFile', {
      value: sinon.stub().callsFake(fileChangeEmitter.event),
    });
    fsDisposable = vscode.workspace.registerFileSystemProvider(
      TEST_SCHEME,
      fsStub,
      { isCaseSensitive: true },
    );

    tree = new ServerTreeProvider(
      assignmentStub,
      authChangeEmitter.event,
      assignmentChangeEmitter.event,
      fileChangeEmitter.event,
      TEST_SCHEME,
    );
  });

  afterEach(() => {
    fsDisposable.dispose();
    sinon.restore();
  });

  describe('getChildren', () => {
    describe('without servers', () => {
      beforeEach(() => {
        (assignmentStub.getServers as sinon.SinonStub).returns([]);
      });

      const authStates = [AuthState.SIGNED_OUT, AuthState.SIGNED_IN] as const;

      authStates.forEach((authState) => {
        const state =
          authState === AuthState.SIGNED_IN ? 'authorized' : 'unauthorized';

        it(`returns no items while ${state}`, async () => {
          toggleAuth(authState);

          await expect(tree.getChildren(undefined)).to.eventually.deep.equal(
            [],
          );

          sinon.assert.notCalled(fsStub.readDirectory);
        });
      });
    });

    describe('with a server', () => {
      beforeEach(() => {
        (assignmentStub.getServers as sinon.SinonStub).returns([
          DEFAULT_SERVER,
        ]);
      });

      it('returns no items while unauthorized', async () => {
        await expect(tree.getChildren(undefined)).to.eventually.deep.equal([]);

        sinon.assert.notCalled(fsStub.readDirectory);
      });

      describe('while authorized', () => {
        beforeEach(() => {
          toggleAuth(AuthState.SIGNED_IN);
        });

        it('returns the server root', async () => {
          await expect(tree.getChildren(undefined)).to.eventually.deep.equal([
            {
              id: DEFAULT_SERVER_URI.toString(),
              endpoint: DEFAULT_SERVER.endpoint,
              type: FileType.Directory,
              uri: DEFAULT_SERVER_URI,
              resourceUri: DEFAULT_SERVER_URI,
              label: DEFAULT_SERVER.label,
              collapsibleState: TreeItemCollapsibleState.Collapsed,
              contextValue: 'server',
            },
          ]);
        });

        it('returns a file', async () => {
          const rootServerItems = await tree.getChildren(undefined);
          assert(rootServerItems.length === 1);
          const rootServerItem = rootServerItems[0];
          fsStub.readDirectory.onCall(0).resolves([['foo.txt', FileType.File]]);
          const fileUri = buildTestUri('content/foo.txt');

          await expect(
            tree.getChildren(rootServerItem),
          ).to.eventually.deep.equal([
            {
              id: fileUri.toString(),
              endpoint: DEFAULT_SERVER.endpoint,
              type: FileType.File,
              uri: fileUri,
              resourceUri: fileUri,
              label: 'foo.txt',
              collapsibleState: TreeItemCollapsibleState.None,
              contextValue: 'file',
              command: {
                command: 'vscode.open',
                title: 'Open File',
                arguments: [fileUri],
              },
            },
          ]);
        });

        it('returns a directory', async () => {
          const rootServerItems = await tree.getChildren(undefined);
          assert(rootServerItems.length === 1);
          const rootServerItem = rootServerItems[0];
          fsStub.readDirectory
            .onCall(0)
            .resolves([['foo', FileType.Directory]]);
          const folderUri = buildTestUri('content/foo');

          await expect(
            tree.getChildren(rootServerItem),
          ).to.eventually.deep.equal([
            {
              id: folderUri.toString(),
              endpoint: DEFAULT_SERVER.endpoint,
              type: FileType.Directory,
              uri: folderUri,
              resourceUri: folderUri,
              label: 'foo',
              collapsibleState: TreeItemCollapsibleState.Collapsed,
              contextValue: 'folder',
            },
          ]);
        });

        it('returns a combination of files and folders', async () => {
          const rootServerItems = await tree.getChildren(undefined);
          assert(rootServerItems.length === 1);
          const rootServerItem = rootServerItems[0];
          fsStub.readDirectory.onCall(0).resolves([
            ['foo.txt', FileType.File],
            ['bar.txt', FileType.File],
            ['baz', FileType.Directory],
            ['cux', FileType.Directory],
          ]);

          const children = await tree.getChildren(rootServerItem);

          expect(
            children.map((c) => ({
              label: c.label,
              contextValue: c.contextValue,
            })),
          ).to.deep.equal([
            { label: 'baz', contextValue: 'folder' },
            { label: 'cux', contextValue: 'folder' },
            { label: 'bar.txt', contextValue: 'file' },
            { label: 'foo.txt', contextValue: 'file' },
          ]);
        });

        it('returns nested files and folders', async () => {
          const rootServerItems = await tree.getChildren(undefined);
          assert(rootServerItems.length === 1);
          const rootServerItem = rootServerItems[0];
          fsStub.readDirectory
            .onCall(0)
            .resolves([['foo', FileType.Directory]]);
          const rootChildren = await tree.getChildren(rootServerItem);
          assert(rootChildren.length === 1);
          const fooFolder = rootChildren[0];
          fsStub.readDirectory.onCall(1).resolves([
            ['bar.txt', FileType.File],
            ['baz', FileType.Directory],
          ]);

          const fooChildren = await tree.getChildren(fooFolder);

          expect(
            fooChildren.map((c) => ({
              label: c.label,
              contextValue: c.contextValue,
            })),
          ).to.deep.equal([
            { label: 'baz', contextValue: 'folder' },
            { label: 'bar.txt', contextValue: 'file' },
          ]);
        });

        it('sorts folders before files and then alphabetically', async () => {
          const rootServerItems = await tree.getChildren(undefined);
          const rootServerItem = rootServerItems[0];
          fsStub.readDirectory.onCall(0).resolves([
            ['z.txt', FileType.File],
            ['a.txt', FileType.File],
            ['b_folder', FileType.Directory],
            ['a_folder', FileType.Directory],
          ]);

          const children = await tree.getChildren(rootServerItem);

          expect(children.map((c) => c.label)).to.deep.equal([
            'a_folder',
            'b_folder',
            'a.txt',
            'z.txt',
          ]);
        });
      });
    });

    describe('with multiple servers', () => {
      const secondServer: ColabAssignedServer = {
        ...DEFAULT_SERVER,
        id: randomUUID(),
        endpoint: 'm-s-bar',
        label: 'Colab TPU v2',
      };

      beforeEach(() => {
        (assignmentStub.getServers as sinon.SinonStub).returns([
          DEFAULT_SERVER,
          secondServer,
        ]);
      });

      it('returns no items while unauthorized', async () => {
        await expect(tree.getChildren(undefined)).to.eventually.deep.equal([]);

        sinon.assert.notCalled(fsStub.readDirectory);
      });

      describe('while authorized', () => {
        beforeEach(() => {
          toggleAuth(AuthState.SIGNED_IN);
        });

        it('returns multiple servers', async () => {
          const rootItems = await tree.getChildren(undefined);

          expect(rootItems.map((i) => i.label)).to.deep.equal([
            DEFAULT_SERVER.label,
            secondServer.label,
          ]);
        });
      });
    });
  });

  describe('file changes', () => {
    let onDidChangeTreeData: sinon.SinonStub<
      [ServerItem | ServerItem[] | undefined]
    >;

    beforeEach(async () => {
      (assignmentStub.getServers as sinon.SinonStub).returns([DEFAULT_SERVER]);
      toggleAuth(AuthState.SIGNED_IN);
      await tree.getChildren(undefined);

      onDidChangeTreeData = sinon.stub();
      tree.onDidChangeTreeData(onDidChangeTreeData);
    });

    it('refreshes when servers change', () => {
      assignmentChangeEmitter.fire({
        added: [],
        removed: [],
        changed: [],
      });

      sinon.assert.calledWith(onDidChangeTreeData, undefined);
    });

    it('refreshes parent when a child file is created', async () => {
      const rootItems = await tree.getChildren(undefined);
      const serverRoot = rootItems[0];
      const newFileUri = buildTestUri('content/new-file.txt');

      fileChangeEmitter.fire([
        {
          type: vscode.FileChangeType.Created,
          uri: newFileUri,
        },
      ]);

      sinon.assert.calledWith(onDidChangeTreeData, [serverRoot]);
    });

    it('refreshes parent when a child file is deleted', async () => {
      const rootItems = await tree.getChildren(undefined);
      const serverRoot = rootItems[0];
      const deletedFileUri = buildTestUri('content/old-file.txt');

      fileChangeEmitter.fire([
        {
          type: vscode.FileChangeType.Deleted,
          uri: deletedFileUri,
        },
      ]);

      sinon.assert.calledWith(onDidChangeTreeData, [serverRoot]);
    });

    it('refreshes multiple parents when multiple files are changed', async () => {
      const rootItems = await tree.getChildren(undefined);
      const serverRoot = rootItems[0];

      fsStub.readDirectory.onCall(0).resolves([['foo', FileType.Directory]]);
      const rootChildren = await tree.getChildren(serverRoot);
      const fooFolder = rootChildren[0];

      const newFile1Uri = buildTestUri('content/new-file-1.txt');
      const newFile2Uri = buildTestUri('content/foo/new-file-2.txt');

      fileChangeEmitter.fire([
        {
          type: vscode.FileChangeType.Created,
          uri: newFile1Uri,
        },
        {
          type: vscode.FileChangeType.Created,
          uri: newFile2Uri,
        },
      ]);

      sinon.assert.calledWith(onDidChangeTreeData, [serverRoot, fooFolder]);
    });

    it('does not refresh when a file change occurs in an untracked directory', () => {
      const untrackedFileUri = buildTestUri('content/untracked/file.txt');

      fileChangeEmitter.fire([
        {
          type: vscode.FileChangeType.Created,
          uri: untrackedFileUri,
        },
      ]);

      sinon.assert.notCalled(onDidChangeTreeData);
    });

    it('reuses cached items when possible', async () => {
      const rootItems = await tree.getChildren(undefined);
      const serverRoot = rootItems[0];
      fsStub.readDirectory.onCall(0).resolves([['foo.txt', FileType.File]]);
      fsStub.readDirectory.onCall(1).resolves([['foo.txt', FileType.File]]);

      const firstChildren = await tree.getChildren(serverRoot);
      const secondChildren = await tree.getChildren(serverRoot);

      assert.strictEqual(firstChildren[0], secondChildren[0]);
    });

    it('clears cache when a folder is deleted', async () => {
      const rootItems = await tree.getChildren(undefined);
      const serverRoot = rootItems[0];
      const fooFolderUri = buildTestUri('content/foo');

      // Expand root to see 'foo'
      fsStub.readDirectory.onCall(0).resolves([['foo', FileType.Directory]]);
      const rootChildren = await tree.getChildren(serverRoot);
      const fooFolder = rootChildren[0];

      // Expand 'foo' to see 'bar.txt'
      fsStub.readDirectory.onCall(1).resolves([['bar.txt', FileType.File]]);
      await tree.getChildren(fooFolder);

      // Verify they are in the cache (we can't check private map, but we can
      // verify via reuse)
      fsStub.readDirectory.onCall(2).resolves([['foo', FileType.Directory]]);
      const rootItemsAgain = await tree.getChildren(serverRoot);
      assert.strictEqual(rootItemsAgain[0], fooFolder);

      // Delete 'foo'
      fileChangeEmitter.fire([
        {
          type: vscode.FileChangeType.Deleted,
          uri: fooFolderUri,
        },
      ]);

      // Refetch root children, 'foo' should be a new instance now because it
      // was deleted and removed from the cache.
      fsStub.readDirectory.onCall(3).resolves([['foo', FileType.Directory]]);
      const rootChildrenAfterDelete = await tree.getChildren(serverRoot);
      assert.notStrictEqual(rootChildrenAfterDelete[0], fooFolder);
    });
  });
});
