/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'crypto';
import { expect } from 'chai';
import sinon from 'sinon';
import { FileChangeEvent, Uri, WorkspaceFoldersChangeEvent } from 'vscode';
import { Variant } from '../../colab/api';
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
  ResponseError,
} from '../client/generated';
import { ColabAssignedServer } from '../servers';
import { ContentsFileSystemProvider } from './file-system';
import { JupyterConnectionManager } from './sessions';

const DEFAULT_SERVER: ColabAssignedServer = {
  id: randomUUID(),
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

const CONTENT_DIR_WITHOUT_CONTENT: Contents = {
  name: 'content',
  path: 'content',
  type: 'directory',
  writable: true,
  created: '2025-12-11T14:34:40Z',
  lastModified: '2025-12-16T14:30:53.932129Z',
  size: undefined,
  mimetype: '',
  content: '',
  format: '',
  hash: undefined,
  hashAlgorithm: undefined,
};

const CONTENT_DIR: {
  withoutContents: Contents;
  withContents: DirectoryContents;
} = {
  withoutContents: CONTENT_DIR_WITHOUT_CONTENT,
  withContents: {
    ...CONTENT_DIR_WITHOUT_CONTENT,
    type: 'directory',
    content: [
      {
        name: 'sample_data',
        path: '/sample_data',
        created: '2025-12-11T14:34:40Z',
        lastModified: '2025-12-16T14:30:53.932129Z',
        content: '',
        format: '',
        mimetype: '',
        size: 0,
        writable: true,
        hash: undefined,
        hashAlgorithm: undefined,
        type: 'directory',
      },
    ],
  },
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
    endpoint: string,
  ): sinon.SinonStubbedInstance<ContentsApi> {
    const contentsStub = sinon.createStubInstance(ContentsApi);
    jupyterStub.getOrCreate.withArgs(endpoint).resolves(contentsStub);
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
            uri: TestUri.parse('colab://m-s-foo/'),
            name: 'Colab CPU',
            index: 0,
          },
        ],
      });

      sinon.assert.calledOnceWithExactly(jupyterStub.drop, 'm-s-foo', true);
    });
  });

  describe('onDidRevokeConnection', () => {
    it("removes matching workspace folder when it's the only one", () => {
      vs.workspace.workspaceFolders = [
        {
          uri: TestUri.parse('colab://m-s-foo/'),
          name: 'Colab CPU',
          index: 0,
        },
      ];

      connectionEmitter.fire(['m-s-foo']);

      sinon.assert.calledWith(vs.workspace.updateWorkspaceFolders, 0, 1);
    });

    it("removes matching workspace folder when it's one of many", () => {
      vs.workspace.workspaceFolders = [
        {
          uri: TestUri.parse('colab://m-s-foo/'),
          name: 'Colab CPU',
          index: 0,
        },
        {
          uri: TestUri.parse('colab://m-s-bar/'),
          name: 'Colab GPU',
          index: 1,
        },
      ];

      connectionEmitter.fire(['m-s-bar']);

      sinon.assert.calledWith(vs.workspace.updateWorkspaceFolders, 0, 2, {
        uri: TestUri.parse('colab://m-s-foo/'),
        name: 'Colab CPU',
      });
    });

    it("removes matching workspace folder when it's one of many including other folders", () => {
      vs.workspace.workspaceFolders = [
        {
          uri: TestUri.parse('colab://m-s-foo/'),
          name: 'Colab CPU',
          index: 0,
        },
        {
          uri: TestUri.parse('file://usr/home/'),
          name: 'Not Colab',
          index: 1,
        },
        {
          uri: TestUri.parse('colab://m-s-bar/'),
          name: 'Colab GPU',
          index: 2,
        },
      ];

      connectionEmitter.fire(['m-s-foo', 'm-s-bar']);

      sinon.assert.calledWith(vs.workspace.updateWorkspaceFolders, 0, 3, {
        uri: TestUri.parse('file://usr/home/'),
        name: 'Not Colab',
      });
    });

    it("no-ops when the removed server doesn't map to a workspace folder", () => {
      vs.workspace.workspaceFolders = [
        {
          uri: TestUri.parse('colab://m-s-foo/'),
          name: 'Colab CPU',
          index: 0,
        },
      ];

      connectionEmitter.fire(['m-s-bar']);

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
        uri: TestUri.parse(`colab://${DEFAULT_SERVER.endpoint}/`),
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
          uri: uriStringMatch(`colab://${DEFAULT_SERVER.endpoint}/content`),
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
          uri: uriStringMatch(`colab://${DEFAULT_SERVER.endpoint}/content`),
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
          uri: TestUri.parse('colab://m-s-foo/content'),
          name: 'Colab CPU',
          index: 0,
        },
      ];
      vs.workspace.updateWorkspaceFolders
        .withArgs(1, 0, {
          uri: uriStringMatch(`colab://${DEFAULT_SERVER.endpoint}/content`),
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
        fs.watch(TestUri.parse('colab://m-s-foo/'), {
          recursive: false,
          excludes: [],
        });
      }).to.throw(/disposed/);
    });

    it('throws file system not found errors for VS Code files', () => {
      expect(() => {
        fs.watch(TestUri.parse('colab://m-s-foo/.vscode/launch.json'), {
          recursive: false,
          excludes: [],
        });
      }).to.throw(/FileNotFound/);
    });

    it('no-ops', () => {
      expect(
        fs.watch(TestUri.parse('colab://m-s-foo/'), {
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
        fs.stat(TestUri.parse('colab://m-s-foo/')),
      ).to.eventually.rejectedWith(/disposed/);
    });

    it('throws file system not found errors for VS Code files', async () => {
      await expect(
        fs.stat(TestUri.parse('colab://m-s-foo/.vscode')),
      ).to.eventually.rejectedWith(/FileNotFound/);
    });

    it('returns file stat', async () => {
      const contentsStub = stubClient('m-s-foo');
      const contents = CONTENT_DIR.withoutContents;
      contentsStub.get.withArgs({ path: '/', content: 0 }).resolves(contents);

      await expect(
        fs.stat(TestUri.parse('colab://m-s-foo/')),
      ).to.eventually.deep.equal({
        type: FileType.Directory,
        ctime: new Date(contents.created).getTime(),
        mtime: new Date(contents.lastModified).getTime(),
        size: 0,
      });
    });

    it('throws file system no permissions error on content forbidden responses', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.rejects(FORBIDDEN);

      await expect(
        fs.stat(TestUri.parse('colab://m-s-foo/')),
      ).to.eventually.rejectedWith(/NoPermissions/);
    });

    it('throws file system file not found error on content not found responses', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.rejects(NOT_FOUND);

      await expect(
        fs.stat(TestUri.parse('colab://m-s-foo/')),
      ).to.eventually.rejectedWith(/FileNotFound/);
    });

    it('throws file system file exists error on content conflict responses', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.rejects(CONFLICT);

      await expect(
        fs.stat(TestUri.parse('colab://m-s-foo/')),
      ).to.eventually.rejectedWith(/FileExists/);
    });

    it('throws unhandled content response errors', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.rejects(TEAPOT);

      await expect(
        fs.stat(TestUri.parse('colab://m-s-foo/')),
      ).to.eventually.rejectedWith(TEAPOT.message);
    });

    it('throws unhandled errors', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.rejects(new Error('🤮'));

      await expect(
        fs.stat(TestUri.parse('colab://m-s-foo/')),
      ).to.eventually.rejectedWith('🤮');
    });
  });

  describe('readDirectory', () => {
    it('throws when disposed', async () => {
      fs.dispose();

      await expect(
        fs.readDirectory(TestUri.parse('colab://m-s-foo/')),
      ).to.eventually.rejectedWith(/disposed/);
    });

    it('throws file system not found errors for VS Code files', async () => {
      await expect(
        fs.readDirectory(TestUri.parse('colab://m-s-foo/.vscode')),
      ).to.eventually.rejectedWith(/FileNotFound/);
    });

    it('throws file system file not a directory errors for non-directory URIs', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get
        .withArgs({ path: '/foo.txt', type: 'directory' })
        .resolves(FOO_CONTENT_FILE);

      await expect(
        fs.readDirectory(TestUri.parse('colab://m-s-foo/foo.txt')),
      ).to.eventually.rejectedWith(/FileNotADirectory/);
    });

    it("returns the directory's children file types", async () => {
      const contentsStub = stubClient('m-s-foo');
      const contents = CONTENT_DIR.withContents;
      contentsStub.get
        .withArgs({ path: '/', type: 'directory' })
        // TODO: Migrate to Open API 3.
        //
        // Unfortunately, the cast is currently needed since Swagger 2 (which
        // this client is generated from) does not support `oneOf` and
        // `contents` is currently incorrectly annotated as `string` when in
        // fact it is "The content, if requested (otherwise null).  Will be an
        // array if type is 'directory'".
        .resolves(contents as unknown as Contents);

      await expect(
        fs.readDirectory(TestUri.parse('colab://m-s-foo/')),
      ).to.eventually.deep.equal([
        [contents.content[0].name, FileType.Directory],
      ]);
    });

    it('throws file system no permissions error on content forbidden responses', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.rejects(FORBIDDEN);

      await expect(
        fs.readDirectory(TestUri.parse('colab://m-s-foo/')),
      ).to.eventually.rejectedWith(/NoPermissions/);
    });

    it('throws file system file not found error on content not found responses', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.rejects(NOT_FOUND);

      await expect(
        fs.readDirectory(TestUri.parse('colab://m-s-foo/')),
      ).to.eventually.rejectedWith(/FileNotFound/);
    });

    it('throws file system file exists error on content conflict responses', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.rejects(CONFLICT);

      await expect(
        fs.readDirectory(TestUri.parse('colab://m-s-foo/')),
      ).to.eventually.rejectedWith(/FileExists/);
    });

    it('throws unhandled content response errors', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.rejects(TEAPOT);

      await expect(
        fs.readDirectory(TestUri.parse('colab://m-s-foo/')),
      ).to.eventually.rejectedWith(TEAPOT.message);
    });

    it('throws unhandled errors', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.rejects(new Error('🤮'));

      await expect(
        fs.readDirectory(TestUri.parse('colab://m-s-foo/')),
      ).to.eventually.rejectedWith('🤮');
    });
  });

  describe('createDirectory', () => {
    it('throws when disposed', async () => {
      fs.dispose();

      await expect(
        fs.createDirectory(TestUri.parse('colab://m-s-foo/')),
      ).to.eventually.rejectedWith(/disposed/);
    });

    it('throws file system not found errors for VS Code files', async () => {
      await expect(
        fs.createDirectory(TestUri.parse('colab://m-s-foo/.vscode')),
      ).to.eventually.rejectedWith(/FileNotFound/);
    });

    it('saves the directory to contents when created', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.save.resolves(FOO_CONTENT_DIR);

      await fs.createDirectory(TestUri.parse('colab://m-s-foo/foo'));

      sinon.assert.calledWithMatch(contentsStub.save, {
        path: '/foo',
        model: {
          type: ContentsGetTypeEnum.Directory,
        },
      });
    });

    it('fires onDidChangeFile when created', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.save.resolves(FOO_CONTENT_DIR);

      await fs.createDirectory(TestUri.parse('colab://m-s-foo/foo'));

      sinon.assert.calledWith(listener, [
        {
          type: FileChangeType.Created,
          uri: uriStringMatch('colab://m-s-foo/foo'),
        },
      ]);
    });

    it('throws file system no permissions error on content forbidden responses', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.save.rejects(FORBIDDEN);

      await expect(
        fs.createDirectory(TestUri.parse('colab://m-s-foo/')),
      ).to.eventually.rejectedWith(/NoPermissions/);
    });

    it('throws file system file not found error on content not found responses', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.save.rejects(NOT_FOUND);

      await expect(
        fs.createDirectory(TestUri.parse('colab://m-s-foo/')),
      ).to.eventually.rejectedWith(/FileNotFound/);
    });

    it('throws file system file exists error on content conflict responses', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.save.rejects(CONFLICT);

      await expect(
        fs.createDirectory(TestUri.parse('colab://m-s-foo/')),
      ).to.eventually.rejectedWith(/FileExists/);
    });

    it('throws unhandled content response errors', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.save.rejects(TEAPOT);

      await expect(
        fs.createDirectory(TestUri.parse('colab://m-s-foo/')),
      ).to.eventually.rejectedWith(TEAPOT.message);
    });

    it('throws unhandled errors', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.save.rejects(new Error('🤮'));

      await expect(
        fs.createDirectory(TestUri.parse('colab://m-s-foo/')),
      ).to.eventually.rejectedWith('🤮');
    });
  });

  describe('readFile', () => {
    it('throws when disposed', async () => {
      fs.dispose();

      await expect(
        fs.readFile(TestUri.parse('colab://m-s-foo/foo.txt')),
      ).to.eventually.rejectedWith(/disposed/);
    });

    it('throws file system not found errors for VS Code files', async () => {
      await expect(
        fs.readFile(TestUri.parse('colab://m-s-foo/.vscode/settings.json')),
      ).to.eventually.rejectedWith(/FileNotFound/);
    });

    it('throws file system file is a directory when the contents are for a directory', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.resolves(CONTENT_DIR.withoutContents);

      await expect(
        fs.readFile(TestUri.parse('colab://m-s-foo/')),
      ).to.eventually.rejectedWith(/FileIsADirectory/);
    });

    it('throws file system file is a directory when the contents not base64 encoded', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.resolves({ ...FOO_CONTENT_FILE, format: 'text' });

      await expect(
        fs.readFile(TestUri.parse('colab://m-s-foo/foo.txt')),
      ).to.eventually.rejectedWith(/FileIsADirectory/);
    });

    it('throws file system file is a directory when the contents not a string', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.resolves(FOO_CONTENT_DIR);

      await expect(
        fs.readFile(TestUri.parse('colab://m-s-foo/foo.txt')),
      ).to.eventually.rejectedWith(/FileIsADirectory/);
    });

    it('returns a buffer of the the base64 encoded contents for a file', async () => {
      const contentsStub = stubClient('m-s-foo');
      const content = 'hello world';
      const encoded = Buffer.from(content).toString('base64');
      contentsStub.get.resolves({
        ...FOO_CONTENT_FILE,
        format: 'base64',
        content: encoded,
      });

      const result = await fs.readFile(
        TestUri.parse('colab://m-s-foo/foo.txt'),
      );

      expect(result).to.deep.equal(Buffer.from(content));
    });

    it('throws file system no permissions error on content forbidden responses', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.rejects(FORBIDDEN);

      await expect(
        fs.readFile(TestUri.parse('colab://m-s-foo/foo.txt')),
      ).to.eventually.rejectedWith(/NoPermissions/);
    });

    it('throws file system file not found error on content not found responses', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.rejects(NOT_FOUND);

      await expect(
        fs.readFile(TestUri.parse('colab://m-s-foo/foo.txt')),
      ).to.eventually.rejectedWith(/FileNotFound/);
    });

    it('throws file system file exists error on content conflict responses', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.rejects(CONFLICT);

      await expect(
        fs.readFile(TestUri.parse('colab://m-s-foo/foo.txt')),
      ).to.eventually.rejectedWith(/FileExists/);
    });

    it('throws unhandled content response errors', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.rejects(TEAPOT);

      await expect(
        fs.readFile(TestUri.parse('colab://m-s-foo/foo.txt')),
      ).to.eventually.rejectedWith(TEAPOT.message);
    });

    it('throws unhandled errors', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.rejects(new Error('🤮'));

      await expect(
        fs.readFile(TestUri.parse('colab://m-s-foo/foo.txt')),
      ).to.eventually.rejectedWith('🤮');
    });
  });

  describe('writeFile', () => {
    it('throws when disposed', async () => {
      fs.dispose();

      await expect(
        fs.writeFile(
          TestUri.parse('colab://m-s-foo/foo.txt'),
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
          contentsStub = stubClient('m-s-foo');
          if (existence === 'file exists') {
            contentsStub.get.resolves(FOO_CONTENT_FILE);
          } else {
            contentsStub.get.rejects(NOT_FOUND);
          }
        });

        it(outcome, async () => {
          const call = fs.writeFile(
            TestUri.parse('colab://m-s-foo/foo.txt'),
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
            TestUri.parse('colab://m-s-foo/foo.txt'),
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
                uri: uriStringMatch('colab://m-s-foo/foo.txt'),
              },
            ]);
          }
        });
      });
    }

    it('throws file system no permissions error on content forbidden responses', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.rejects(FORBIDDEN);

      await expect(
        fs.writeFile(
          TestUri.parse('colab://m-s-foo/foo.txt'),
          Buffer.from(''),
          { create: false, overwrite: false },
        ),
      ).to.eventually.rejectedWith(/NoPermissions/);
    });

    it('throws file system file not found error on content not found responses', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.save.rejects(NOT_FOUND);

      await expect(
        fs.writeFile(
          TestUri.parse('colab://m-s-foo/foo.txt'),
          Buffer.from(''),
          { create: true, overwrite: true },
        ),
      ).to.eventually.rejectedWith(/FileNotFound/);
    });

    it('throws file system file exists error on content conflict responses', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.save.rejects(CONFLICT);

      await expect(
        fs.writeFile(
          TestUri.parse('colab://m-s-foo/foo.txt'),
          Buffer.from(''),
          { create: true, overwrite: true },
        ),
      ).to.eventually.rejectedWith(/FileExists/);
    });

    it('throws unhandled content response errors', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.save.rejects(TEAPOT);

      await expect(
        fs.writeFile(
          TestUri.parse('colab://m-s-foo/foo.txt'),
          Buffer.from(''),
          { create: true, overwrite: true },
        ),
      ).to.eventually.rejectedWith(TEAPOT.message);
    });

    it('throws unhandled errors', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.save.rejects(new Error('🤮'));

      await expect(
        fs.writeFile(
          TestUri.parse('colab://m-s-foo/foo.txt'),
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
        fs.delete(TestUri.parse('colab://m-s-foo/foo.txt'), {
          recursive: false,
        }),
      ).to.eventually.rejectedWith(/disposed/);
    });

    it('throws file system no permissions for non-recursive deletes when directory has files', async () => {
      const contentsStub = stubClient('m-s-foo');
      // stat call
      contentsStub.get
        .withArgs({ path: '/foo', content: 0 })
        .resolves(CONTENT_DIR.withoutContents);
      // readDirectory call
      contentsStub.get
        .withArgs({ path: '/foo', type: 'directory' })
        // TODO: Migrate to Open API 3.
        //
        // Unfortunately, the cast is currently needed since Swagger 2 (which
        // this client is generated from) does not support `oneOf` and
        // `contents` is currently incorrectly annotated as `string` when in
        // fact it is "The content, if requested (otherwise null).  Will be an
        // array if type is 'directory'".
        .resolves(CONTENT_DIR.withContents as unknown as Contents);

      await expect(
        fs.delete(TestUri.parse('colab://m-s-foo/foo'), { recursive: false }),
      ).to.eventually.rejectedWith(/NoPermissions/);
    });

    it('recursively deletes directories', async () => {
      const contentsStub = stubClient('m-s-foo');

      await fs.delete(TestUri.parse('colab://m-s-foo/foo'), {
        recursive: true,
      });

      sinon.assert.calledWith(contentsStub.delete, { path: '/foo' });
    });

    it('deletes a file', async () => {
      const contentsStub = stubClient('m-s-foo');
      // When non-recursive, we check stat.
      contentsStub.get
        .withArgs({ path: '/foo.txt', content: 0 })
        .resolves(FOO_CONTENT_FILE);

      await fs.delete(TestUri.parse('colab://m-s-foo/foo.txt'), {
        recursive: false,
      });

      sinon.assert.calledWith(contentsStub.delete, { path: '/foo.txt' });
    });

    it('throws file system no permissions error on content forbidden responses', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.delete.rejects(FORBIDDEN);

      await expect(
        fs.delete(TestUri.parse('colab://m-s-foo/foo.txt'), {
          recursive: true,
        }),
      ).to.eventually.rejectedWith(/NoPermissions/);
    });

    it('throws file system file not found error on content not found responses', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.delete.rejects(NOT_FOUND);

      await expect(
        fs.delete(TestUri.parse('colab://m-s-foo/foo.txt'), {
          recursive: true,
        }),
      ).to.eventually.rejectedWith(/FileNotFound/);
    });

    it('throws file system file exists error on content conflict responses', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.delete.rejects(CONFLICT);

      await expect(
        fs.delete(TestUri.parse('colab://m-s-foo/foo.txt'), {
          recursive: true,
        }),
      ).to.eventually.rejectedWith(/FileExists/);
    });

    it('throws unhandled content response errors', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.delete.rejects(TEAPOT);

      await expect(
        fs.delete(TestUri.parse('colab://m-s-foo/foo.txt'), {
          recursive: true,
        }),
      ).to.eventually.rejectedWith(TEAPOT.message);
    });

    it('throws unhandled errors', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.delete.rejects(new Error('🤮'));

      await expect(
        fs.delete(TestUri.parse('colab://m-s-foo/foo.txt'), {
          recursive: true,
        }),
      ).to.eventually.rejectedWith('🤮');
    });
  });

  describe('rename', () => {
    it('throws when disposed', async () => {
      fs.dispose();

      await expect(
        fs.rename(
          TestUri.parse('colab://m-s-foo/foo.txt'),
          TestUri.parse('colab://m-s-foo/bar.txt'),
          { overwrite: false },
        ),
      ).to.eventually.rejectedWith(/disposed/);
    });

    it('throws on cross-server renames', async () => {
      await expect(
        fs.rename(
          TestUri.parse('colab://m-s-foo/foo.txt'),
          TestUri.parse('colab://m-s-bar/bar.txt'),
          { overwrite: false },
        ),
      ).to.eventually.rejectedWith(/not supported/);
    });

    it('throws file system file exists error if new URI already exists', async () => {
      const contentsStub = stubClient('m-s-foo');
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
          TestUri.parse('colab://m-s-foo/foo.txt'),
          TestUri.parse('colab://m-s-foo/bar.txt'),
          { overwrite: false },
        ),
      ).to.eventually.rejectedWith(/FileExists/);
    });

    it('renames file', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.rejects(NOT_FOUND);

      await fs.rename(
        TestUri.parse('colab://m-s-foo/foo.txt'),
        TestUri.parse('colab://m-s-foo/bar.txt'),
        { overwrite: false },
      );

      sinon.assert.calledWith(contentsStub.rename, {
        path: '/foo.txt',
        rename: { path: '/bar.txt' },
      });
    });

    it('renames existing file when configured to overwrite', async () => {
      const contentsStub = stubClient('m-s-foo');
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
        TestUri.parse('colab://m-s-foo/foo.txt'),
        TestUri.parse('colab://m-s-foo/bar.txt'),
        { overwrite: true },
      );

      sinon.assert.calledWith(contentsStub.rename, {
        path: '/foo.txt',
        rename: { path: '/bar.txt' },
      });
    });

    it('throws file system no permissions error on content forbidden responses', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.rename.rejects(FORBIDDEN);

      await expect(
        fs.rename(
          TestUri.parse('colab://m-s-foo/foo.txt'),
          TestUri.parse('colab://m-s-foo/bar.txt'),
          { overwrite: true },
        ),
      ).to.eventually.rejectedWith(/NoPermissions/);
    });

    it('throws file system file not found error on content not found responses', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.rename.rejects(NOT_FOUND);

      await expect(
        fs.rename(
          TestUri.parse('colab://m-s-foo/foo.txt'),
          TestUri.parse('colab://m-s-foo/bar.txt'),
          { overwrite: true },
        ),
      ).to.eventually.rejectedWith(/FileNotFound/);
    });

    it('throws file system file exists error on content conflict responses', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.rename.rejects(CONFLICT);

      await expect(
        fs.rename(
          TestUri.parse('colab://m-s-foo/foo.txt'),
          TestUri.parse('colab://m-s-foo/bar.txt'),
          { overwrite: true },
        ),
      ).to.eventually.rejectedWith(/FileExists/);
    });

    it('throws unhandled content response errors', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.rename.rejects(TEAPOT);

      await expect(
        fs.rename(
          TestUri.parse('colab://m-s-foo/foo.txt'),
          TestUri.parse('colab://m-s-foo/bar.txt'),
          { overwrite: true },
        ),
      ).to.eventually.rejectedWith(TEAPOT.message);
    });

    it('throws unhandled errors', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.rename.rejects(new Error('🤮'));

      await expect(
        fs.rename(
          TestUri.parse('colab://m-s-foo/foo.txt'),
          TestUri.parse('colab://m-s-foo/bar.txt'),
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
