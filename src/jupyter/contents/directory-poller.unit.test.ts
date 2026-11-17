/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon from 'sinon';
import { FileChangeEvent, Uri } from 'vscode';
import { TimeoutError } from '../../common/task-runner';
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
import { DirectoryPoller, TEST_ONLY } from './directory-poller';

const { POLL_INTERVAL_MS, TASK_TIMEOUT_MS } = TEST_ONLY;
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
  return { ...file(name), type: 'directory', size: undefined, mimetype: '' };
}

function listing(content: Contents[]): DirectoryContents {
  return { ...BASE_DIR, content };
}

describe('DirectoryPoller', () => {
  let vs: VsCodeStub;
  let clock: sinon.SinonFakeTimers;
  let client: sinon.SinonStubbedInstance<ContentsApi>;
  let getClient: sinon.SinonStub<[], Promise<ContentsApi | undefined>>;
  let listener: sinon.SinonStub<[FileChangeEvent[]]>;
  let onDidTerminate: sinon.SinonStub;
  let poller: DirectoryPoller | undefined;
  let uri: Uri;
  let getStarts: Deferred<void>[];
  let nextEvents: Deferred<FileChangeEvent[]>;
  let terminated: Deferred<void>;

  // Wait for a concrete request or callback rather than pumping microtasks.
  function pollStarted(index: number): Deferred<void> {
    return (getStarts[index] ??= new Deferred<void>());
  }

  function resolveGet(index: number, value: Contents): void {
    client.get.onCall(index).callsFake(() => {
      pollStarted(index).resolve();
      return Promise.resolve(value);
    });
  }

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
    nextEvents = new Deferred<FileChangeEvent[]>();
    terminated = new Deferred<void>();
    listener = sinon.stub<[FileChangeEvent[]]>().callsFake((events) => {
      nextEvents.resolve(events);
    });
    onDidTerminate = sinon.stub().callsFake(() => {
      terminated.resolve();
    });
    uri = TestUri.parse('colab://m-s-foo/foo');
  });

  afterEach(() => {
    poller?.dispose();
    sinon.restore();
  });

  it('polls immediately with a directory request and stops after dispose', async () => {
    resolveGet(0, listing([]));

    createPoller();
    await pollStarted(0).promise;

    sinon.assert.calledOnceWithExactly(
      client.get,
      { path: '/foo', type: ContentsGetTypeEnum.Directory },
      sinon.match.has('signal', sinon.match.instanceOf(AbortSignal)),
    );
    poller?.dispose();
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.calledOnce(client.get);
  });

  it('emits nothing for the initial snapshot or an unchanged listing', async () => {
    resolveGet(0, listing([file('a.txt')]));
    resolveGet(1, listing([file('a.txt')]));

    createPoller();
    await pollStarted(0).promise;
    await clock.tickAsync(POLL_INTERVAL_MS);

    sinon.assert.calledTwice(client.get);
    sinon.assert.notCalled(listener);
  });

  it('emits changed, deleted, and created entries in one ordered diff', async () => {
    resolveGet(0, listing([file('a.txt'), file('b.txt')]));
    resolveGet(
      1,
      listing([file('a.txt', '2026-01-01T00:01:00Z'), file('c.txt')]),
    );

    createPoller();
    await pollStarted(0).promise;
    await clock.tickAsync(POLL_INTERVAL_MS);
    await nextEvents.promise;

    sinon.assert.calledOnceWithExactly(listener, [
      {
        type: FileChangeType.Changed,
        uri: TestUri.joinPath(uri, 'a.txt'),
      },
      {
        type: FileChangeType.Deleted,
        uri: TestUri.joinPath(uri, 'b.txt'),
      },
      {
        type: FileChangeType.Created,
        uri: TestUri.joinPath(uri, 'c.txt'),
      },
    ]);
  });

  for (const [from, to] of [
    [file('a'), directory('a')],
    [directory('a'), file('a')],
  ]) {
    it(`emits Deleted then Created for a ${from.type}-to-${to.type} change`, async () => {
      resolveGet(0, listing([from]));
      resolveGet(1, listing([to]));

      createPoller();
      await pollStarted(0).promise;
      await clock.tickAsync(POLL_INTERVAL_MS);
      await nextEvents.promise;

      sinon.assert.calledOnceWithExactly(listener, [
        { type: FileChangeType.Deleted, uri: TestUri.joinPath(uri, 'a') },
        { type: FileChangeType.Created, uri: TestUri.joinPath(uri, 'a') },
      ]);
    });
  }

  it('emits Changed when the size or lastModified changes, even backwards', async () => {
    const original = [file('size'), file('later'), file('earlier')];
    const changed = [
      file('size', undefined, 2),
      file('later', '2026-01-01T00:01:00Z'),
      file('earlier', '2025-12-31T23:59:00Z'),
    ];
    resolveGet(0, listing(original));
    resolveGet(1, listing(changed));

    createPoller();
    await pollStarted(0).promise;
    await clock.tickAsync(POLL_INTERVAL_MS);
    await nextEvents.promise;

    sinon.assert.calledOnceWithExactly(
      listener,
      changed.map((child) => ({
        type: FileChangeType.Changed,
        uri: TestUri.joinPath(uri, child.name),
      })),
    );
  });

  it('treats a missing client as a quiet tick without backing off', async () => {
    const lookupStarted = new Deferred<void>();
    getClient.onFirstCall().callsFake(() => {
      lookupStarted.resolve();
      return Promise.resolve(undefined);
    });
    resolveGet(0, listing([]));

    createPoller();
    await lookupStarted.promise;
    sinon.assert.notCalled(client.get);
    await clock.tickAsync(POLL_INTERVAL_MS);

    sinon.assert.calledOnce(client.get);
    sinon.assert.notCalled(listener);
    sinon.assert.notCalled(onDidTerminate);
  });

  it('skips intervals, grows backoff on failures, and resets it after success', async () => {
    sinon.stub(Math, 'random').returns(0.5);
    rejectGet(0, new Error('offline'));
    rejectGet(1, new Error('still offline'));
    resolveGet(2, listing([]));
    rejectGet(3, new Error('offline again'));
    resolveGet(4, listing([]));

    createPoller(); // t=0: first failure, skip one interval.
    await pollStarted(0).promise;
    // t=5000: skipped (backoff).
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.calledOnce(client.get);
    // t=10000: second failure, skip two intervals.
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.calledTwice(client.get);
    // t=15000: skipped (backoff).
    await clock.tickAsync(POLL_INTERVAL_MS);
    // t=20000: skipped (backoff).
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.calledTwice(client.get);
    // t=25000: success resets the failure count.
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.calledThrice(client.get);
    // t=30000: failure starts again at one skipped interval.
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.callCount(client.get, 4);
    // t=35000: skipped (backoff).
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.callCount(client.get, 4);
    // t=40000: success.
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.callCount(client.get, 5);
  });

  it('lets a slow request time out and counts the timeout towards backoff', async () => {
    sinon.stub(Math, 'random').returns(0.5);
    const aborted = new Deferred<void>();
    client.get.onFirstCall().callsFake((_, options) => {
      const signal = (options as RequestInit).signal;
      pollStarted(0).resolve();
      return new Promise((_, reject) => {
        signal?.addEventListener('abort', () => {
          aborted.resolve();
          reject(new Error('request aborted'));
        });
      });
    });
    resolveGet(1, listing([]));

    createPoller(); // t=0: request hangs until its signal is aborted.
    await pollStarted(0).promise;
    // t=30000: timeout; the coincident interval is skipped (backoff).
    await clock.tickAsync(TASK_TIMEOUT_MS);
    await aborted.promise;

    sinon.assert.calledOnce(client.get);
    const signal = (client.get.firstCall.args[1] as RequestInit).signal;
    expect(signal?.reason).to.be.instanceOf(TimeoutError);
    // t=35000: retry after one skipped interval.
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.calledTwice(client.get);
  });

  for (const [reason, result] of [
    ['404', NOT_FOUND],
    ['400', BAD_TYPE],
    ['non-directory model', file('foo')],
  ] as const) {
    function terminalGet(index: number): void {
      if (result instanceof Error) {
        rejectGet(index, result);
      } else {
        resolveGet(index, result);
      }
    }

    it(`deletes an observed root and terminates once on ${reason}`, async () => {
      resolveGet(0, listing([]));
      terminalGet(1);

      createPoller();
      await pollStarted(0).promise;
      await clock.tickAsync(POLL_INTERVAL_MS);
      await terminated.promise;

      sinon.assert.calledOnceWithExactly(listener, [
        { type: FileChangeType.Deleted, uri },
      ]);
      sinon.assert.calledOnce(onDidTerminate);
      sinon.assert.callOrder(listener, onDidTerminate);
      // Self-termination disposes the poller; all public methods stay tolerant.
      expect(() => {
        poller?.suspend();
        poller?.resume();
        poller?.dispose();
      }).not.to.throw();
      await clock.tickAsync(POLL_INTERVAL_MS);
      sinon.assert.calledTwice(client.get);
      sinon.assert.calledOnce(listener);
      sinon.assert.calledOnce(onDidTerminate);
    });

    it(`terminates without Deleted when the first poll gets ${reason}`, async () => {
      terminalGet(0);

      createPoller();
      await terminated.promise;
      await clock.tickAsync(POLL_INTERVAL_MS);

      sinon.assert.notCalled(listener);
      sinon.assert.calledOnce(onDidTerminate);
      sinon.assert.calledOnce(client.get);
    });
  }

  it('suspends polling and immediately reports intervening changes on resume', async () => {
    resolveGet(0, listing([file('a')]));
    resolveGet(1, listing([file('a')]));
    resolveGet(2, listing([file('a'), file('b')]));

    createPoller();
    await pollStarted(0).promise;
    await clock.tickAsync(POLL_INTERVAL_MS);
    poller?.suspend();
    poller?.suspend();
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.calledTwice(client.get);

    poller?.resume();
    await nextEvents.promise;
    poller?.resume();

    sinon.assert.calledThrice(client.get);
    sinon.assert.calledOnceWithExactly(listener, [
      { type: FileChangeType.Created, uri: TestUri.joinPath(uri, 'b') },
    ]);
  });

  it('resumes past pending backoff without clearing consecutive failures', async () => {
    sinon.stub(Math, 'random').returns(0.5);
    resolveGet(0, listing([]));
    rejectGet(1, new Error('offline'));
    rejectGet(2, new Error('still offline'));
    resolveGet(3, listing([]));

    createPoller(); // t=0: initial snapshot.
    await pollStarted(0).promise;
    // t=5000: first failure arms one skipped interval.
    await clock.tickAsync(POLL_INTERVAL_MS);
    poller?.suspend();
    // t=10000: suspended, pending backoff is untouched.
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.calledTwice(client.get);
    // t=10000: resume retries immediately, with a second consecutive failure.
    poller?.resume();
    await pollStarted(2).promise;
    // t=15000: skipped (backoff).
    await clock.tickAsync(POLL_INTERVAL_MS);
    // t=20000: skipped (backoff), since the failure count was kept.
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.calledThrice(client.get);
    // t=25000: retry.
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.callCount(client.get, 4);
  });

  it('tolerates suspend, resume, and repeated dispose after disposal', async () => {
    resolveGet(0, listing([]));
    createPoller();
    await pollStarted(0).promise;
    poller?.dispose();

    expect(() => {
      poller?.suspend();
      poller?.resume();
      poller?.dispose();
    }).not.to.throw();
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.calledOnce(client.get);
    sinon.assert.notCalled(onDidTerminate);
  });

  it('emits nothing when an in-flight listing resolves after dispose', async () => {
    const response = new Deferred<Contents>();
    resolveGet(0, listing([]));
    client.get.onSecondCall().callsFake(() => {
      pollStarted(1).resolve();
      return response.promise;
    });

    createPoller();
    await pollStarted(0).promise;
    await clock.tickAsync(POLL_INTERVAL_MS);
    await pollStarted(1).promise;
    poller?.dispose();
    response.resolve(listing([file('a')]));
    await clock.tickAsync(POLL_INTERVAL_MS);

    expect((client.get.secondCall.args[1] as RequestInit).signal?.aborted).to.be
      .true;
    sinon.assert.calledTwice(client.get);
    sinon.assert.notCalled(listener);
    sinon.assert.notCalled(onDidTerminate);
  });
});
