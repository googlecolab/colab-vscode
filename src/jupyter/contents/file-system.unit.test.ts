/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon from 'sinon';
import { FileChangeEvent, Uri, WorkspaceFoldersChangeEvent } from 'vscode';
import { Variant } from '../../colab/types';
import { TestEventEmitter } from '../../test/helpers/events';
import { TestUri } from '../../test/helpers/uri';
import {
  FileChangeType,
  FileType,
  newVsCodeStub,
  VsCodeStub,
} from '../../test/helpers/vscode';
import { DirectoryContents } from '../client/converters';
import {
  Contents,
  ContentsApi,
  ContentsGetTypeEnum,
  FetchError,
  ResponseError,
} from '../client/generated';
import { ColabAssignedServer } from '../servers';
import {
  ContentsFileSystemProvider,
  partialPath,
  UPLOAD_CHUNK_MAX_RETRIES,
  UPLOAD_CHUNK_RETRY_BASE_DELAY_MS,
  UPLOAD_CHUNK_SIZE_BYTES,
} from './file-system';
import { JupyterConnectionManager } from './sessions';

const DEFAULT_SERVER: ColabAssignedServer = {
  id: 'r-abc123',
  label: 'Colab GPU A100',
  variant: Variant.GPU,
  accelerator: 'A100',
  endpoint: 'm-s-foo',
  connectionInformation: {
    baseUrl: TestUri.parse('https://example.com'),
    token: '123',
    tokenExpiry: new Date(Date.now() + 1000),
    headers: {},
  },
  dateAssigned: new Date(),
};

const FOO_CONTENT_DIR: Contents = {
  name: 'foo',
  path: '/foo',
  type: 'directory',
  writable: true,
  created: '2025-12-11T14:34:40Z',
  lastModified: '2025-12-16T14:30:53.932129Z',
  size: undefined,
  mimetype: '',
  content: '',
  format: '',
};

const FOO_CONTENT_FILE: Contents = {
  name: 'foo.txt',
  path: '/foo.txt',
  type: 'file',
  writable: true,
  created: '2025-12-16T14:30:53.932129Z',
  lastModified: '2025-12-11T14:34:40Z',
  size: 0,
  mimetype: 'text/plain',
  content: '',
  format: '',
};

const CONTENT_DIR: {
  withoutContents: Contents;
  withContents: DirectoryContents;
} = {
  withoutContents: FOO_CONTENT_DIR,
  withContents: {
    ...FOO_CONTENT_DIR,
    type: 'directory',
    content: [FOO_CONTENT_FILE],
  },
};

const FORBIDDEN = new ResponseError(new Response(undefined, { status: 403 }));
const NOT_FOUND = new ResponseError(new Response(undefined, { status: 404 }));
const CONFLICT = new ResponseError(new Response(undefined, { status: 409 }));
const TEAPOT = new ResponseError(new Response(undefined, { status: 418 }));

