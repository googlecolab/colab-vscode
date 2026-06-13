/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon from 'sinon';
import { FileChangeEvent, Uri, WorkspaceConfiguration } from 'vscode';
import { TestUri } from '../../test/helpers/uri';
import {
  FileChangeType,
  newVsCodeStub,
} from '../../test/helpers/vscode';
import { DirectoryContents } from '../client/converters';
import {
  Contents,
  ContentsApi,
  ContentsGetTypeEnum,
  ResponseError,
} from '../client/generated';
import { ContentsFileWatcher, TEST_ONLY } from './file-watcher';

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

const ROOT_CONTENT_DIR: Contents = {
  ...FOO_CONTENT_DIR,
  name: 'content',
  path: '/',
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

const NOT_FOUND = new ResponseError(new Response(undefined, { status: 404 }));
const WATCH_POLL_INTERVAL_MS = TEST_ONLY.WATCH_POLL_INTERVAL_MS;

function uriStringMatch(s: string): sinon.SinonMatcher {
  return sinon.match((u: Uri) => u.toString() === s);
}

describe('ContentsFileWatcher', () => {
  let fakeClock: sinon.SinonFakeTimers;
  let vs: ReturnType<typeof newVsCodeStub>;
  let watcher: ContentsFileWatcher;
  let listener: sinon.SinonStub<[FileChangeEvent[]]>;
  let existingClients: Map<string, ContentsApi>;
  let getExistingClient: sinon.SinonStub<
    [string | Uri],
    Promise<ContentsApi | undefined>
  >;

  async function flushWatchRun() {
    await fakeClock.tickAsync(0);
  }

  function recreateWatcherWithConfig(options: {
    readonly pollIntervalMs?: number;
    readonly snapshotRequestConcurrency?: number;
    readonly maxSnapshotEntries?: number;
  }): void {
    watcher.dispose();
    const get = ((section: string, defaultValue?: unknown) => {
      if (typeof defaultValue !== 'number') {
        return defaultValue;
      }
      let value: number;
      switch (section) {
        case 'fileWatchPollIntervalMs':
          value = options.pollIntervalMs ?? defaultValue;
          break;
        case 'fileWatchSnapshotRequestConcurrency':
          value = options.snapshotRequestConcurrency ?? defaultValue;
          break;
        case 'fileWatchMaxSnapshotEntries':
          value = options.maxSnapshotEntries ?? defaultValue;
          break;
        default:
          value = defaultValue;
      }
      return value;
    }) as WorkspaceConfiguration['get'];
    listener = sinon.stub();
    getExistingClient = stubGetExistingClient();
    watcher = new ContentsFileWatcher(
      vs.asVsCode(),
      { get } as Pick<WorkspaceConfiguration, 'get'>,
      getExistingClient,
      listener,
    );
  }

  function stubGetExistingClient(): sinon.SinonStub<
    [string | Uri],
    Promise<ContentsApi | undefined>
  > {
    const stub: sinon.SinonStub<
      [string | Uri],
      Promise<ContentsApi | undefined>
    > = sinon.stub();
    return stub.callsFake((endpoint: string | Uri) =>
      Promise.resolve(
        existingClients.get(
          typeof endpoint === 'string' ? endpoint : endpoint.authority,
        ),
      ),
    );
  }

  function stubClient(endpoint: string): sinon.SinonStubbedInstance<ContentsApi> {
    const contentsStub = sinon.createStubInstance(ContentsApi);
    existingClients.set(endpoint, contentsStub);
    return contentsStub;
  }

  function stubWatchedRootDirectory(): {
    contentsStub: sinon.SinonStubbedInstance<ContentsApi>;
    rootContents: DirectoryContents;
    fooContents: DirectoryContents;
  } {
    const contentsStub = stubClient('m-s-foo');
    const rootContents: DirectoryContents = {
      ...ROOT_CONTENT_DIR,
      type: 'directory',
      content: [],
    };
    const fooContents: DirectoryContents = {
      ...FOO_CONTENT_DIR,
      type: 'directory',
      content: [],
    };
    contentsStub.get.callsFake((request) => {
      if (request.path === '/' && request.content === 0) {
        return Promise.resolve(ROOT_CONTENT_DIR);
      }
      if (
        request.path === '/' &&
        request.type === ContentsGetTypeEnum.Directory
      ) {
        return Promise.resolve(rootContents);
      }
      if (
        request.path === '/foo' &&
        request.type === ContentsGetTypeEnum.Directory
      ) {
        return Promise.resolve(fooContents);
      }
      return Promise.reject(
        new Error(
          `Unexpected contents.get request: ${JSON.stringify(request)}`,
        ),
      );
    });
    return { contentsStub, rootContents, fooContents };
  }

  beforeEach(() => {
    vs = newVsCodeStub();
    existingClients = new Map();
    listener = sinon.stub();
    getExistingClient = stubGetExistingClient();
    watcher = new ContentsFileWatcher(
      vs.asVsCode(),
      { get: () => undefined } as Pick<WorkspaceConfiguration, 'get'>,
      getExistingClient,
      listener,
    );
    fakeClock = sinon.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout'],
    });
  });

  afterEach(() => {
    watcher.dispose();
    fakeClock.restore();
  });



  it('returns a disposable and does not emit during the initial snapshot', async () => {
    stubWatchedRootDirectory();

    const watch = watcher.watch(TestUri.parse('colab://m-s-foo/'), false);

    expect(watch).to.have.property('dispose');
    await flushWatchRun();

    sinon.assert.notCalled(listener);
  });

  it('uses the configured watch poll interval', async () => {
    recreateWatcherWithConfig({ pollIntervalMs: 25 });
    const { rootContents } = stubWatchedRootDirectory();

    watcher.watch(TestUri.parse('colab://m-s-foo/'), false);
    await flushWatchRun();
    listener.resetHistory();

    rootContents.content = [FOO_CONTENT_FILE];
    await fakeClock.tickAsync(24);
    sinon.assert.notCalled(listener);

    await fakeClock.tickAsync(1);
    sinon.assert.calledOnceWithMatch(listener, [
      {
        type: FileChangeType.Created,
        uri: uriStringMatch('colab://m-s-foo/foo.txt'),
      },
    ]);
  });

  it('passes the poll abort signal to Jupyter contents requests', async () => {
    const { contentsStub } = stubWatchedRootDirectory();

    watcher.watch(TestUri.parse('colab://m-s-foo/'), false);
    await flushWatchRun();

    for (const call of contentsStub.get.getCalls()) {
      expect(call.args[1])
        .to.have.property('signal')
        .that.is.instanceOf(AbortSignal);
    }
  });

  it('stops recursive snapshot collection at the configured entry cap', async () => {
    recreateWatcherWithConfig({ maxSnapshotEntries: 1 });
    const { contentsStub, rootContents } = stubWatchedRootDirectory();
    rootContents.content = [FOO_CONTENT_DIR];

    watcher.watch(TestUri.parse('colab://m-s-foo/'), true);
    await flushWatchRun();

    sinon.assert.neverCalledWithMatch(contentsStub.get, {
      path: '/foo',
      type: ContentsGetTypeEnum.Directory,
    });
  });

  it('does not fabricate child create or delete events when a snapshot hits the entry cap', async () => {
    recreateWatcherWithConfig({ maxSnapshotEntries: 1 });
    const { rootContents, fooContents } = stubWatchedRootDirectory();
    rootContents.content = [FOO_CONTENT_FILE, FOO_CONTENT_DIR];
    fooContents.content = [];

    watcher.watch(TestUri.parse('colab://m-s-foo/'), true);
    await flushWatchRun();
    listener.resetHistory();

    rootContents.content = [FOO_CONTENT_DIR, FOO_CONTENT_FILE];
    await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

    sinon.assert.calledOnceWithMatch(listener, [
      {
        type: FileChangeType.Changed,
        uri: uriStringMatch('colab://m-s-foo/'),
      },
    ]);
  });

  it('does not repeat conservative root changes for unchanged capped snapshots', async () => {
    recreateWatcherWithConfig({ maxSnapshotEntries: 1 });
    const firstFile: Contents = {
      ...FOO_CONTENT_FILE,
      name: 'first.txt',
      path: '/first.txt',
    };
    const hiddenFile: Contents = {
      ...FOO_CONTENT_FILE,
      name: 'hidden.txt',
      path: '/hidden.txt',
    };
    const rootContents: DirectoryContents = {
      ...ROOT_CONTENT_DIR,
      type: 'directory',
      content: [firstFile, hiddenFile],
    };
    const contentsStub = stubClient('m-s-foo');
    contentsStub.get.callsFake((request) => {
      if (request.path === '/' && request.content === 0) {
        return Promise.resolve(ROOT_CONTENT_DIR);
      }
      if (
        request.path === '/' &&
        request.type === ContentsGetTypeEnum.Directory
      ) {
        return Promise.resolve(rootContents);
      }
      return Promise.reject(
        new Error(
          `Unexpected contents.get request: ${JSON.stringify(request)}`,
        ),
      );
    });

    watcher.watch(TestUri.parse('colab://m-s-foo/'), true);
    await flushWatchRun();
    listener.resetHistory();

    await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

    sinon.assert.notCalled(listener);
  });

  it('limits recursive snapshot directory requests', async () => {
    recreateWatcherWithConfig({ snapshotRequestConcurrency: 2 });
    const contentsStub = stubClient('m-s-foo');
    const childDirectories: Contents[] = ['a', 'b', 'c'].map((name) => ({
      ...FOO_CONTENT_DIR,
      name,
      path: `/${name}`,
    }));
    const rootContents: DirectoryContents = {
      ...ROOT_CONTENT_DIR,
      type: 'directory',
      content: childDirectories,
    };
    let inFlight = 0;
    let maxInFlight = 0;
    contentsStub.get.callsFake(async (request) => {
      if (request.path === '/' && request.content === 0) {
        return ROOT_CONTENT_DIR;
      }
      if (
        request.path === '/' &&
        request.type === ContentsGetTypeEnum.Directory
      ) {
        return rootContents;
      }
      if (
        childDirectories.some((entry) => entry.path === request.path) &&
        request.type === ContentsGetTypeEnum.Directory
      ) {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return {
          ...FOO_CONTENT_DIR,
          name: request.path.slice(1),
          path: request.path,
          type: 'directory',
          content: [],
        };
      }
      return Promise.reject(
        new Error(
          `Unexpected contents.get request: ${JSON.stringify(request)}`,
        ),
      );
    });

    watcher.watch(TestUri.parse('colab://m-s-foo/'), true);
    await flushWatchRun();

    expect(maxInFlight).to.equal(2);
  });

  it('does not create a Jupyter client while polling watches', async () => {
    watcher.watch(TestUri.parse('colab://m-s-foo/'), false);

    await flushWatchRun();

    sinon.assert.calledOnceWithExactly(
      getExistingClient,
      TestUri.parse('colab://m-s-foo/'),
    );
    sinon.assert.notCalled(listener);
  });

  it('uses the first existing client poll as the initial snapshot', async () => {
    watcher.watch(TestUri.parse('colab://m-s-foo/'), false);
    await flushWatchRun();

    const { rootContents } = stubWatchedRootDirectory();
    rootContents.content = [FOO_CONTENT_FILE];
    await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

    sinon.assert.notCalled(listener);
  });

  it('does not emit when a watched directory is unchanged', async () => {
    const { rootContents } = stubWatchedRootDirectory();
    rootContents.content = [FOO_CONTENT_FILE];

    watcher.watch(TestUri.parse('colab://m-s-foo/'), false);
    await flushWatchRun();
    listener.resetHistory();

    await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

    sinon.assert.notCalled(listener);
  });

  it('emits created and deleted events for direct child changes', async () => {
    const { rootContents } = stubWatchedRootDirectory();

    watcher.watch(TestUri.parse('colab://m-s-foo/'), false);
    await flushWatchRun();
    listener.resetHistory();

    rootContents.content = [FOO_CONTENT_FILE];
    await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

    sinon.assert.calledOnceWithMatch(listener, [
      {
        type: FileChangeType.Created,
        uri: uriStringMatch('colab://m-s-foo/foo.txt'),
      },
    ]);

    listener.resetHistory();
    rootContents.content = [];
    await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

    sinon.assert.calledOnceWithMatch(listener, [
      {
        type: FileChangeType.Deleted,
        uri: uriStringMatch('colab://m-s-foo/foo.txt'),
      },
    ]);
  });

  it('emits recursive events for nested directory changes', async () => {
    const { rootContents, fooContents } = stubWatchedRootDirectory();
    rootContents.content = [FOO_CONTENT_DIR];
    const nestedFile: Contents = {
      ...FOO_CONTENT_FILE,
      path: '/foo/foo.txt',
    };

    watcher.watch(TestUri.parse('colab://m-s-foo/'), true);
    await flushWatchRun();
    listener.resetHistory();

    fooContents.content = [nestedFile];
    await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

    sinon.assert.calledOnceWithMatch(listener, [
      {
        type: FileChangeType.Created,
        uri: uriStringMatch('colab://m-s-foo/foo/foo.txt'),
      },
    ]);
  });

  it('keeps ref-counted watches alive when a disposable is disposed twice', async () => {
    const contentsStub = stubClient('m-s-foo');
    const createdFile: Contents = {
      ...FOO_CONTENT_FILE,
      name: 'created.txt',
      path: '/created.txt',
    };
    const rootContents: DirectoryContents = {
      ...ROOT_CONTENT_DIR,
      type: 'directory',
      content: [],
    };
    contentsStub.get.callsFake((request) => {
      if (request.path === '/' && request.content === 0) {
        return Promise.resolve(ROOT_CONTENT_DIR);
      }
      if (
        request.path === '/' &&
        request.type === ContentsGetTypeEnum.Directory
      ) {
        return Promise.resolve(rootContents);
      }
      return Promise.reject(
        new Error(
          `Unexpected contents.get request: ${JSON.stringify(request)}`,
        ),
      );
    });

    const firstWatch = watcher.watch(TestUri.parse('colab://m-s-foo/'), false);
    watcher.watch(TestUri.parse('colab://m-s-foo/'), false);
    await flushWatchRun();
    listener.resetHistory();

    firstWatch.dispose();
    firstWatch.dispose();
    rootContents.content = [createdFile];
    await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

    sinon.assert.calledOnceWithMatch(listener, [
      {
        type: FileChangeType.Created,
        uri: uriStringMatch('colab://m-s-foo/created.txt'),
      },
    ]);
  });

  it('stops polling when the returned disposable is disposed', async () => {
    const { contentsStub } = stubWatchedRootDirectory();
    const watch = watcher.watch(TestUri.parse('colab://m-s-foo/'), false);
    await flushWatchRun();
    contentsStub.get.resetHistory();

    watch.dispose();
    await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

    sinon.assert.notCalled(contentsStub.get);
  });

  it('stops polling when the provider is disposed', async () => {
    const { contentsStub } = stubWatchedRootDirectory();
    watcher.watch(TestUri.parse('colab://m-s-foo/'), false);
    await flushWatchRun();
    contentsStub.get.resetHistory();

    watcher.dispose();
    await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

    sinon.assert.notCalled(contentsStub.get);
  });

  describe('file watch', () => {
    function stubWatchedFile(
      endpoint: string,
      path: string,
      initial: Contents,
    ): {
      contentsStub: sinon.SinonStubbedInstance<ContentsApi>;
      metadata: Contents;
    } {
      const contentsStub = stubClient(endpoint);
      const metadata = { ...initial };
      contentsStub.get.callsFake((request) => {
        if (request.path === path && request.content === 0) {
          return Promise.resolve({ ...metadata });
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });
      return { contentsStub, metadata };
    }

    it('emits changed when mtime advances', async () => {
      const { metadata } = stubWatchedFile(
        'm-s-foo',
        '/foo.txt',
        FOO_CONTENT_FILE,
      );

      watcher.watch(TestUri.parse('colab://m-s-foo/foo.txt'), false);
      await flushWatchRun();
      listener.resetHistory();

      metadata.lastModified = '2026-01-01T00:00:00Z';
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      sinon.assert.calledOnceWithMatch(listener, [
        {
          type: FileChangeType.Changed,
          uri: uriStringMatch('colab://m-s-foo/foo.txt'),
        },
      ]);
    });

    it('emits a single changed event when both mtime and size change', async () => {
      const { metadata } = stubWatchedFile(
        'm-s-foo',
        '/foo.txt',
        FOO_CONTENT_FILE,
      );

      watcher.watch(TestUri.parse('colab://m-s-foo/foo.txt'), false);
      await flushWatchRun();
      listener.resetHistory();

      metadata.lastModified = '2026-01-01T00:00:00Z';
      metadata.size = 99;
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      sinon.assert.calledOnce(listener);
      sinon.assert.calledOnceWithMatch(listener, [
        {
          type: FileChangeType.Changed,
          uri: uriStringMatch('colab://m-s-foo/foo.txt'),
        },
      ]);
    });

    it('emits changed when size changes', async () => {
      const { metadata } = stubWatchedFile(
        'm-s-foo',
        '/foo.txt',
        FOO_CONTENT_FILE,
      );

      watcher.watch(TestUri.parse('colab://m-s-foo/foo.txt'), false);
      await flushWatchRun();
      listener.resetHistory();

      metadata.size = 42;
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      sinon.assert.calledOnceWithMatch(listener, [
        {
          type: FileChangeType.Changed,
          uri: uriStringMatch('colab://m-s-foo/foo.txt'),
        },
      ]);
    });

    it('does not emit when file metadata is unchanged', async () => {
      stubWatchedFile('m-s-foo', '/foo.txt', FOO_CONTENT_FILE);

      watcher.watch(TestUri.parse('colab://m-s-foo/foo.txt'), false);
      await flushWatchRun();
      listener.resetHistory();

      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      sinon.assert.notCalled(listener);
    });
  });

  describe('resource presence transitions', () => {
    it('emits deleted when a watched file disappears', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.callsFake((request) => {
        if (request.path === '/foo.txt' && request.content === 0) {
          return Promise.resolve(FOO_CONTENT_FILE);
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });

      watcher.watch(TestUri.parse('colab://m-s-foo/foo.txt'), false);
      await flushWatchRun();
      listener.resetHistory();

      contentsStub.get.callsFake((request) => {
        if (request.path === '/foo.txt' && request.content === 0) {
          return Promise.reject(NOT_FOUND);
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      sinon.assert.calledOnceWithMatch(listener, [
        {
          type: FileChangeType.Deleted,
          uri: uriStringMatch('colab://m-s-foo/foo.txt'),
        },
      ]);
    });

    it('emits created when a previously absent resource appears', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.callsFake((request) => {
        if (request.path === '/foo.txt' && request.content === 0) {
          return Promise.reject(NOT_FOUND);
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });

      watcher.watch(TestUri.parse('colab://m-s-foo/foo.txt'), false);
      await flushWatchRun();
      listener.resetHistory();

      contentsStub.get.callsFake((request) => {
        if (request.path === '/foo.txt' && request.content === 0) {
          return Promise.resolve(FOO_CONTENT_FILE);
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      sinon.assert.calledOnceWithMatch(listener, [
        {
          type: FileChangeType.Created,
          uri: uriStringMatch('colab://m-s-foo/foo.txt'),
        },
      ]);
    });

    it('does not emit when a resource remains absent', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.callsFake((request) => {
        if (request.path === '/foo.txt' && request.content === 0) {
          return Promise.reject(NOT_FOUND);
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });

      watcher.watch(TestUri.parse('colab://m-s-foo/foo.txt'), false);
      await flushWatchRun();
      listener.resetHistory();

      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      sinon.assert.notCalled(listener);
    });
  });

  describe('kind transitions', () => {
    it('emits delete and create when a file becomes a directory', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.callsFake((request) => {
        if (request.path === '/foo' && request.content === 0) {
          return Promise.resolve(FOO_CONTENT_FILE);
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });

      watcher.watch(TestUri.parse('colab://m-s-foo/foo'), false);
      await flushWatchRun();
      listener.resetHistory();

      const fooAsDir: DirectoryContents = {
        ...FOO_CONTENT_DIR,
        type: 'directory',
        content: [],
      };
      contentsStub.get.callsFake((request) => {
        if (request.path === '/foo' && request.content === 0) {
          return Promise.resolve(FOO_CONTENT_DIR);
        }
        if (
          request.path === '/foo' &&
          request.type === ContentsGetTypeEnum.Directory
        ) {
          return Promise.resolve(fooAsDir);
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      sinon.assert.calledOnceWithMatch(listener, [
        {
          type: FileChangeType.Deleted,
          uri: uriStringMatch('colab://m-s-foo/foo'),
        },
        {
          type: FileChangeType.Created,
          uri: uriStringMatch('colab://m-s-foo/foo'),
        },
      ]);
    });

    it('emits delete and create when a directory becomes a file', async () => {
      const contentsStub = stubClient('m-s-foo');
      const fooAsDir: DirectoryContents = {
        ...FOO_CONTENT_DIR,
        type: 'directory',
        content: [],
      };
      contentsStub.get.callsFake((request) => {
        if (request.path === '/foo' && request.content === 0) {
          return Promise.resolve(FOO_CONTENT_DIR);
        }
        if (
          request.path === '/foo' &&
          request.type === ContentsGetTypeEnum.Directory
        ) {
          return Promise.resolve(fooAsDir);
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });

      watcher.watch(TestUri.parse('colab://m-s-foo/foo'), false);
      await flushWatchRun();
      listener.resetHistory();

      contentsStub.get.callsFake((request) => {
        if (request.path === '/foo' && request.content === 0) {
          return Promise.resolve({
            ...FOO_CONTENT_FILE,
            name: 'foo',
            path: '/foo',
          });
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      sinon.assert.calledOnceWithMatch(listener, [
        {
          type: FileChangeType.Deleted,
          uri: uriStringMatch('colab://m-s-foo/foo'),
        },
        {
          type: FileChangeType.Created,
          uri: uriStringMatch('colab://m-s-foo/foo'),
        },
      ]);
    });
  });

  describe('reference counting', () => {
    it('continues polling when one of multiple watchers disposes', async () => {
      const { contentsStub } = stubWatchedRootDirectory();
      const watch1 = watcher.watch(TestUri.parse('colab://m-s-foo/'), false);
      // Second watch increments refCount; we don't need the disposable.
      watcher.watch(TestUri.parse('colab://m-s-foo/'), false);
      await flushWatchRun();
      contentsStub.get.resetHistory();

      watch1.dispose();
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      sinon.assert.called(contentsStub.get);
    });

    it('stops polling only when all watchers for a URI dispose', async () => {
      const { contentsStub } = stubWatchedRootDirectory();
      const watch1 = watcher.watch(TestUri.parse('colab://m-s-foo/'), false);
      const watch2 = watcher.watch(TestUri.parse('colab://m-s-foo/'), false);
      await flushWatchRun();
      contentsStub.get.resetHistory();

      watch1.dispose();
      watch2.dispose();
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      sinon.assert.notCalled(contentsStub.get);
    });

    it('treats recursive and non-recursive watches as separate registrations', async () => {
      const { contentsStub } = stubWatchedRootDirectory();
      const watchDirect = watcher.watch(TestUri.parse('colab://m-s-foo/'), false);
      const watchRecursive = watcher.watch(TestUri.parse('colab://m-s-foo/'), true);
      await flushWatchRun();
      contentsStub.get.resetHistory();

      watchDirect.dispose();
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      // The recursive watch is still active, so polling continues.
      sinon.assert.called(contentsStub.get);

      contentsStub.get.resetHistory();
      watchRecursive.dispose();
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      sinon.assert.notCalled(contentsStub.get);
    });

    it('resumes polling when a new watch is registered after all prior watchers disposed', async () => {
      const { contentsStub, rootContents } = stubWatchedRootDirectory();
      const watch1 = watcher.watch(TestUri.parse('colab://m-s-foo/'), false);
      await flushWatchRun();

      watch1.dispose();
      contentsStub.get.resetHistory();
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);
      // Polling should have stopped.
      sinon.assert.notCalled(contentsStub.get);

      // Re-register a fresh watch on the same URI.
      watcher.watch(TestUri.parse('colab://m-s-foo/'), false);
      await flushWatchRun();
      listener.resetHistory();

      rootContents.content = [FOO_CONTENT_FILE];
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      sinon.assert.calledOnceWithMatch(listener, [
        {
          type: FileChangeType.Created,
          uri: uriStringMatch('colab://m-s-foo/foo.txt'),
        },
      ]);
    });

    it('no-ops when disposing an already-removed watch', async () => {
      stubWatchedRootDirectory();
      const watch = watcher.watch(TestUri.parse('colab://m-s-foo/'), false);
      await flushWatchRun();

      watch.dispose();
      // Second dispose should not throw.

      expect(() => {
        watch.dispose();
      }).to.not.throw();
    });

    it('skips a watch removed after the current poll cycle starts', async () => {
      const fooContentsStub = stubClient('m-s-foo');
      const barContentsStub = stubClient('m-s-bar');
      fooContentsStub.get
        .withArgs({ path: '/foo.txt', content: 0 })
        .resolves(FOO_CONTENT_FILE);
      barContentsStub.get
        .withArgs({ path: '/bar.txt', content: 0 })
        .resolves({ ...FOO_CONTENT_FILE, path: '/bar.txt' });

      watcher.watch(TestUri.parse('colab://m-s-foo/foo.txt'), false);
      const barWatch = watcher.watch(TestUri.parse('colab://m-s-bar/bar.txt'), false);
      await flushWatchRun();
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      let resolveFooMetadata!: (content: Contents) => void;
      const fooMetadata = new Promise<Contents>((resolve) => {
        resolveFooMetadata = resolve;
      });
      fooContentsStub.get.resetHistory();
      barContentsStub.get.resetHistory();
      fooContentsStub.get
        .withArgs({ path: '/foo.txt', content: 0 })
        .returns(fooMetadata);

      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      barWatch.dispose();
      resolveFooMetadata(FOO_CONTENT_FILE);
      await flushWatchRun();

      sinon.assert.notCalled(barContentsStub.get);
    });

    it('does not emit events for a watch disposed during its poll', async () => {
      const contentsStub = stubClient('m-s-foo');
      contentsStub.get.callsFake((request) => {
        if (request.path === '/foo.txt' && request.content === 0) {
          return Promise.resolve(FOO_CONTENT_FILE);
        }
        if (request.path === '/bar.txt' && request.content === 0) {
          return Promise.resolve({ ...FOO_CONTENT_FILE, path: '/bar.txt' });
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });
      const fooWatch = watcher.watch(TestUri.parse('colab://m-s-foo/foo.txt'), false);
      watcher.watch(TestUri.parse('colab://m-s-foo/bar.txt'), false);
      await flushWatchRun();
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      let resolveFooMetadata!: (content: Contents) => void;
      const fooMetadata = new Promise<Contents>((resolve) => {
        resolveFooMetadata = resolve;
      });
      contentsStub.get.callsFake((request) => {
        if (request.path === '/foo.txt' && request.content === 0) {
          return fooMetadata;
        }
        if (request.path === '/bar.txt' && request.content === 0) {
          return Promise.resolve({ ...FOO_CONTENT_FILE, path: '/bar.txt' });
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });
      listener.resetHistory();

      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);
      fooWatch.dispose();
      resolveFooMetadata({
        ...FOO_CONTENT_FILE,
        lastModified: '2026-01-01T00:00:00Z',
      });
      await flushWatchRun();

      sinon.assert.notCalled(listener);
    });

    it('does not emit queued events for a watch disposed later in the poll cycle', async () => {
      const contentsStub = stubClient('m-s-foo');
      const fooContents = { ...FOO_CONTENT_FILE, path: '/foo.txt' };
      const barContents = { ...FOO_CONTENT_FILE, path: '/bar.txt' };
      contentsStub.get.callsFake((request) => {
        if (request.path === '/foo.txt' && request.content === 0) {
          return Promise.resolve(fooContents);
        }
        if (request.path === '/bar.txt' && request.content === 0) {
          return Promise.resolve(barContents);
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });
      const fooWatch = watcher.watch(TestUri.parse('colab://m-s-foo/foo.txt'), false);
      watcher.watch(TestUri.parse('colab://m-s-foo/bar.txt'), false);
      await flushWatchRun();
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      let resolveBarMetadata!: (content: Contents) => void;
      const barMetadata = new Promise<Contents>((resolve) => {
        resolveBarMetadata = resolve;
      });
      contentsStub.get.callsFake((request) => {
        if (request.path === '/foo.txt' && request.content === 0) {
          return Promise.resolve({
            ...fooContents,
            lastModified: '2026-01-01T00:00:00Z',
          });
        }
        if (request.path === '/bar.txt' && request.content === 0) {
          return barMetadata;
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });
      listener.resetHistory();

      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);
      fooWatch.dispose();
      resolveBarMetadata(barContents);
      await flushWatchRun();

      sinon.assert.notCalled(listener);
    });
  });

  describe('covered roots deduplication', () => {
    it('coalesces duplicate events from overlapping recursive and direct watches', async () => {
      const contentsStub = stubClient('m-s-foo');
      const fileContents = {
        ...FOO_CONTENT_FILE,
        path: '/foo/bar.txt',
        name: 'bar.txt',
      };
      const rootContents: DirectoryContents = {
        ...ROOT_CONTENT_DIR,
        type: 'directory',
        content: [FOO_CONTENT_DIR],
      };
      const fooContents: DirectoryContents = {
        ...FOO_CONTENT_DIR,
        type: 'directory',
        content: [fileContents],
      };
      contentsStub.get.callsFake((request) => {
        if (request.path === '/' && request.content === 0) {
          return Promise.resolve(ROOT_CONTENT_DIR);
        }
        if (
          request.path === '/' &&
          request.type === ContentsGetTypeEnum.Directory
        ) {
          return Promise.resolve(rootContents);
        }
        if (
          request.path === '/foo' &&
          request.type === ContentsGetTypeEnum.Directory
        ) {
          return Promise.resolve(fooContents);
        }
        if (request.path === '/foo/bar.txt' && request.content === 0) {
          return Promise.resolve(fileContents);
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });

      watcher.watch(TestUri.parse('colab://m-s-foo/'), true);
      watcher.watch(TestUri.parse('colab://m-s-foo/foo/bar.txt'), false);
      await flushWatchRun();
      listener.resetHistory();
      contentsStub.get.resetHistory();

      fileContents.lastModified = '2026-01-01T00:00:00Z';
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      sinon.assert.calledOnce(listener);
      const events: FileChangeEvent[] = listener.firstCall.args[0];
      expect(events).to.have.lengthOf(1);
      expect(events[0]).to.deep.include({ type: FileChangeType.Changed });
      expect(events[0].uri.toString()).to.equal(
        'colab://m-s-foo/foo/bar.txt',
      );
    });

    it('does not lose child events when a recursive parent is disposed before emission', async () => {
      const contentsStub = stubClient('m-s-foo');
      const rootContents: DirectoryContents = {
        ...ROOT_CONTENT_DIR,
        type: 'directory',
        content: [FOO_CONTENT_DIR],
      };
      const fooContents: DirectoryContents = {
        ...FOO_CONTENT_DIR,
        type: 'directory',
        content: [],
      };
      let resolvePause: (() => void) | undefined;
      const pauseReady = new Promise<void>((resolve) => {
        resolvePause = resolve;
      });
      let pauseNextPoll = false;
      contentsStub.get.callsFake((request) => {
        if (request.path === '/' && request.content === 0) {
          return Promise.resolve(ROOT_CONTENT_DIR);
        }
        if (
          request.path === '/' &&
          request.type === ContentsGetTypeEnum.Directory
        ) {
          return Promise.resolve(rootContents);
        }
        if (request.path === '/foo' && request.content === 0) {
          return Promise.resolve(FOO_CONTENT_DIR);
        }
        if (
          request.path === '/foo' &&
          request.type === ContentsGetTypeEnum.Directory
        ) {
          return Promise.resolve(fooContents);
        }
        if (pauseNextPoll && request.path === '/pause.txt') {
          return pauseReady.then(() => ({
            ...FOO_CONTENT_FILE,
            path: '/pause.txt',
            name: 'pause.txt',
          }));
        }
        if (request.path === '/pause.txt' && request.content === 0) {
          return Promise.resolve({
            ...FOO_CONTENT_FILE,
            path: '/pause.txt',
            name: 'pause.txt',
          });
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });

      const parentWatch = watcher.watch(TestUri.parse('colab://m-s-foo/'), true);
      watcher.watch(TestUri.parse('colab://m-s-foo/foo'), false);
      watcher.watch(TestUri.parse('colab://m-s-foo/pause.txt'), false);

      await flushWatchRun();
      listener.resetHistory();

      fooContents.content = [
        { ...FOO_CONTENT_FILE, path: '/foo/bar.txt', name: 'bar.txt' },
      ];
      pauseNextPoll = true;
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);
      sinon.assert.notCalled(listener);

      parentWatch.dispose();
      resolvePause?.();
      await flushWatchRun();

      sinon.assert.calledOnceWithMatch(listener, [
        {
          type: FileChangeType.Created,
          uri: uriStringMatch('colab://m-s-foo/foo/bar.txt'),
        },
      ]);
    });
  });

  describe('error isolation', () => {
    it('continues polling other watches when one watch errors', async () => {
      const contentsStub = stubClient('m-s-foo');
      const rootContents: DirectoryContents = {
        ...ROOT_CONTENT_DIR,
        type: 'directory',
        content: [],
      };
      contentsStub.get.callsFake((request) => {
        if (request.path === '/' && request.content === 0) {
          return Promise.resolve(ROOT_CONTENT_DIR);
        }
        if (
          request.path === '/' &&
          request.type === ContentsGetTypeEnum.Directory
        ) {
          return Promise.resolve(rootContents);
        }
        if (request.path === '/broken' && request.content === 0) {
          return Promise.reject(new Error('network failure'));
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });

      // The broken watch will fail on every poll but should not prevent
      // the root watch from detecting changes.
      watcher.watch(TestUri.parse('colab://m-s-foo/broken'), false);
      watcher.watch(TestUri.parse('colab://m-s-foo/'), false);
      // Flush the initial poll and a second interval to ensure both
      // watches have been initialized (the first start+runNow may only
      // yield one poll cycle due to AllowToComplete).
      await flushWatchRun();
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);
      listener.resetHistory();

      rootContents.content = [FOO_CONTENT_FILE];
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      sinon.assert.calledOnceWithMatch(listener, [
        {
          type: FileChangeType.Created,
          uri: uriStringMatch('colab://m-s-foo/foo.txt'),
        },
      ]);
    });

    it('does not let a failing recursive parent suppress child watches', async () => {
      const contentsStub = stubClient('m-s-foo');
      const fooContents: DirectoryContents = {
        ...FOO_CONTENT_DIR,
        type: 'directory',
        content: [],
      };
      contentsStub.get.callsFake((request) => {
        if (request.path === '/' && request.content === 0) {
          return Promise.resolve(ROOT_CONTENT_DIR);
        }
        if (
          request.path === '/' &&
          request.type === ContentsGetTypeEnum.Directory
        ) {
          return Promise.reject(new Error('root snapshot failed'));
        }
        if (request.path === '/foo' && request.content === 0) {
          return Promise.resolve(FOO_CONTENT_DIR);
        }
        if (
          request.path === '/foo' &&
          request.type === ContentsGetTypeEnum.Directory
        ) {
          return Promise.resolve(fooContents);
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });

      watcher.watch(TestUri.parse('colab://m-s-foo/'), true);
      watcher.watch(TestUri.parse('colab://m-s-foo/foo'), false);
      await flushWatchRun();
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);
      listener.resetHistory();

      fooContents.content = [
        {
          ...FOO_CONTENT_FILE,
          name: 'bar.txt',
          path: '/foo/bar.txt',
        },
      ];
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      sinon.assert.calledOnceWithMatch(listener, [
        {
          type: FileChangeType.Created,
          uri: uriStringMatch('colab://m-s-foo/foo/bar.txt'),
        },
      ]);
    });

    it('does not fail the whole recursive watch when a nested directory disappears during traversal', async () => {
      const contentsStub = stubClient('m-s-foo');
      const rootContents: DirectoryContents = {
        ...ROOT_CONTENT_DIR,
        type: 'directory',
        content: [FOO_CONTENT_DIR],
      };
      const fooContents: DirectoryContents = {
        ...FOO_CONTENT_DIR,
        type: 'directory',
        content: [
          {
            ...FOO_CONTENT_FILE,
            name: 'old.txt',
            path: '/foo/old.txt',
          },
        ],
      };
      contentsStub.get.callsFake((request) => {
        if (request.path === '/' && request.content === 0) {
          return Promise.resolve(ROOT_CONTENT_DIR);
        }
        if (
          request.path === '/' &&
          request.type === ContentsGetTypeEnum.Directory
        ) {
          return Promise.resolve(rootContents);
        }
        if (request.path === '/foo' && request.content === 0) {
          return Promise.resolve(FOO_CONTENT_DIR);
        }
        if (
          request.path === '/foo' &&
          request.type === ContentsGetTypeEnum.Directory
        ) {
          return Promise.resolve(fooContents);
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });

      watcher.watch(TestUri.parse('colab://m-s-foo/'), true);
      await flushWatchRun();
      listener.resetHistory();

      rootContents.content = [
        FOO_CONTENT_DIR,
        {
          ...FOO_CONTENT_FILE,
          name: 'visible.txt',
          path: '/visible.txt',
        },
      ];
      contentsStub.get.callsFake((request) => {
        if (request.path === '/' && request.content === 0) {
          return Promise.resolve(ROOT_CONTENT_DIR);
        }
        if (
          request.path === '/' &&
          request.type === ContentsGetTypeEnum.Directory
        ) {
          return Promise.resolve(rootContents);
        }
        if (
          request.path === '/foo' &&
          request.type === ContentsGetTypeEnum.Directory
        ) {
          return Promise.reject(NOT_FOUND);
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      sinon.assert.calledOnceWithMatch(listener, [
        {
          type: FileChangeType.Changed,
          uri: uriStringMatch('colab://m-s-foo/'),
        },
      ]);
    });

    it('does not fail the whole recursive watch when a nested directory becomes a file during traversal', async () => {
      const contentsStub = stubClient('m-s-foo');
      const rootContents: DirectoryContents = {
        ...ROOT_CONTENT_DIR,
        type: 'directory',
        content: [FOO_CONTENT_DIR],
      };
      const fooContents: DirectoryContents = {
        ...FOO_CONTENT_DIR,
        type: 'directory',
        content: [
          {
            ...FOO_CONTENT_FILE,
            name: 'old.txt',
            path: '/foo/old.txt',
          },
        ],
      };
      contentsStub.get.callsFake((request) => {
        if (request.path === '/' && request.content === 0) {
          return Promise.resolve(ROOT_CONTENT_DIR);
        }
        if (
          request.path === '/' &&
          request.type === ContentsGetTypeEnum.Directory
        ) {
          return Promise.resolve(rootContents);
        }
        if (
          request.path === '/foo' &&
          request.type === ContentsGetTypeEnum.Directory
        ) {
          return Promise.resolve(fooContents);
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });

      watcher.watch(TestUri.parse('colab://m-s-foo/'), true);
      await flushWatchRun();
      listener.resetHistory();

      rootContents.content = [
        FOO_CONTENT_DIR,
        {
          ...FOO_CONTENT_FILE,
          name: 'visible.txt',
          path: '/visible.txt',
        },
      ];
      contentsStub.get.callsFake((request) => {
        if (request.path === '/' && request.content === 0) {
          return Promise.resolve(ROOT_CONTENT_DIR);
        }
        if (
          request.path === '/' &&
          request.type === ContentsGetTypeEnum.Directory
        ) {
          return Promise.resolve(rootContents);
        }
        if (
          request.path === '/foo' &&
          request.type === ContentsGetTypeEnum.Directory
        ) {
          return Promise.resolve({
            ...FOO_CONTENT_FILE,
            name: 'foo',
            path: '/foo',
          });
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      sinon.assert.calledOnceWithMatch(listener, [
        {
          type: FileChangeType.Changed,
          uri: uriStringMatch('colab://m-s-foo/'),
        },
      ]);
    });

    it('preserves watches across transient poll failures', async () => {
      const contentsStub = stubClient('m-s-foo');
      let rootContents: DirectoryContents = {
        ...ROOT_CONTENT_DIR,
        type: 'directory',
        content: [],
      };
      contentsStub.get.callsFake((request) => {
        if (request.path === '/' && request.content === 0) {
          return Promise.resolve(ROOT_CONTENT_DIR);
        }
        if (
          request.path === '/' &&
          request.type === ContentsGetTypeEnum.Directory
        ) {
          return Promise.resolve(rootContents);
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });

      watcher.watch(TestUri.parse('colab://m-s-foo/'), false);
      await flushWatchRun();
      listener.resetHistory();
      contentsStub.get.callsFake((request) => {
        if (request.path === '/' && request.content === 0) {
          return Promise.resolve(ROOT_CONTENT_DIR);
        }
        if (
          request.path === '/' &&
          request.type === ContentsGetTypeEnum.Directory
        ) {
          return Promise.reject(new Error('temporary network failure'));
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });

      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);
      sinon.assert.notCalled(listener);

      rootContents = {
        ...ROOT_CONTENT_DIR,
        type: 'directory',
        content: [FOO_CONTENT_FILE],
      };
      contentsStub.get.callsFake((request) => {
        if (request.path === '/' && request.content === 0) {
          return Promise.resolve(ROOT_CONTENT_DIR);
        }
        if (
          request.path === '/' &&
          request.type === ContentsGetTypeEnum.Directory
        ) {
          return Promise.resolve(rootContents);
        }
        return Promise.reject(
          new Error(
            `Unexpected contents.get request: ${JSON.stringify(request)}`,
          ),
        );
      });

      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      sinon.assert.calledOnceWithMatch(listener, [
        {
          type: FileChangeType.Created,
          uri: uriStringMatch('colab://m-s-foo/foo.txt'),
        },
      ]);
    });
  });

  describe('directory child metadata change', () => {
    it('emits changed when a child file mtime advances within a watched directory', async () => {
      const { rootContents } = stubWatchedRootDirectory();
      rootContents.content = [FOO_CONTENT_FILE];

      watcher.watch(TestUri.parse('colab://m-s-foo/'), false);
      await flushWatchRun();
      listener.resetHistory();

      rootContents.content = [
        { ...FOO_CONTENT_FILE, lastModified: '2026-01-01T00:00:00Z' },
      ];
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      sinon.assert.calledOnceWithMatch(listener, [
        {
          type: FileChangeType.Changed,
          uri: uriStringMatch('colab://m-s-foo/foo.txt'),
        },
      ]);
    });

    it('emits changed when a child file size changes within a watched directory', async () => {
      const { rootContents } = stubWatchedRootDirectory();
      rootContents.content = [FOO_CONTENT_FILE];

      watcher.watch(TestUri.parse('colab://m-s-foo/'), false);
      await flushWatchRun();
      listener.resetHistory();

      rootContents.content = [{ ...FOO_CONTENT_FILE, size: 1024 }];
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      sinon.assert.calledOnceWithMatch(listener, [
        {
          type: FileChangeType.Changed,
          uri: uriStringMatch('colab://m-s-foo/foo.txt'),
        },
      ]);
    });

    it('does not emit when a child file metadata is unchanged', async () => {
      const { rootContents } = stubWatchedRootDirectory();
      rootContents.content = [FOO_CONTENT_FILE];

      watcher.watch(TestUri.parse('colab://m-s-foo/'), false);
      await flushWatchRun();
      listener.resetHistory();

      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      sinon.assert.notCalled(listener);
    });

    it('emits changed for a nested file modification in a recursive watch', async () => {
      const { rootContents, fooContents } = stubWatchedRootDirectory();
      rootContents.content = [FOO_CONTENT_DIR];
      const nestedFile: Contents = {
        ...FOO_CONTENT_FILE,
        path: '/foo/foo.txt',
      };
      fooContents.content = [nestedFile];

      watcher.watch(TestUri.parse('colab://m-s-foo/'), true);
      await flushWatchRun();
      listener.resetHistory();

      fooContents.content = [
        { ...nestedFile, lastModified: '2026-06-01T00:00:00Z', size: 999 },
      ];
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      sinon.assert.calledOnceWithMatch(listener, [
        {
          type: FileChangeType.Changed,
          uri: uriStringMatch('colab://m-s-foo/foo/foo.txt'),
        },
      ]);
    });
  });

  describe('directory child type change', () => {
    it('emits delete and create when a child changes from file to directory', async () => {
      const { rootContents } = stubWatchedRootDirectory();
      rootContents.content = [FOO_CONTENT_FILE];

      watcher.watch(TestUri.parse('colab://m-s-foo/'), false);
      await flushWatchRun();
      listener.resetHistory();

      // Replace the file entry with a directory of the same name.
      rootContents.content = [
        { ...FOO_CONTENT_FILE, type: 'directory' } as Contents,
      ];
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      sinon.assert.calledOnceWithMatch(listener, [
        {
          type: FileChangeType.Deleted,
          uri: uriStringMatch('colab://m-s-foo/foo.txt'),
        },
        {
          type: FileChangeType.Created,
          uri: uriStringMatch('colab://m-s-foo/foo.txt'),
        },
      ]);
    });
  });

  describe('collapse nested entries', () => {
    it('collapses child events under a deleted parent directory', async () => {
      const { rootContents, fooContents } = stubWatchedRootDirectory();
      const nestedFile: Contents = {
        ...FOO_CONTENT_FILE,
        path: '/foo/bar.txt',
        name: 'bar.txt',
      };
      rootContents.content = [FOO_CONTENT_DIR];
      fooContents.content = [nestedFile];

      watcher.watch(TestUri.parse('colab://m-s-foo/'), true);
      await flushWatchRun();
      listener.resetHistory();

      // Remove the entire /foo directory (including its child).
      rootContents.content = [];
      fooContents.content = [];
      await fakeClock.tickAsync(WATCH_POLL_INTERVAL_MS);

      // Should emit a single Deleted event for /foo, not separate events
      // for both /foo and /foo/bar.txt.
      sinon.assert.calledOnce(listener);
      const events: FileChangeEvent[] = listener.firstCall.args[0];
      const deletedUris = events
        .filter((e) => e.type === vs.FileChangeType.Deleted)
        .map((e) => e.uri.toString());
      expect(deletedUris).to.include('colab://m-s-foo/foo');
      expect(deletedUris).to.not.include('colab://m-s-foo/foo/bar.txt');
    });
  });
});
