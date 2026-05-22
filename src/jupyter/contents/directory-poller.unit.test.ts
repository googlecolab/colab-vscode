/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
  let onDidTerminate: sinon.SinonStub;
  let poller: DirectoryPoller | undefined;
  let uri: Uri;

  async function advance(ms = WATCH_INTERVAL_MS): Promise<void> {
    await clock.tickAsync(ms);
  }

  async function flushInitialPoll(): Promise<void> {
    await clock.tickAsync(0);
  }

  async function flushMicrotasks(): Promise<void> {
    await clock.tickAsync(0);
  }

  function createPoller(): DirectoryPoller {
    poller = new DirectoryPoller({
      vs: vs.asVsCode(),
      uri,
      getClient,
      onDidChangeFile: listener,
      onDidTerminate,
      intervalMs: WATCH_INTERVAL_MS,
      maxBackoffMs: WATCH_BACKOFF_CAP_MS,
      taskTimeoutMs: WATCH_TASK_TIMEOUT_MS,
    });
    return poller;
  }

  beforeEach(() => {
    vs = newVsCodeStub();
    clock = sinon.useFakeTimers();
    client = sinon.createStubInstance(ContentsApi);
    getClient = sinon.stub<[], Promise<ContentsApi | undefined>>().resolves(
      client,
    );
    listener = sinon.stub();
    onDidTerminate = sinon.stub();
    uri = TestUri.parse('colab://m-s-foo/foo');
  });

  afterEach(() => {
    poller?.dispose();
    sinon.restore();
  });

  it('starts polling when constructed and stops when disposed', async () => {
    client.get.resolves(listing([]));

    createPoller();
    await flushInitialPoll();
    poller?.dispose();
    await advance();

    sinon.assert.calledOnce(client.get);
  });

  it('takes an initial snapshot without firing file events', async () => {
    client.get.resolves(listing([file('a.txt')]));

    createPoller();
    await flushInitialPoll();

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

    createPoller();
    await flushInitialPoll();
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

    createPoller();
    await flushInitialPoll();
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

  it('waits quietly during backoff before retrying failed polls', async () => {
    client.get.onCall(0).resolves(listing([]));
    client.get.onCall(1).rejects(new Error('temporary failure'));
    client.get.onCall(2).resolves(listing([]));

    createPoller();
    await flushInitialPoll();
    // t=5000: scheduled poll fails and schedules retry for t=10000.
    await advance();
    sinon.assert.calledTwice(client.get);

    // t=9999: retry timer has not fired, and the base interval is stopped.
    await advance(WATCH_INTERVAL_MS - 1);
    sinon.assert.calledTwice(client.get);

    // t=10000: retry timer fires and runs an immediate poll.
    await advance(1);
    sinon.assert.calledThrice(client.get);
  });

  it('backs off failed polls exponentially and resets after a success', async () => {
    client.get.onCall(0).resolves(listing([]));
    client.get.onCall(1).rejects(new Error('temporary failure'));
    client.get.onCall(2).rejects(new Error('temporary failure'));
    client.get.onCall(3).resolves(listing([]));
    client.get.onCall(4).resolves(listing([file('a.txt')]));

    createPoller();
    await flushInitialPoll();
    // t=5000: first failure schedules retry at t=10000.
    await advance();
    sinon.assert.calledTwice(client.get);

    // t=10000: second failure schedules retry at t=20000.
    await advance();
    sinon.assert.calledThrice(client.get);

    // t=15000: no retry yet because backoff doubled to 10000ms.
    await advance();
    sinon.assert.calledThrice(client.get);

    // t=20000: successful retry resets backoff and resumes base cadence.
    await advance();
    sinon.assert.callCount(client.get, 4);

    // t=25000: base cadence runs again after success.
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

    createPoller();
    await flushInitialPoll();
    await advance();

    sinon.assert.calledOnceWithExactly(listener, [
      {
        type: FileChangeType.Changed,
        uri: TestUri.parse('colab://m-s-foo/foo/a.txt'),
      },
    ]);
  });

  it('emits deleted and notifies owner when the watched directory is deleted', async () => {
    client.get.onFirstCall().resolves(listing([]));
    client.get.onSecondCall().rejects(NOT_FOUND);

    createPoller();
    await flushInitialPoll();
    await advance();
    await advance();

    sinon.assert.calledOnceWithExactly(listener, [
      { type: FileChangeType.Deleted, uri },
    ]);
    sinon.assert.calledOnce(onDidTerminate);
    sinon.assert.calledTwice(client.get);
  });

  it('suspends polling and refreshes immediately when resumed', async () => {
    client.get.onFirstCall().resolves(listing([]));
    client.get.onSecondCall().resolves(listing([file('a.txt')]));

    const directoryPoller = createPoller();
    await flushInitialPoll();
    directoryPoller.suspend();
    await advance(WATCH_INTERVAL_MS * 3);
    sinon.assert.calledOnce(client.get);

    directoryPoller.resume();
    await flushInitialPoll();

    sinon.assert.calledTwice(client.get);
    sinon.assert.calledOnceWithExactly(listener, [
      {
        type: FileChangeType.Created,
        uri: TestUri.parse('colab://m-s-foo/foo/a.txt'),
      },
    ]);
  });

  it('does not mutate state after disposal aborts an in-flight poll', async () => {
    let rejectRequest!: (error: unknown) => void;
    client.get.returns(
      new Promise<DirectoryContents>((_, reject) => {
        rejectRequest = reject;
      }),
    );

    createPoller();
    await flushInitialPoll();
    poller?.dispose();
    rejectRequest(new Error('aborted'));
    await flushMicrotasks();
    await advance(WATCH_INTERVAL_MS * 3);

    sinon.assert.notCalled(listener);
    sinon.assert.calledOnce(client.get);
  });

  it('keys snapshots by emitted URI string', async () => {
    client.get.onFirstCall().resolves(listing([file('a.txt')]));
    client.get.onSecondCall().resolves(
      listing([file('a.txt', '2026-01-01T00:01:00Z')]),
    );

    createPoller();
    await flushInitialPoll();
    await advance();

    sinon.assert.calledOnceWithExactly(listener, [
      {
        type: FileChangeType.Changed,
        uri: TestUri.parse('colab://m-s-foo/foo/a.txt'),
      },
    ]);
  });
});