describe('ContentsFileSystemProvider', () => {
  let vs: VsCodeStub;
  let jupyterStub: sinon.SinonStubbedInstance<JupyterConnectionManager>;
  let workspaceEmitter: TestEventEmitter<WorkspaceFoldersChangeEvent>;
  let connectionEmitter: TestEventEmitter<string[]>;
  let fs: ContentsFileSystemProvider;
  let listener: sinon.SinonStub<[FileChangeEvent[]]>;

  function stubClient(
    serverId: string,
  ): sinon.SinonStubbedInstance<ContentsApi> {
    const contentsStub = sinon.createStubInstance(ContentsApi);
    jupyterStub.getOrCreate.withArgs(serverId).resolves(contentsStub);
    return contentsStub;
  }

  beforeEach(() => {
    vs = newVsCodeStub();
    workspaceEmitter = new TestEventEmitter();
    vs.workspace.onDidChangeWorkspaceFolders.callsFake(workspaceEmitter.event);
    jupyterStub = sinon.createStubInstance(JupyterConnectionManager);
    connectionEmitter = new TestEventEmitter();
    // Needed to work around the property being readonly.
    Object.defineProperty(jupyterStub, 'onDidRevokeConnections', {
      value: sinon.stub(),
    });
    jupyterStub.onDidRevokeConnections.callsFake(connectionEmitter.event);
    fs = new ContentsFileSystemProvider(vs.asVsCode(), jupyterStub);
    listener = sinon.stub();
    fs.onDidChangeFile(listener);
  });

  afterEach(() => {
    fs.dispose();
    sinon.restore();
  });

  it('disposes workspace listener when disposed', () => {
    expect(workspaceEmitter.hasListeners()).to.be.true;

    fs.dispose();

    expect(workspaceEmitter.hasListeners()).to.be.false;
  });

  it('disposes connection listener when disposed', () => {
    expect(connectionEmitter.hasListeners()).to.be.true;

    fs.dispose();

    expect(connectionEmitter.hasListeners()).to.be.false;
  });

  describe('onDidChangeWorkspaceFolders', () => {
    it('ignores non-Colab folder removals', () => {
      workspaceEmitter.fire({
        added: [],
        removed: [
          { index: 0, name: 'foo', uri: TestUri.parse('file:///usr/home') },
        ],
      });

      sinon.assert.notCalled(jupyterStub.drop);
    });

    it('drops connections to Colab folders that are removed', () => {
      workspaceEmitter.fire({
        added: [],
        removed: [
          {
            uri: TestUri.parse('colab://r-abc123/'),
            name: 'Colab CPU',
            index: 0,
          },
        ],
      });

      sinon.assert.calledOnceWithExactly(jupyterStub.drop, 'r-abc123', true);
    });
  });

  describe('onDidRevokeConnection', () => {
    it("removes matching workspace folder when it's the only one", () => {
      vs.workspace.workspaceFolders = [
        {
          uri: TestUri.parse('colab://r-abc123/'),
          name: 'Colab CPU',
          index: 0,
        },
      ];

      connectionEmitter.fire(['r-abc123']);

      sinon.assert.calledWith(vs.workspace.updateWorkspaceFolders, 0, 1);
    });

    it("removes matching workspace folder when it's one of many", () => {
      vs.workspace.workspaceFolders = [
        {
          uri: TestUri.parse('colab://r-abc123/'),
          name: 'Colab CPU',
          index: 0,
        },
        {
          uri: TestUri.parse('colab://r-def456/'),
          name: 'Colab GPU',
          index: 1,
        },
      ];

      connectionEmitter.fire(['r-def456']);

      sinon.assert.calledWith(vs.workspace.updateWorkspaceFolders, 0, 2, {
        uri: TestUri.parse('colab://r-abc123/'),
        name: 'Colab CPU',
      });
    });

    it("removes matching workspace folder when it's one of many including other folders", () => {
      vs.workspace.workspaceFolders = [
        {
          uri: TestUri.parse('colab://r-abc123/'),
          name: 'Colab CPU',
          index: 0,
        },
        {
          uri: TestUri.parse('file://usr/home/'),
          name: 'Not Colab',
          index: 1,
        },
        {
          uri: TestUri.parse('colab://r-def456/'),
          name: 'Colab GPU',
          index: 2,
        },
      ];

      connectionEmitter.fire(['r-abc123', 'r-def456']);

      sinon.assert.calledWith(vs.workspace.updateWorkspaceFolders, 0, 3, {
        uri: TestUri.parse('file://usr/home/'),
        name: 'Not Colab',
      });
    });

    it("no-ops when the removed server doesn't map to a workspace folder", () => {
      vs.workspace.workspaceFolders = [
        {
          uri: TestUri.parse('colab://r-abc123/'),
          name: 'Colab CPU',
          index: 0,
        },
      ];

      connectionEmitter.fire(['r-def456']);

      sinon.assert.notCalled(vs.workspace.updateWorkspaceFolders);
    });
  });

  describe('mount', () => {
    it('throws when disposed', () => {
      fs.dispose();

      expect(() => {
        fs.mount(DEFAULT_SERVER);
      }).to.throw(/disposed/);
    });

    it('no-ops for servers that have already been mounted', () => {
      vs.workspace.getWorkspaceFolder.returns({
        uri: TestUri.parse(`colab://${DEFAULT_SERVER.id}/`),
        name: DEFAULT_SERVER.label,
        index: 0,
      });

      fs.mount(DEFAULT_SERVER);
    });

    it('adds the first mounted server to a new workspace', () => {
      vs.workspace.getWorkspaceFolder.returns(undefined);
      vs.workspace.workspaceFolders = undefined;
      vs.workspace.updateWorkspaceFolders
        .withArgs(0, 0, {
          uri: uriStringMatch(`colab://${DEFAULT_SERVER.id}/content`),
          name: DEFAULT_SERVER.label,
        })
        .returns(true);

      fs.mount(DEFAULT_SERVER);

      sinon.assert.calledOnce(vs.workspace.updateWorkspaceFolders);
    });

    it('adds the first mounted server to an existing empty workspace', () => {
      vs.workspace.getWorkspaceFolder.returns(undefined);
      vs.workspace.workspaceFolders = [];
      vs.workspace.updateWorkspaceFolders
        .withArgs(0, 0, {
          uri: uriStringMatch(`colab://${DEFAULT_SERVER.id}/content`),
          name: DEFAULT_SERVER.label,
        })
        .returns(true);

      fs.mount(DEFAULT_SERVER);

      sinon.assert.calledOnce(vs.workspace.updateWorkspaceFolders);
    });

    it('adds an additional mounted server to the workspace', () => {
      vs.workspace.getWorkspaceFolder.returns(undefined);
      vs.workspace.workspaceFolders = [
        {
          uri: TestUri.parse('colab://r-abc123/content'),
          name: 'Colab CPU',
          index: 0,
        },
      ];
      vs.workspace.updateWorkspaceFolders
        .withArgs(1, 0, {
          uri: uriStringMatch(`colab://${DEFAULT_SERVER.id}/content`),
          name: DEFAULT_SERVER.label,
        })
        .returns(true);

      fs.mount(DEFAULT_SERVER);

      sinon.assert.calledOnce(vs.workspace.updateWorkspaceFolders);
    });

    it('throws if workspace cannot be added', () => {
      vs.workspace.getWorkspaceFolder.returns(undefined);
      vs.workspace.workspaceFolders = [];
      vs.workspace.updateWorkspaceFolders.returns(false);

      expect(() => {
        fs.mount(DEFAULT_SERVER);
      }).to.throw(/mount/);
    });
  });

  describe('watch', () => {
    it('throws when disposed', () => {
      fs.dispose();

      expect(() => {
        fs.watch(TestUri.parse('colab://r-abc123/'), {
          recursive: false,
          excludes: [],
        });
      }).to.throw(/disposed/);
    });

    it('throws file system not found errors for VS Code files', () => {
      expect(() => {
        fs.watch(TestUri.parse('colab://r-abc123/.vscode/launch.json'), {
          recursive: false,
          excludes: [],
        });
      }).to.throw(/FileNotFound/);
    });

    it('no-ops', () => {
      expect(
        fs.watch(TestUri.parse('colab://r-abc123/'), {
          recursive: false,
          excludes: [],
        }),
      ).to.have.property('dispose');
    });
  });

  describe('stat', () => {
    it('throws when disposed', async () => {
      fs.dispose();

      await expect(
        fs.stat(TestUri.parse('colab://r-abc123/')),
      ).to.eventually.rejectedWith(/disposed/);
    });

    it('throws file system not found errors for VS Code files', async () => {
      await expect(
        fs.stat(TestUri.parse('colab://r-abc123/.vscode')),
      ).to.eventually.rejectedWith(/FileNotFound/);
    });

    it('returns file stat', async () => {
      const contentsStub = stubClient('r-abc123');
      const contents = CONTENT_DIR.withoutContents;
      contentsStub.get.withArgs({ path: '/', content: 0 }).resolves(contents);

      await expect(
        fs.stat(TestUri.parse('colab://r-abc123/')),
      ).to.eventually.deep.equal({
        type: FileType.Directory,
        ctime: new Date(contents.created).getTime(),
        mtime: new Date(contents.lastModified).getTime(),
        size: 0,
      });
    });

    it('throws file system no permissions error on content forbidden responses', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.get.rejects(FORBIDDEN);

      await expect(
        fs.stat(TestUri.parse('colab://r-abc123/')),
      ).to.eventually.rejectedWith(/NoPermissions/);
    });

    it('throws file system file not found error on content not found responses', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.get.rejects(NOT_FOUND);

      await expect(
        fs.stat(TestUri.parse('colab://r-abc123/')),
      ).to.eventually.rejectedWith(/FileNotFound/);
    });

    it('throws file system file exists error on content conflict responses', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.get.rejects(CONFLICT);

      await expect(
        fs.stat(TestUri.parse('colab://r-abc123/')),
      ).to.eventually.rejectedWith(/FileExists/);
    });

    it('throws unhandled content response errors', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.get.rejects(TEAPOT);

      await expect(
        fs.stat(TestUri.parse('colab://r-abc123/')),
      ).to.eventually.rejectedWith(TEAPOT.message);
    });

    it('throws unhandled errors', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.get.rejects(new Error('🤮'));

      await expect(
        fs.stat(TestUri.parse('colab://r-abc123/')),
      ).to.eventually.rejectedWith('🤮');
    });
  });

  describe('readDirectory', () => {
    it('throws when disposed', async () => {
      fs.dispose();

      await expect(
        fs.readDirectory(TestUri.parse('colab://r-abc123/')),
      ).to.eventually.rejectedWith(/disposed/);
    });

    it('throws file system not found errors for VS Code files', async () => {
      await expect(
        fs.readDirectory(TestUri.parse('colab://r-abc123/.vscode')),
      ).to.eventually.rejectedWith(/FileNotFound/);
    });

    it('throws file system file not a directory errors for non-directory URIs', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.get
        .withArgs({ path: '/foo.txt', type: 'directory' })
        .resolves(FOO_CONTENT_FILE);

      await expect(
        fs.readDirectory(TestUri.parse('colab://r-abc123/foo.txt')),
      ).to.eventually.rejectedWith(/FileNotADirectory/);
    });

    it("returns the directory's children file types", async () => {
      const contentsStub = stubClient('r-abc123');
      const contents = CONTENT_DIR.withContents;
      contentsStub.get
        .withArgs({ path: '/', type: 'directory' })
        .resolves(contents);

      await expect(
        fs.readDirectory(TestUri.parse('colab://r-abc123/')),
      ).to.eventually.deep.equal([[contents.content[0].name, FileType.File]]);
    });

    it('throws file system no permissions error on content forbidden responses', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.get.rejects(FORBIDDEN);

      await expect(
        fs.readDirectory(TestUri.parse('colab://r-abc123/')),
      ).to.eventually.rejectedWith(/NoPermissions/);
    });

    it('throws file system file not found error on content not found responses', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.get.rejects(NOT_FOUND);

      await expect(
        fs.readDirectory(TestUri.parse('colab://r-abc123/')),
      ).to.eventually.rejectedWith(/FileNotFound/);
    });

    it('throws file system file exists error on content conflict responses', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.get.rejects(CONFLICT);

      await expect(
        fs.readDirectory(TestUri.parse('colab://r-abc123/')),
      ).to.eventually.rejectedWith(/FileExists/);
    });

    it('throws unhandled content response errors', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.get.rejects(TEAPOT);

      await expect(
        fs.readDirectory(TestUri.parse('colab://r-abc123/')),
      ).to.eventually.rejectedWith(TEAPOT.message);
    });

    it('throws unhandled errors', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.get.rejects(new Error('🤮'));

      await expect(
        fs.readDirectory(TestUri.parse('colab://r-abc123/')),
      ).to.eventually.rejectedWith('🤮');
    });
  });

  describe('createDirectory', () => {
    it('throws when disposed', async () => {
      fs.dispose();

      await expect(
        fs.createDirectory(TestUri.parse('colab://r-abc123/')),
      ).to.eventually.rejectedWith(/disposed/);
    });

    it('throws file system not found errors for VS Code files', async () => {
      await expect(
        fs.createDirectory(TestUri.parse('colab://r-abc123/.vscode')),
      ).to.eventually.rejectedWith(/FileNotFound/);
    });

    it('saves the directory to contents when created', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.save.resolves(FOO_CONTENT_DIR);

      await fs.createDirectory(TestUri.parse('colab://r-abc123/foo'));

      sinon.assert.calledWithMatch(contentsStub.save, {
        path: '/foo',
        model: {
          type: ContentsGetTypeEnum.Directory,
        },
      });
    });

    it('fires onDidChangeFile when created', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.save.resolves(FOO_CONTENT_DIR);

      await fs.createDirectory(TestUri.parse('colab://r-abc123/foo'));

      sinon.assert.calledWith(listener, [
        {
          type: FileChangeType.Created,
          uri: uriStringMatch('colab://r-abc123/foo'),
        },
      ]);
    });

    it('throws file system no permissions error on content forbidden responses', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.save.rejects(FORBIDDEN);

      await expect(
        fs.createDirectory(TestUri.parse('colab://r-abc123/')),
      ).to.eventually.rejectedWith(/NoPermissions/);
    });

    it('throws file system file not found error on content not found responses', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.save.rejects(NOT_FOUND);

      await expect(
        fs.createDirectory(TestUri.parse('colab://r-abc123/')),
      ).to.eventually.rejectedWith(/FileNotFound/);
    });

    it('throws file system file exists error on content conflict responses', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.save.rejects(CONFLICT);

      await expect(
        fs.createDirectory(TestUri.parse('colab://r-abc123/')),
      ).to.eventually.rejectedWith(/FileExists/);
    });

    it('throws unhandled content response errors', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.save.rejects(TEAPOT);

      await expect(
        fs.createDirectory(TestUri.parse('colab://r-abc123/')),
      ).to.eventually.rejectedWith(TEAPOT.message);
    });

    it('throws unhandled errors', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.save.rejects(new Error('🤮'));

      await expect(
        fs.createDirectory(TestUri.parse('colab://r-abc123/')),
      ).to.eventually.rejectedWith('🤮');
    });
  });

  describe('readFile', () => {
    it('throws when disposed', async () => {
      fs.dispose();

      await expect(
        fs.readFile(TestUri.parse('colab://r-abc123/foo.txt')),
      ).to.eventually.rejectedWith(/disposed/);
    });

    it('throws file system not found errors for VS Code files', async () => {
      await expect(
        fs.readFile(TestUri.parse('colab://r-abc123/.vscode/settings.json')),
      ).to.eventually.rejectedWith(/FileNotFound/);
    });

    it('throws when the contents are not a string', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.get
        .withArgs({ path: '/foo.txt', format: 'base64', type: 'file' })
        .resolves({ ...FOO_CONTENT_FILE, content: [] });

      await expect(
        fs.readFile(TestUri.parse('colab://r-abc123/foo.txt')),
      ).to.eventually.rejectedWith(/Unexpected content format/);
    });

    it('returns a buffer for a file with empty content', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.get.resolves(CONTENT_DIR.withoutContents);

      const result = await fs.readFile(TestUri.parse('colab://r-abc123/'));

      expect(result).to.deep.equal(Buffer.from(''));
    });

    it('returns a buffer of the base64 encoded contents for a file', async () => {
      const contentsStub = stubClient('r-abc123');
      const content = 'hello world';
      const encoded = Buffer.from(content).toString('base64');
      contentsStub.get
        .withArgs({ path: '/foo.txt', format: 'base64', type: 'file' })
        .resolves({
          ...FOO_CONTENT_FILE,
          format: 'base64',
          content: encoded,
        });

      const result = await fs.readFile(
        TestUri.parse('colab://r-abc123/foo.txt'),
      );

      expect(result).to.deep.equal(Buffer.from(content));
    });

    it('throws file system no permissions error on content forbidden responses', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.get.rejects(FORBIDDEN);

      await expect(
        fs.readFile(TestUri.parse('colab://r-abc123/foo.txt')),
      ).to.eventually.rejectedWith(/NoPermissions/);
    });

    it('throws file system file not found error on content not found responses', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.get.rejects(NOT_FOUND);

      await expect(
        fs.readFile(TestUri.parse('colab://r-abc123/foo.txt')),
      ).to.eventually.rejectedWith(/FileNotFound/);
    });

    it('throws file system file exists error on content conflict responses', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.get.rejects(CONFLICT);

      await expect(
        fs.readFile(TestUri.parse('colab://r-abc123/foo.txt')),
      ).to.eventually.rejectedWith(/FileExists/);
    });

    it('throws unhandled content response errors', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.get.rejects(TEAPOT);

      await expect(
        fs.readFile(TestUri.parse('colab://r-abc123/foo.txt')),
      ).to.eventually.rejectedWith(TEAPOT.message);
    });

    it('throws unhandled errors', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.get.rejects(new Error('🤮'));

      await expect(
        fs.readFile(TestUri.parse('colab://r-abc123/foo.txt')),
      ).to.eventually.rejectedWith('🤮');
    });
  });

  describe('writeFile', () => {
    it('throws when disposed', async () => {
      fs.dispose();

      await expect(
        fs.writeFile(
          TestUri.parse('colab://r-abc123/foo.txt'),
          Buffer.from(''),
          {
            create: true,
            overwrite: true,
          },
        ),
      ).to.eventually.rejectedWith(/disposed/);
    });

    const existenceChecks: [
      'create' | 'overwrite' | 'create and overwrite' | 'none',
      'file exists' | 'file does not exist',
      'changed' | 'created' | 'no event',
      'throws exists' | 'throws not found' | 'saves',
    ][] = [
      // File exists.
      ['none', 'file exists', 'no event', 'throws exists'],
      ['create', 'file exists', 'no event', 'throws exists'],
      ['overwrite', 'file exists', 'changed', 'saves'],
      ['create and overwrite', 'file exists', 'changed', 'saves'],
      // File doesn't exist.
      ['none', 'file does not exist', 'no event', 'throws not found'],
      ['create', 'file does not exist', 'created', 'saves'],
      ['overwrite', 'file does not exist', 'no event', 'throws not found'],
      ['create and overwrite', 'file does not exist', 'created', 'saves'],
    ];
    for (const t of existenceChecks) {
      const [options, existence, event, outcome] = t;
      const opts = {
        create: options.includes('create'),
        overwrite: options.includes('overwrite'),
      };
      describe(`with options set to ${options} when the ${existence}`, () => {
        let contentsStub: sinon.SinonStubbedInstance<ContentsApi>;

        beforeEach(() => {
          contentsStub = stubClient('r-abc123');
          if (existence === 'file exists') {
            contentsStub.get.resolves(FOO_CONTENT_FILE);
          } else {
            contentsStub.get.rejects(NOT_FOUND);
          }
        });

        it(outcome, async () => {
          const call = fs.writeFile(
            TestUri.parse('colab://r-abc123/foo.txt'),
            Buffer.from('hello'),
            opts,
          );

          if (outcome === 'throws exists') {
            await expect(call).to.eventually.rejectedWith(/FileExists/);
          } else if (outcome === 'throws not found') {
            await expect(call).to.eventually.rejectedWith(/FileNotFound/);
          } else {
            await call;
            sinon.assert.calledWithMatch(contentsStub.save, {
              path: '/foo.txt',
              model: {
                type: ContentsGetTypeEnum.File,
                format: 'base64',
                content: Buffer.from('hello').toString('base64'),
              },
            });
          }
        });

        it(`emits ${event} `, async () => {
          const call = fs.writeFile(
            TestUri.parse('colab://r-abc123/foo.txt'),
            Buffer.from('hello'),
            opts,
          );

          try {
            await call;
          } catch {
            // Outcome not important for this test.
          }

          if (event === 'no event') {
            sinon.assert.notCalled(listener);
          } else {
            sinon.assert.calledWith(listener, [
              {
                type:
                  event === 'created'
                    ? FileChangeType.Created
                    : FileChangeType.Changed,
                uri: uriStringMatch('colab://r-abc123/foo.txt'),
              },
            ]);
          }
        });
      });
    }

    describe('chunked uploads', () => {
      const uri = TestUri.parse('colab://r-abc123/foo.bin');
      const opts = { create: true, overwrite: true };
      // Two full chunks and a partial one.
      const content = Buffer.alloc(2.5 * UPLOAD_CHUNK_SIZE_BYTES);
      for (let i = 0; i < content.length; i++) {
        content[i] = i % 251;
      }
      const chunkContent = (i: number) =>
        content
          .subarray(
            i * UPLOAD_CHUNK_SIZE_BYTES,
            (i + 1) * UPLOAD_CHUNK_SIZE_BYTES,
          )
          .toString('base64');
      let contentsStub: sinon.SinonStubbedInstance<ContentsApi>;
      const TEMP = '/foo.bin.partial';

      beforeEach(() => {
        contentsStub = stubClient('r-abc123');
        contentsStub.get.resolves(FOO_CONTENT_FILE);
      });

      it('saves content of exactly one chunk in a single non-chunked request', async () => {
        const oneChunk = content.subarray(0, UPLOAD_CHUNK_SIZE_BYTES);

        await fs.writeFile(uri, oneChunk, opts);

        sinon.assert.calledOnce(contentsStub.save);
        const model = contentsStub.save.firstCall.args[0].model;
        expect(model).to.deep.equal({
          content: chunkContent(0),
          format: 'base64',
          type: ContentsGetTypeEnum.File,
        });
      });

      it('encodes only the viewed bytes of content backed by a larger buffer', async () => {
        // A view that starts part-way into its backing buffer and spans one
        // full chunk plus one byte.
        const offset = 7;
        const view = new Uint8Array(
          content.buffer,
          content.byteOffset + offset,
          UPLOAD_CHUNK_SIZE_BYTES + 1,
        );

        await fs.writeFile(uri, view, opts);

        const models = contentsStub.save.getCalls().map((c) => c.args[0].model);
        expect(models.map((m) => m?.chunk)).to.deep.equal([1, -1]);
        const uploaded = Buffer.concat(
          models.map((m) => Buffer.from(m?.content ?? '', 'base64')),
        );
        expect(uploaded.equals(Buffer.from(view))).to.equal(true);
      });

      it('uploads the chunks in order to a temporary file, marking the last with -1', async () => {
        await fs.writeFile(uri, content, opts);

        const models = contentsStub.save.getCalls().map((c) => c.args[0].model);
        expect(
          contentsStub.save.getCalls().map((c) => c.args[0].path),
        ).to.deep.equal([TEMP, TEMP, TEMP]);
        expect(models).to.deep.equal([
          {
            content: chunkContent(0),
            format: 'base64',
            type: ContentsGetTypeEnum.File,
            chunk: 1,
          },
          {
            content: chunkContent(1),
            format: 'base64',
            type: ContentsGetTypeEnum.File,
            chunk: 2,
          },
          {
            content: chunkContent(2),
            format: 'base64',
            type: ContentsGetTypeEnum.File,
            chunk: -1,
          },
        ]);
      });

      it('replaces an existing file with the completed upload', async () => {
        await fs.writeFile(uri, content, opts);

        sinon.assert.calledOnceWithExactly(contentsStub.delete, {
          path: '/foo.bin',
        });
        sinon.assert.calledOnceWithExactly(contentsStub.rename, {
          path: TEMP,
          rename: { path: '/foo.bin' },
        });
        // The original is only deleted once every chunk is uploaded.
        expect(
          contentsStub.delete.firstCall.calledAfter(contentsStub.save.lastCall),
        ).to.equal(true);
        expect(
          contentsStub.rename.firstCall.calledAfter(
            contentsStub.delete.firstCall,
          ),
        ).to.equal(true);
        sinon.assert.calledOnceWithExactly(listener, [
          { type: FileChangeType.Changed, uri },
        ]);
      });

      it('moves the completed upload into place without deleting when the file is new', async () => {
        contentsStub.get.rejects(NOT_FOUND);

        await fs.writeFile(uri, content, opts);

        sinon.assert.notCalled(contentsStub.delete);
        sinon.assert.calledOnceWithExactly(contentsStub.rename, {
          path: TEMP,
          rename: { path: '/foo.bin' },
        });
        sinon.assert.calledOnceWithExactly(listener, [
          { type: FileChangeType.Created, uri },
        ]);
      });

      it('still moves the upload into place when the original was removed meanwhile', async () => {
        contentsStub.delete.rejects(NOT_FOUND);

        await fs.writeFile(uri, content, opts);

        sinon.assert.calledOnce(contentsStub.rename);
      });

      it('does not move the upload into place when deleting the original fails', async () => {
        contentsStub.delete.withArgs({ path: '/foo.bin' }).rejects(FORBIDDEN);

        await expect(
          fs.writeFile(uri, content, opts),
        ).to.eventually.rejectedWith(/NoPermissions/);

        sinon.assert.notCalled(contentsStub.rename);
        sinon.assert.neverCalledWith(contentsStub.delete, { path: TEMP });
      });

      it('sends a single trailing chunk as -1 when the content is an exact multiple of the chunk size', async () => {
        const twoChunks = content.subarray(0, 2 * UPLOAD_CHUNK_SIZE_BYTES);

        await fs.writeFile(uri, twoChunks, opts);

        expect(
          contentsStub.save.getCalls().map((c) => c.args[0].model?.chunk),
        ).to.deep.equal([1, -1]);
      });

      for (const [name, failAt] of [
        ['the first chunk', 0],
        ['a later chunk', 1],
      ] as const) {
        it(`leaves the original and the temporary file alone when ${name} fails`, async () => {
          contentsStub.save.onCall(failAt).rejects(TEAPOT);

          await expect(
            fs.writeFile(uri, content, opts),
          ).to.eventually.rejectedWith(TEAPOT.message);

          sinon.assert.callCount(contentsStub.save, failAt + 1);
          sinon.assert.notCalled(contentsStub.delete);
          sinon.assert.notCalled(contentsStub.rename);
          sinon.assert.notCalled(listener);
        });
      }

      it('leaves the temporary file alone when the rename fails', async () => {
        contentsStub.rename.rejects(TEAPOT);

        await expect(
          fs.writeFile(uri, content, opts),
        ).to.eventually.rejectedWith(TEAPOT.message);

        // Only the original, which had to make way for the rename.
        sinon.assert.calledOnceWithExactly(contentsStub.delete, {
          path: '/foo.bin',
        });
      });

      it('stops without cleaning up when disposed part-way through', async () => {
        contentsStub.save.onFirstCall().callsFake(() => {
          fs.dispose();
          return Promise.resolve(FOO_CONTENT_FILE);
        });

        await expect(
          fs.writeFile(uri, content, opts),
        ).to.eventually.rejectedWith(/disposed/);

        sinon.assert.calledOnce(contentsStub.save);
        sinon.assert.notCalled(contentsStub.delete);
        sinon.assert.notCalled(contentsStub.rename);
      });

      it('overwrites a partial upload left by an earlier attempt', async () => {
        // A previous failed upload left `foo.bin.partial` behind. The first
        // chunk of a new upload is a plain (non-append) write, which replaces
        // it rather than appending to it.
        contentsStub.get
          .withArgs({ path: TEMP, content: 0 })
          .resolves({ ...FOO_CONTENT_FILE, size: 123 });

        await fs.writeFile(uri, content, opts);

        expect(contentsStub.save.firstCall.args[0]).to.deep.include({
          path: TEMP,
        });
        expect(contentsStub.save.firstCall.args[0].model?.chunk).to.equal(1);
        sinon.assert.calledOnce(contentsStub.rename);
      });

      it('names the temporary file next to the target with a fixed, visible name', () => {
        expect(partialPath('/content/foo.bin')).to.equal(
          '/content/foo.bin.partial',
        );
      });

      describe('retries', () => {
        const C = UPLOAD_CHUNK_SIZE_BYTES;
        const serverError = () =>
          new ResponseError(new Response(null, { status: 503 }));
        const networkError = () =>
          new FetchError(new TypeError('fetch failed'), 'network');
        let clock: sinon.SinonFakeTimers;

        beforeEach(() => {
          clock = sinon.useFakeTimers({ toFake: ['setTimeout'] });
        });

        afterEach(() => {
          clock.restore();
        });

        /**
         * Decodes the chunk index and bytes of each save call.
         *
         * @returns One entry per save call, in order.
         */
        function savedRanges(): { chunk?: number; bytes: Buffer }[] {
          return contentsStub.save.getCalls().map((c) => ({
            chunk: c.args[0].model?.chunk,
            bytes: Buffer.from(c.args[0].model?.content ?? '', 'base64'),
          }));
        }

        /**
         * Stubs the size the server reports for the file being uploaded.
         *
         * @param size - The size in bytes.
         */
        function serverSizeIs(size: number) {
          contentsStub.get
            .withArgs({ path: TEMP, content: 0 })
            .resolves({ ...FOO_CONTENT_FILE, size });
        }

        async function writeAndRunTimers(): Promise<unknown> {
          const result = fs.writeFile(uri, content, opts).then(
            () => undefined,
            (e: unknown) => e,
          );
          await clock.runAllAsync();
          return result;
        }

        it('retries a failed first chunk by resending it, without a size check', async () => {
          contentsStub.save.onFirstCall().rejects(networkError());

          expect(await writeAndRunTimers()).to.equal(undefined);

          const saves = savedRanges();
          expect(saves.map((s) => s.chunk)).to.deep.equal([1, 1, 2, -1]);
          expect(saves[1].bytes.equals(content.subarray(0, C))).to.equal(true);
          // Chunk 1 truncates the file, so there's no offset to resync. The
          // only size check is the existence check on the target.
          sinon.assert.neverCalledWith(contentsStub.get, {
            path: TEMP,
            content: 0,
          });
          sinon.assert.notCalled(contentsStub.delete.withArgs({ path: TEMP }));
        });

        it('resumes from the server size when a failed append was not written', async () => {
          contentsStub.save.onSecondCall().rejects(serverError());
          serverSizeIs(C);

          expect(await writeAndRunTimers()).to.equal(undefined);

          const saves = savedRanges();
          expect(saves.map((s) => s.chunk)).to.deep.equal([1, 2, 2, -1]);
          expect(
            Buffer.concat([
              saves[0].bytes,
              saves[2].bytes,
              saves[3].bytes,
            ]).equals(content),
          ).to.equal(true);
          // Only the original is deleted, to be replaced; the temporary file
          // was completed and moved, not cleaned up.
          sinon.assert.neverCalledWith(contentsStub.delete, { path: TEMP });
          sinon.assert.calledOnce(contentsStub.rename);
        });

        it('resumes mid-chunk when a failed append was partially written', async () => {
          contentsStub.save.onSecondCall().rejects(networkError());
          // 100 bytes of chunk 2 made it to disk before the failure.
          serverSizeIs(C + 100);

          expect(await writeAndRunTimers()).to.equal(undefined);

          const saves = savedRanges();
          expect(saves.map((s) => s.chunk)).to.deep.equal([1, 2, 2, -1]);
          // The retry starts at the first byte the server doesn't have.
          expect(
            saves[2].bytes.equals(content.subarray(C + 100, 2 * C + 100)),
          ).to.equal(true);
          expect(saves[3].bytes.equals(content.subarray(2 * C + 100))).to.equal(
            true,
          );
        });

        it('completes without resending when a failed final chunk was fully written', async () => {
          contentsStub.save.onThirdCall().rejects(networkError());
          serverSizeIs(content.length);

          expect(await writeAndRunTimers()).to.equal(undefined);

          sinon.assert.calledThrice(contentsStub.save);
          sinon.assert.calledOnceWithExactly(contentsStub.rename, {
            path: TEMP,
            rename: { path: '/foo.bin' },
          });
          sinon.assert.calledOnceWithExactly(listener, [
            { type: FileChangeType.Changed, uri },
          ]);
        });

        it('backs off exponentially between retries', async () => {
          const failure = serverError();
          contentsStub.save.onSecondCall().rejects(failure);
          contentsStub.save.onThirdCall().rejects(failure);
          contentsStub.save.onCall(3).rejects(failure);
          serverSizeIs(C);
          const write = fs.writeFile(uri, content, opts);
          const base = UPLOAD_CHUNK_RETRY_BASE_DELAY_MS;

          // Each retry fires exactly when its delay elapses: 1x, 2x, then 4x
          // the base. A linear backoff would fire the third retry at 3x.
          for (const [delay, savesBefore] of [
            [base, 2],
            [2 * base, 3],
            [4 * base, 4],
          ] as const) {
            await clock.tickAsync(delay - 1);
            sinon.assert.callCount(contentsStub.save, savesBefore);
            await clock.tickAsync(1);
            // The retry fires now (and a successful one is followed straight
            // away by the next chunk).
            expect(contentsStub.save.callCount).to.be.greaterThan(savesBefore);
          }
          await clock.runAllAsync();
          await write;

          // Chunk 1, chunk 2 failing three times then succeeding, chunk 3.
          expect(contentsStub.save.callCount).to.equal(6);
        });

        it('resets the retry budget after a chunk succeeds', async () => {
          // Every chunk fails the maximum number of times before succeeding.
          // The server only grows when a save succeeds.
          let call = 0;
          let size = 0;
          contentsStub.get.callsFake(() =>
            Promise.resolve({ ...FOO_CONTENT_FILE, size }),
          );
          contentsStub.save.callsFake((req) => {
            call++;
            const attempt = (call - 1) % (UPLOAD_CHUNK_MAX_RETRIES + 1);
            if (attempt < UPLOAD_CHUNK_MAX_RETRIES) {
              return Promise.reject(networkError());
            }
            size += Buffer.from(req.model?.content ?? '', 'base64').length;
            return Promise.resolve(FOO_CONTENT_FILE);
          });

          expect(await writeAndRunTimers()).to.equal(undefined);

          expect(contentsStub.save.callCount).to.equal(
            3 * (UPLOAD_CHUNK_MAX_RETRIES + 1),
          );
          expect(size).to.equal(content.length);
        });

        it('gives up and rethrows after the maximum retries, leaving the temporary file', async () => {
          const failure = serverError();
          contentsStub.save.onSecondCall().rejects(failure);
          contentsStub.save.onThirdCall().rejects(failure);
          contentsStub.save.onCall(3).rejects(failure);
          contentsStub.save.onCall(4).rejects(failure);
          serverSizeIs(C);

          expect(await writeAndRunTimers())
            .to.be.instanceOf(Error)
            .with.property('message', 'Jupyter contents error: 503 ');

          // The first chunk, then the second chunk once plus three retries.
          expect(contentsStub.save.callCount).to.equal(
            2 + UPLOAD_CHUNK_MAX_RETRIES,
          );
          sinon.assert.notCalled(contentsStub.delete);
          sinon.assert.notCalled(contentsStub.rename);
        });

        it('leaves the original untouched when the first chunk exhausts its retries', async () => {
          const failure = serverError();
          contentsStub.save.rejects(failure);

          expect(await writeAndRunTimers())
            .to.be.instanceOf(Error)
            .with.property('message', 'Jupyter contents error: 503 ');

          expect(contentsStub.save.callCount).to.equal(
            1 + UPLOAD_CHUNK_MAX_RETRIES,
          );
          sinon.assert.notCalled(contentsStub.delete);
          sinon.assert.notCalled(contentsStub.rename);
          sinon.assert.notCalled(listener);
        });

        it('does not retry client errors', async () => {
          contentsStub.save.onSecondCall().rejects(TEAPOT);

          expect(await writeAndRunTimers())
            .to.be.instanceOf(Error)
            .with.property('message', 'Jupyter contents error: 418 ');

          sinon.assert.calledTwice(contentsStub.save);
          sinon.assert.notCalled(contentsStub.delete);
        });

        for (const [name, size, expected] of [
          ['below what the server had before the failed append', 10, 10],
          // One byte more than the failed append could have written.
          ['above the end of the failed append', 2 * C + 1, 2 * C + 1],
        ] as const) {
          it(`fails instead of resuming when the server size is ${name}`, async () => {
            contentsStub.save.onSecondCall().rejects(serverError());
            serverSizeIs(size);

            const err = await writeAndRunTimers();

            expect(err).to.be.instanceOf(Error);
            expect((err as Error).message).to.equal(
              `Cannot resume upload of ${TEMP}: expected between ${String(C)} and ${String(2 * C)} bytes on the server, found ${String(expected)}`,
            );
            sinon.assert.calledTwice(contentsStub.save);
            sinon.assert.notCalled(contentsStub.delete);
            sinon.assert.notCalled(contentsStub.rename);
          });
        }

        it('retries a failed size check', async () => {
          contentsStub.save.onSecondCall().rejects(serverError());
          contentsStub.get
            .withArgs({ path: TEMP, content: 0 })
            .onFirstCall()
            .rejects(networkError())
            .onSecondCall()
            .resolves({ ...FOO_CONTENT_FILE, size: C });

          expect(await writeAndRunTimers()).to.equal(undefined);

          expect(savedRanges().map((s) => s.chunk)).to.deep.equal([
            1, 2, 2, -1,
          ]);
        });

        it('stops retrying when disposed during the backoff', async () => {
          contentsStub.save.onSecondCall().rejects(serverError());
          serverSizeIs(C);
          const write = fs.writeFile(uri, content, opts).then(
            () => undefined,
            (e: unknown) => e,
          );
          await clock.tickAsync(0);

          fs.dispose();
          await clock.runAllAsync();

          const err = await write;
          expect(err).to.be.instanceOf(Error);
          expect((err as Error).message).to.match(/disposed/);
          sinon.assert.calledTwice(contentsStub.save);
        });
      });
    });

    it('throws file system no permissions error on content forbidden responses', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.get.rejects(FORBIDDEN);

      await expect(
        fs.writeFile(
          TestUri.parse('colab://r-abc123/foo.txt'),
          Buffer.from(''),
          { create: false, overwrite: false },
        ),
      ).to.eventually.rejectedWith(/NoPermissions/);
    });

    it('throws file system file not found error on content not found responses', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.save.rejects(NOT_FOUND);

      await expect(
        fs.writeFile(
          TestUri.parse('colab://r-abc123/foo.txt'),
          Buffer.from(''),
          { create: true, overwrite: true },
        ),
      ).to.eventually.rejectedWith(/FileNotFound/);
    });

    it('throws file system file exists error on content conflict responses', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.save.rejects(CONFLICT);

      await expect(
        fs.writeFile(
          TestUri.parse('colab://r-abc123/foo.txt'),
          Buffer.from(''),
          { create: true, overwrite: true },
        ),
      ).to.eventually.rejectedWith(/FileExists/);
    });

    it('throws unhandled content response errors', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.save.rejects(TEAPOT);

      await expect(
        fs.writeFile(
          TestUri.parse('colab://r-abc123/foo.txt'),
          Buffer.from(''),
          { create: true, overwrite: true },
        ),
      ).to.eventually.rejectedWith(TEAPOT.message);
    });

    describe('includes the Jupyter error in unhandled content response errors', () => {
      const tests: [string, Response, string][] = [
        [
          'message and reason',
          Response.json(
            { message: 'Disk full', reason: 'No space left on device' },
            { status: 500, statusText: 'Internal Server Error' },
          ),
          'Jupyter contents error: 500 Disk full (No space left on device)',
        ],
        [
          'message only',
          Response.json(
            { message: 'Disk full', reason: null },
            { status: 500, statusText: 'Internal Server Error' },
          ),
          'Jupyter contents error: 500 Disk full',
        ],
        [
          'an empty body, falling back to the status text',
          new Response(null, { status: 400, statusText: 'Bad Request' }),
          'Jupyter contents error: 400 Bad Request',
        ],
        [
          'a non-JSON body, falling back to the status text',
          new Response('<html>oops</html>', {
            status: 502,
            statusText: 'Bad Gateway',
          }),
          'Jupyter contents error: 502 Bad Gateway',
        ],
        [
          'JSON without a message, falling back to the status text',
          Response.json(
            { error: 'nope' },
            { status: 500, statusText: 'Internal Server Error' },
          ),
          'Jupyter contents error: 500 Internal Server Error',
        ],
        [
          'an empty message, falling back to the status text',
          Response.json(
            { message: '', reason: 'ignored' },
            { status: 500, statusText: 'Internal Server Error' },
          ),
          'Jupyter contents error: 500 Internal Server Error',
        ],
        [
          'a non-string reason, which is ignored',
          Response.json(
            { message: 'Disk full', reason: 42 },
            { status: 500, statusText: 'Internal Server Error' },
          ),
          'Jupyter contents error: 500 Disk full',
        ],
      ];
      for (const [name, response, expected] of tests) {
        it(name, async () => {
          const contentsStub = stubClient('r-abc123');
          contentsStub.get.rejects(NOT_FOUND);
          contentsStub.save.rejects(new ResponseError(response));

          const err: unknown = await fs
            .writeFile(
              TestUri.parse('colab://r-abc123/foo.txt'),
              Buffer.from('hello'),
              { create: true, overwrite: true },
            )
            .then(
              () => undefined,
              (e: unknown) => e,
            );

          expect(err).to.be.instanceOf(Error);
          expect((err as Error).message).to.equal(expected);
        });
      }
    });

    it('throws unhandled errors', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.save.rejects(new Error('🤮'));

      await expect(
        fs.writeFile(
          TestUri.parse('colab://r-abc123/foo.txt'),
          Buffer.from(''),
          { create: true, overwrite: true },
        ),
      ).to.eventually.rejectedWith('🤮');
    });
  });

  describe('delete', () => {
    it('throws when disposed', async () => {
      fs.dispose();

      await expect(
        fs.delete(TestUri.parse('colab://r-abc123/foo.txt'), {
          recursive: false,
        }),
      ).to.eventually.rejectedWith(/disposed/);
    });

    describe('directory with files', () => {
      let contentsStub: sinon.SinonStubbedInstance<ContentsApi>;

      beforeEach(() => {
        contentsStub = stubClient('r-abc123');
        // stat calls
        contentsStub.get
          .withArgs({ path: '/foo', content: 0 })
          .resolves(CONTENT_DIR.withoutContents);
        contentsStub.get
          .withArgs({ path: '/foo/foo.txt', content: 0 })
          .resolves(FOO_CONTENT_FILE);
        // readDirectory call
        contentsStub.get
          .withArgs({ path: '/foo', type: 'directory' })
          .resolves(CONTENT_DIR.withContents);
      });

      it('throws file system no permissions for non-recursive deletes', async () => {
        await expect(
          fs.delete(TestUri.parse('colab://r-abc123/foo'), {
            recursive: false,
          }),
        ).to.eventually.rejectedWith(/NoPermissions/);
      });

      it('recursively deletes directory', async () => {
        await fs.delete(TestUri.parse('colab://r-abc123/foo'), {
          recursive: true,
        });

        sinon.assert.calledWith(contentsStub.delete, { path: '/foo/foo.txt' });
        sinon.assert.calledWith(contentsStub.delete, { path: '/foo' });
      });
    });

    describe('file', () => {
      let contentsStub: sinon.SinonStubbedInstance<ContentsApi>;

      beforeEach(() => {
        contentsStub = stubClient('r-abc123');
        contentsStub.get
          .withArgs({ path: '/foo.txt', content: 0 })
          .resolves(FOO_CONTENT_FILE);
      });

      for (const recursive of [true, false]) {
        describe(`with recursive ${String(recursive)}`, () => {
          it('deletes the file', async () => {
            await fs.delete(TestUri.parse('colab://r-abc123/foo.txt'), {
              recursive,
            });

            sinon.assert.calledWith(contentsStub.delete, { path: '/foo.txt' });
          });

          it('throws file system no permissions error on content forbidden responses', async () => {
            contentsStub.delete.rejects(FORBIDDEN);

            await expect(
              fs.delete(TestUri.parse('colab://r-abc123/foo.txt'), {
                recursive,
              }),
            ).to.eventually.rejectedWith(/NoPermissions/);
          });

          it('throws file system file not found error on content not found responses', async () => {
            contentsStub.delete.rejects(NOT_FOUND);

            await expect(
              fs.delete(TestUri.parse('colab://r-abc123/foo.txt'), {
                recursive,
              }),
            ).to.eventually.rejectedWith(/FileNotFound/);
          });

          it('throws file system file exists error on content conflict responses', async () => {
            contentsStub.delete.rejects(CONFLICT);

            await expect(
              fs.delete(TestUri.parse('colab://r-abc123/foo.txt'), {
                recursive,
              }),
            ).to.eventually.rejectedWith(/FileExists/);
          });

          it('throws unhandled content response errors', async () => {
            contentsStub.delete.rejects(TEAPOT);

            await expect(
              fs.delete(TestUri.parse('colab://r-abc123/foo.txt'), {
                recursive,
              }),
            ).to.eventually.rejectedWith(TEAPOT.message);
          });

          it('throws unhandled errors', async () => {
            contentsStub.delete.rejects(new Error('🤮'));

            await expect(
              fs.delete(TestUri.parse('colab://r-abc123/foo.txt'), {
                recursive,
              }),
            ).to.eventually.rejectedWith('🤮');
          });
        });
      }
    });
  });

  describe('rename', () => {
    it('throws when disposed', async () => {
      fs.dispose();

      await expect(
        fs.rename(
          TestUri.parse('colab://r-abc123/foo.txt'),
          TestUri.parse('colab://r-abc123/bar.txt'),
          { overwrite: false },
        ),
      ).to.eventually.rejectedWith(/disposed/);
    });

    it('throws on cross-server renames', async () => {
      await expect(
        fs.rename(
          TestUri.parse('colab://r-abc123/foo.txt'),
          TestUri.parse('colab://r-def456/bar.txt'),
          { overwrite: false },
        ),
      ).to.eventually.rejectedWith(/not supported/);
    });

    it('throws file system file exists error if new URI already exists', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.get.resolves({
        name: 'bar.txt',
        path: '/bar.txt',
        type: 'file',
        writable: true,
        created: '2025-12-16T14:30:53.932129Z',
        lastModified: '2025-12-11T14:34:40Z',
        size: 0,
        mimetype: 'text/plain',
        content: '',
        format: 'text',
      });

      await expect(
        fs.rename(
          TestUri.parse('colab://r-abc123/foo.txt'),
          TestUri.parse('colab://r-abc123/bar.txt'),
          { overwrite: false },
        ),
      ).to.eventually.rejectedWith(/FileExists/);
    });

    it('renames file', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.get.rejects(NOT_FOUND);

      await fs.rename(
        TestUri.parse('colab://r-abc123/foo.txt'),
        TestUri.parse('colab://r-abc123/bar.txt'),
        { overwrite: false },
      );

      sinon.assert.calledWith(contentsStub.rename, {
        path: '/foo.txt',
        rename: { path: '/bar.txt' },
      });
    });

    it('renames existing file when configured to overwrite', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.get.withArgs({ path: '/bar.txt', content: 0 }).resolves({
        name: 'bar.txt',
        path: '/bar.txt',
        type: 'file',
        writable: true,
        created: '2025-12-16T14:30:53.932129Z',
        lastModified: '2025-12-11T14:34:40Z',
        size: 0,
        mimetype: 'text/plain',
        content: '',
        format: 'text',
      });

      await fs.rename(
        TestUri.parse('colab://r-abc123/foo.txt'),
        TestUri.parse('colab://r-abc123/bar.txt'),
        { overwrite: true },
      );

      sinon.assert.calledWith(contentsStub.rename, {
        path: '/foo.txt',
        rename: { path: '/bar.txt' },
      });
    });

    it('throws file system no permissions error on content forbidden responses', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.rename.rejects(FORBIDDEN);

      await expect(
        fs.rename(
          TestUri.parse('colab://r-abc123/foo.txt'),
          TestUri.parse('colab://r-abc123/bar.txt'),
          { overwrite: true },
        ),
      ).to.eventually.rejectedWith(/NoPermissions/);
    });

    it('throws file system file not found error on content not found responses', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.rename.rejects(NOT_FOUND);

      await expect(
        fs.rename(
          TestUri.parse('colab://r-abc123/foo.txt'),
          TestUri.parse('colab://r-abc123/bar.txt'),
          { overwrite: true },
        ),
      ).to.eventually.rejectedWith(/FileNotFound/);
    });

    it('throws file system file exists error on content conflict responses', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.rename.rejects(CONFLICT);

      await expect(
        fs.rename(
          TestUri.parse('colab://r-abc123/foo.txt'),
          TestUri.parse('colab://r-abc123/bar.txt'),
          { overwrite: true },
        ),
      ).to.eventually.rejectedWith(/FileExists/);
    });

    it('throws unhandled content response errors', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.rename.rejects(TEAPOT);

      await expect(
        fs.rename(
          TestUri.parse('colab://r-abc123/foo.txt'),
          TestUri.parse('colab://r-abc123/bar.txt'),
          { overwrite: true },
        ),
      ).to.eventually.rejectedWith(TEAPOT.message);
    });

    it('throws unhandled errors', async () => {
      const contentsStub = stubClient('r-abc123');
      contentsStub.rename.rejects(new Error('🤮'));

      await expect(
        fs.rename(
          TestUri.parse('colab://r-abc123/foo.txt'),
          TestUri.parse('colab://r-abc123/bar.txt'),
          { overwrite: true },
        ),
      ).to.eventually.rejectedWith('🤮');
    });
  });
});

function uriStringMatch(s: string): sinon.SinonMatcher {
  return sinon.match((u: Uri) => {
    return u.toString() === s;
  });
}
