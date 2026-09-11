/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import sinon from 'sinon';
import { FileChangeEvent, Uri } from 'vscode';
import { Deferred } from '../../test/helpers/async';
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
const BAD_TYPE = new ResponseError(new Response(undefined, { status: 400 }));

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
  // Deterministic synchronization for the fire-and-forget poll loop: instead of
  // pumping the microtask queue with tickAsync(0), tests await the concrete
  // side-effects they care about — a specific poll starting, or an emission.
  let getStarts: Deferred<void>[];
  let nextEvents: Deferred<readonly FileChangeEvent[]>;

  // Advances fake time to the next scheduled poll. tickAsync also drains the
  // microtask queue between timers, so the prior poll's synchronous tail
  // (handleSuccess/diff/emit) completes before this resolves.
  async function advance(ms = WATCH_INTERVAL_MS): Promise<void> {
    await clock.tickAsync(ms);
  }

  // Resolves when the index-th client.get call begins (the poll has started),
  // letting tests await a poll without depending on the await depth of poll().
  function pollStarted(index: number): Deferred<void> {
    return (getStarts[index] ??= new Deferred<void>());
  }

  // Stubs the index-th client.get to resolve `value`, signalling start first.
  function resolveGet(index: number, value: DirectoryContents): void {
    client.get.onCall(index).callsFake(() => {
      pollStarted(index).resolve();
      return Promise.resolve(value);
    });
  }

  // Stubs the index-th client.get to reject, signalling start first.
  function rejectGet(index: number, error: Error): void {
    client.get.onCall(index).callsFake(() => {
      pollStarted(index).resolve();
      return Promise.reject(error);
    });
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
    getClient = sinon
      .stub<[], Promise<ContentsApi | undefined>>()
      .resolves(client);
    getStarts = [];
    nextEvents = new Deferred<readonly FileChangeEvent[]>();
    listener = sinon
      .stub<[readonly FileChangeEvent[]]>()
      .callsFake((events) => {
        nextEvents.resolve(events);
      });
    onDidTerminate = sinon.stub();
    uri = TestUri.parse('colab://m-s-foo/foo');
  });

  afterEach(() => {
    poller?.dispose();
    sinon.restore();
  });

  it('starts polling when constructed and stops when disposed', async () => {
    resolveGet(0, listing([]));

    createPoller();
    await pollStarted(0).promise;
    poller?.dispose();
    await advance();

    sinon.assert.calledOnce(client.get);
  });

  it('takes an initial snapshot without firing file events', async () => {
    resolveGet(0, listing([file('a.txt')]));

    createPoller();
    await pollStarted(0).promise;

    sinon.assert.notCalled(listener);
    sinon.assert.calledOnceWithExactly(
      client.get,
      { path: '/foo', type: ContentsGetTypeEnum.Directory },
      sinon.match.has('signal'),
    );
  });

  it('fires created, changed, and deleted events by diffing directory listings', async () => {
    resolveGet(0, listing([file('a.txt'), file('b.txt')]));
    resolveGet(
      1,
      listing([file('a.txt', '2026-01-01T00:01:00Z'), file('c.txt')]),
    );

    createPoller();
    await pollStarted(0).promise;
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
    resolveGet(0, listing([file('a.txt')]));
    resolveGet(1, listing([directory('a.txt')]));

    createPoller();
    await pollStarted(0).promise;
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
    resolveGet(0, listing([]));
    rejectGet(1, new Error('temporary failure'));
    resolveGet(2, listing([]));

    createPoller();
    await pollStarted(0).promise;
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
    resolveGet(0, listing([]));
    rejectGet(1, new Error('temporary failure'));
    rejectGet(2, new Error('temporary failure'));
    resolveGet(3, listing([]));
    resolveGet(4, listing([file('a.txt')]));

    createPoller();
    await pollStarted(0).promise;
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

  it('treats a missing client as a no-op tick without backing off', async () => {
    resolveGet(0, listing([]));
    resolveGet(1, listing([file('a.txt')]));
    getClient.onCall(0).resolves(client);
    getClient.onCall(1).resolves(undefined); // no live client on this tick
    getClient.onCall(2).resolves(client);

    createPoller();
    await pollStarted(0).promise;
    sinon.assert.calledOnce(client.get);

    // t=5000: no client -> no-op tick. No events, no terminal state, and the
    // base interval keeps running (it is not stopped on this path).
    await advance();
    sinon.assert.calledOnce(client.get);
    sinon.assert.notCalled(listener);
    sinon.assert.notCalled(onDidTerminate);

    // t=10000: the very next BASE-interval tick polls successfully, proving the
    // backoff stayed at the base interval rather than doubling.
    await advance();
    sinon.assert.calledTwice(client.get);
    sinon.assert.calledOnceWithExactly(listener, [
      {
        type: FileChangeType.Created,
        uri: TestUri.parse('colab://m-s-foo/foo/a.txt'),
      },
    ]);
  });

  it('leaves an elevated backoff untouched across a no-op tick', async () => {
    resolveGet(0, listing([])); // initial snapshot
    rejectGet(1, new Error('temporary failure')); // backoff doubles to 10000
    rejectGet(2, new Error('temporary failure')); // fails again at 10000
    resolveGet(3, listing([])); // elevated retry finally succeeds
    getClient.onCall(0).resolves(client);
    getClient.onCall(1).resolves(client);
    getClient.onCall(2).resolves(undefined); // retry tick: no-op
    getClient.onCall(3).resolves(client);
    getClient.onCall(4).resolves(client);

    createPoller();
    await pollStarted(0).promise;
    // t=5000: failure schedules a retry at t=10000; backoff doubles to 10000.
    await advance();
    sinon.assert.calledTwice(client.get);

    // t=10000: retry fires but the client is gone -> no-op. Backoff is neither
    // reset nor re-armed; the runner resumes the base interval.
    await advance();
    sinon.assert.calledTwice(client.get);

    // t=15000: the base tick fails, re-scheduling a retry at the preserved
    // elevated backoff (10000ms), i.e. the next attempt is at t=25000.
    await advance();
    sinon.assert.calledThrice(client.get);

    // t=20000: too early; a reset-to-5000 backoff would have fired here.
    await advance();
    sinon.assert.calledThrice(client.get);

    // t=25000: the elevated retry fires.
    await advance();
    sinon.assert.callCount(client.get, 4);
  });

  it('fires changed events when size changes or mtime moves backwards', async () => {
    resolveGet(0, listing([file('a.txt', '2026-01-01T00:01:00Z', 1)]));
    resolveGet(1, listing([file('a.txt', '2026-01-01T00:00:00Z', 2)]));

    createPoller();
    await pollStarted(0).promise;
    await advance();

    sinon.assert.calledOnceWithExactly(listener, [
      {
        type: FileChangeType.Changed,
        uri: TestUri.parse('colab://m-s-foo/foo/a.txt'),
      },
    ]);
  });

  it('emits deleted and notifies owner when the watched directory is deleted', async () => {
    resolveGet(0, listing([]));
    rejectGet(1, NOT_FOUND);

    createPoller();
    await pollStarted(0).promise;
    await advance();

    sinon.assert.calledOnceWithExactly(listener, [
      { type: FileChangeType.Deleted, uri },
    ]);
    sinon.assert.calledOnce(onDidTerminate);
    sinon.assert.calledTwice(client.get);
  });

  it('treats a 400 "bad type" response as terminal, not a transient failure', async () => {
    resolveGet(0, listing([]));
    // Stock Jupyter rejects type=directory on a file path with HTTP 400.
    rejectGet(1, BAD_TYPE);

    createPoller();
    await pollStarted(0).promise;
    await advance();

    sinon.assert.calledOnceWithExactly(listener, [
      { type: FileChangeType.Deleted, uri },
    ]);
    sinon.assert.calledOnce(onDidTerminate);
    sinon.assert.calledTwice(client.get);
  });

  it('treats a coerced non-directory model as terminal', async () => {
    resolveGet(0, listing([]));
    // A non-compliant contents manager may resolve a file model instead of 400.
    client.get.onCall(1).callsFake(() => {
      pollStarted(1).resolve();
      return Promise.resolve(file('foo'));
    });

    createPoller();
    await pollStarted(0).promise;
    await advance();

    sinon.assert.calledOnceWithExactly(listener, [
      { type: FileChangeType.Deleted, uri },
    ]);
    sinon.assert.calledOnce(onDidTerminate);
  });

  it('suspends polling and refreshes immediately when resumed', async () => {
    resolveGet(0, listing([]));
    resolveGet(1, listing([]));
    resolveGet(2, listing([file('a.txt')]));

    const directoryPoller = createPoller();
    await pollStarted(0).promise;
    // t=5000: a clean baseline poll completes before we suspend.
    await advance();
    sinon.assert.calledTwice(client.get);

    directoryPoller.suspend();
    // Suspended: the base interval does not fire, so no further polls.
    await advance(WATCH_INTERVAL_MS * 3);
    sinon.assert.calledTwice(client.get);

    directoryPoller.resume();
    await nextEvents.promise;

    sinon.assert.calledThrice(client.get);
    sinon.assert.calledOnceWithExactly(listener, [
      {
        type: FileChangeType.Created,
        uri: TestUri.parse('colab://m-s-foo/foo/a.txt'),
      },
    ]);
  });

  it('does not mutate state after disposal aborts an in-flight poll', async () => {
    let rejectRequest!: (error: unknown) => void;
    client.get.callsFake(() => {
      pollStarted(0).resolve();
      return new Promise<DirectoryContents>((_, reject) => {
        rejectRequest = reject;
      });
    });

    createPoller();
    await pollStarted(0).promise;
    poller?.dispose();
    rejectRequest(new Error('aborted'));
    await advance(WATCH_INTERVAL_MS * 3);

    sinon.assert.notCalled(listener);
    sinon.assert.calledOnce(client.get);
  });

  it('keys snapshots by emitted URI string', async () => {
    resolveGet(0, listing([file('a.txt')]));
    resolveGet(1, listing([file('a.txt', '2026-01-01T00:01:00Z')]));

    createPoller();
    await pollStarted(0).promise;
    await advance();

    sinon.assert.calledOnceWithExactly(listener, [
      {
        type: FileChangeType.Changed,
        uri: TestUri.parse('colab://m-s-foo/foo/a.txt'),
      },
    ]);
  });
});
