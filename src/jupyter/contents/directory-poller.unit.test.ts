/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon from 'sinon';
import { FileChangeEvent, Uri } from 'vscode';
import { TestUri } from '../../test/helpers/uri';
import {
  FileChangeType,
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
import { DirectoryPoller } from './directory-poller';

const WATCH_INTERVAL_MS = 5000;
const WATCH_BACKOFF_CAP_MS = 300000;
const WATCH_TASK_TIMEOUT_MS = 30000;
const NOT_FOUND = new ResponseError(new Response(undefined, { status: 404 }));

const BASE_DIR: DirectoryContents = {
  name: 'foo',
  path: '/foo',
  type: 'directory',
  writable: true,
  created: '2026-01-01T00:00:00Z',
  lastModified: '2026-01-01T00:00:00Z',
  mimetype: '',
  content: [],
  format: '',
};

function file(
  name: string,
  lastModified = '2026-01-01T00:00:00Z',
  size = 1,
): Contents {
  return {
    name,
    path: `/foo/${name}`,
    type: 'file',
    writable: true,
    created: '2026-01-01T00:00:00Z',
    lastModified,
    size,
    mimetype: 'text/plain',
    content: '',
    format: '',
  };
}

function directory(name: string): Contents {
  return {
    ...file(name),
    path: `/foo/${name}`,
    type: 'directory',
    size: undefined,
    mimetype: '',
  };
}

function listing(content: Contents[]): DirectoryContents {
  return { ...BASE_DIR, content };
}

describe('DirectoryPoller', () => {
  let vs: VsCodeStub;
  let clock: sinon.SinonFakeTimers;
  let client: sinon.SinonStubbedInstance<ContentsApi>;
  let getClient: sinon.SinonStub<[], Promise<ContentsApi | undefined>>;
  let listener: sinon.SinonStub<[readonly FileChangeEvent[]]>;
  let poller: DirectoryPoller;
  let uri: Uri;

  async function advance(ms = WATCH_INTERVAL_MS): Promise<void> {
    await clock.tickAsync(ms);
  }

  function createPoller(): DirectoryPoller {
    return new DirectoryPoller({
      vs: vs.asVsCode(),
      uri,
      getClient,
      onDidChangeFile: listener,
      intervalMs: WATCH_INTERVAL_MS,
      maxBackoffMs: WATCH_BACKOFF_CAP_MS,
      taskTimeoutMs: WATCH_TASK_TIMEOUT_MS,
    });
  }

  beforeEach(() => {
    vs = newVsCodeStub();
    clock = sinon.useFakeTimers();
    client = sinon.createStubInstance(ContentsApi);
    getClient = sinon.stub<[], Promise<ContentsApi | undefined>>().resolves(
      client,
    );
    listener = sinon.stub();
    uri = TestUri.parse('colab://m-s-foo/foo');
    poller = createPoller();
    poller.addRef();
  });

  afterEach(() => {
    poller.dispose();
    sinon.restore();
  });

  it('takes an initial snapshot without firing file events', async () => {
    client.get.resolves(listing([file('a.txt')]));

    poller.start();
    await advance(0);

    sinon.assert.notCalled(listener);
    sinon.assert.calledOnceWithExactly(
      client.get,
      { path: '/foo', type: ContentsGetTypeEnum.Directory },
      sinon.match.has('signal'),
    );
  });

  it('fires created, changed, and deleted events by diffing directory listings', async () => {
    client.get.onFirstCall().resolves(listing([file('a.txt'), file('b.txt')]));
    client.get.onSecondCall().resolves(
      listing([
        file('a.txt', '2026-01-01T00:01:00Z'),
        file('c.txt'),
      ]),
    );

    poller.start();
    await advance(0);
    await advance();

    sinon.assert.calledOnceWithExactly(listener, [
      {
        type: FileChangeType.Deleted,
        uri: TestUri.parse('colab://m-s-foo/foo/b.txt'),
      },
      {
        type: FileChangeType.Changed,
        uri: TestUri.parse('colab://m-s-foo/foo/a.txt'),
      },
      {
        type: FileChangeType.Created,
        uri: TestUri.parse('colab://m-s-foo/foo/c.txt'),
      },
    ]);
  });

  it('fires delete and create when an entry changes between file and directory', async () => {
    client.get.onFirstCall().resolves(listing([file('a.txt')]));
    client.get.onSecondCall().resolves(listing([directory('a.txt')]));

    poller.start();
    await advance(0);
    await advance();

    sinon.assert.calledOnceWithExactly(listener, [
      {
        type: FileChangeType.Deleted,
        uri: TestUri.parse('colab://m-s-foo/foo/a.txt'),
      },
      {
        type: FileChangeType.Created,
        uri: TestUri.parse('colab://m-s-foo/foo/a.txt'),
      },
    ]);
  });

  it('backs off failed polls exponentially and resets after a success', async () => {
    client.get.onCall(0).resolves(listing([]));
    client.get.onCall(1).rejects(new Error('temporary failure'));
    client.get.onCall(2).rejects(new Error('temporary failure'));
    client.get.onCall(3).resolves(listing([file('a.txt')]));
    client.get.onCall(4).resolves(listing([file('a.txt'), file('b.txt')]));

    poller.start();
    await advance(0);
    await advance();
    sinon.assert.calledTwice(client.get);

    await advance();
    sinon.assert.calledThrice(client.get);

    await advance();
    sinon.assert.calledThrice(client.get);

    await advance();
    sinon.assert.callCount(client.get, 4);

    await advance();
    sinon.assert.callCount(client.get, 5);
  });

  it('fires changed events when size changes or mtime moves backwards', async () => {
    client.get
      .onCall(0)
      .resolves(listing([file('a.txt', '2026-01-01T00:01:00Z', 1)]));
    client.get
      .onCall(1)
      .resolves(listing([file('a.txt', '2026-01-01T00:00:00Z', 2)]));

    poller.start();
    await advance(0);
    await advance();

    sinon.assert.calledOnceWithExactly(listener, [
      {
        type: FileChangeType.Changed,
        uri: TestUri.parse('colab://m-s-foo/foo/a.txt'),
      },
    ]);
  });

  it('fires a deleted event for the watched directory and disposes on 404', async () => {
    client.get.onFirstCall().resolves(listing([]));
    client.get.onSecondCall().rejects(NOT_FOUND);

    poller.start();
    await advance(0);
    await advance();
    await advance();

    sinon.assert.calledOnceWithExactly(listener, [
      { type: FileChangeType.Deleted, uri },
    ]);
    sinon.assert.calledTwice(client.get);
  });

  it('suspends polling and refreshes immediately when resumed', async () => {
    client.get.onFirstCall().resolves(listing([]));
    client.get.onSecondCall().resolves(listing([file('a.txt')]));

    poller.start();
    await advance(0);
    poller.suspend();
    await advance(WATCH_INTERVAL_MS * 3);
    sinon.assert.calledOnce(client.get);

    poller.resume();
    await advance(0);

    sinon.assert.calledTwice(client.get);
    sinon.assert.calledOnceWithExactly(listener, [
      {
        type: FileChangeType.Created,
        uri: TestUri.parse('colab://m-s-foo/foo/a.txt'),
      },
    ]);
  });

  it('tracks references and stops polling when the last reference is released', async () => {
    client.get.resolves(listing([]));

    expect(poller.addRef()).to.equal(2);
    expect(poller.release()).to.equal(1);
    poller.start();
    await advance(0);

    expect(poller.release()).to.equal(0);
    await advance();

    sinon.assert.calledOnce(client.get);
  });

  it('clears watch state when the last reference is released', async () => {
    client.get.onCall(0).resolves(listing([]));
    client.get.onCall(1).resolves(listing([file('a.txt')]));

    poller.start();
    await advance(0);
    expect(poller.release()).to.equal(0);

    poller.addRef();
    poller.start();
    await advance(0);

    sinon.assert.notCalled(listener);
  });
});
