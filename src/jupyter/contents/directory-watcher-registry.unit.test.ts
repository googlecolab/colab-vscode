/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon from 'sinon';
import { FileChangeEvent, Uri, WindowState } from 'vscode';
import { Deferred } from '../../test/helpers/async';
import { TestEventEmitter } from '../../test/helpers/events';
import { TestUri } from '../../test/helpers/uri';
import {
  FileChangeType,
  newVsCodeStub,
  VsCodeStub,
} from '../../test/helpers/vscode';
import { DirectoryContents } from '../client/converters';
import { Contents, ContentsApi, ResponseError } from '../client/generated';
import { TEST_ONLY } from './directory-poller';
import { DirectoryWatcherRegistry } from './directory-watcher-registry';
import { JupyterConnectionManager } from './sessions';

const { POLL_INTERVAL_MS } = TEST_ONLY;
const EMPTY_DIRECTORY: DirectoryContents = {
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

const CHILD: Contents = {
  ...EMPTY_DIRECTORY,
  name: 'a.txt',
  path: '/foo/a.txt',
  type: 'file',
  content: '',
};

const NOT_FOUND = new ResponseError(new Response(undefined, { status: 404 }));

describe('DirectoryWatcherRegistry', () => {
  let vs: VsCodeStub;
  let clock: sinon.SinonFakeTimers;
  let connections: sinon.SinonStubbedInstance<JupyterConnectionManager>;
  let client: sinon.SinonStubbedInstance<ContentsApi>;
  let revoked: TestEventEmitter<string[]>;
  let windowState: TestEventEmitter<WindowState>;
  let listener: sinon.SinonStub<[FileChangeEvent[]]>;
  let nextEvents: Deferred<FileChangeEvent[]>;
  let registry: DirectoryWatcherRegistry;
  let uri: Uri;
  let getStarts: Deferred<void>[];

  function pollStarted(index: number): Deferred<void> {
    return (getStarts[index] ??= new Deferred<void>());
  }

  function setFocused(focused: boolean): void {
    Object.assign(vs.window.state, { focused });
    windowState.fire(vs.window.state);
  }

  beforeEach(() => {
    vs = newVsCodeStub();
    clock = sinon.useFakeTimers();
    connections = sinon.createStubInstance(JupyterConnectionManager);
    revoked = new TestEventEmitter();
    // Needed to work around the property being readonly.
    Object.defineProperty(connections, 'onDidRevokeConnections', {
      value: sinon.stub().callsFake(revoked.event),
    });
    windowState = new TestEventEmitter();
    vs.window.onDidChangeWindowState.callsFake(windowState.event);
    client = sinon.createStubInstance(ContentsApi);
    connections.get.resolves(client);
    getStarts = [];
    client.get.callsFake(() => {
      pollStarted(client.get.callCount - 1).resolve();
      return Promise.resolve(EMPTY_DIRECTORY);
    });
    nextEvents = new Deferred<FileChangeEvent[]>();
    listener = sinon.stub<[FileChangeEvent[]]>().callsFake((events) => {
      nextEvents.resolve(events);
    });
    uri = TestUri.parse('colab://server-a/foo');
    registry = new DirectoryWatcherRegistry(
      vs.asVsCode(),
      connections,
      listener,
    );
  });

  afterEach(() => {
    registry.dispose();
    sinon.restore();
  });

  it('shares a poller and releases each handle only once', async () => {
    const first = registry.watch(uri);
    const second = registry.watch(TestUri.parse(uri.toString()));
    await pollStarted(0).promise;
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.calledTwice(client.get);
    sinon.assert.alwaysCalledWithExactly(connections.get, 'server-a');
    sinon.assert.notCalled(connections.getOrCreate);

    first.dispose();
    first.dispose();
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.calledThrice(client.get);

    second.dispose();
    await clock.tickAsync(POLL_INTERVAL_MS * 2);
    sinon.assert.calledThrice(client.get);
  });

  it('polls different directories independently', async () => {
    const first = registry.watch(uri);
    registry.watch(TestUri.parse('colab://server-a/bar'));
    await pollStarted(1).promise;
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.callCount(client.get, 4);
    expect(
      client.get.getCalls().map((call) => call.args[0].path),
    ).to.deep.equal(['/foo', '/bar', '/foo', '/bar']);

    first.dispose();
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.callCount(client.get, 5);
    expect(client.get.lastCall.args[0].path).to.equal('/bar');
  });

  it('forwards poller events to the change callback', async () => {
    client.get
      .onSecondCall()
      .resolves({ ...EMPTY_DIRECTORY, content: [CHILD] });
    registry.watch(uri);
    await pollStarted(0).promise;
    await clock.tickAsync(POLL_INTERVAL_MS);
    await nextEvents.promise;

    sinon.assert.calledOnceWithExactly(listener, [
      { type: FileChangeType.Created, uri: TestUri.joinPath(uri, CHILD.name) },
    ]);
  });

  it('drops a gone directory and ignores stale handles after a fresh watch', async () => {
    client.get.onSecondCall().rejects(NOT_FOUND);
    const stale = registry.watch(uri);
    await pollStarted(0).promise;
    await clock.tickAsync(POLL_INTERVAL_MS);
    await nextEvents.promise;
    sinon.assert.calledOnceWithExactly(listener, [
      { type: FileChangeType.Deleted, uri },
    ]);
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.calledTwice(client.get);

    const fresh = registry.watch(uri);
    await pollStarted(2).promise;
    stale.dispose();
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.callCount(client.get, 4);

    fresh.dispose();
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.callCount(client.get, 4);
  });

  it('drops only revoked servers and ignores their stale handles', async () => {
    const stale = registry.watch(uri);
    registry.watch(TestUri.parse('colab://server-a/bar'));
    registry.watch(TestUri.parse('colab://server-b/foo'));
    await pollStarted(2).promise;
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.callCount(client.get, 6);

    revoked.fire(['server-a', 'unknown']);
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.callCount(client.get, 7);
    expect(connections.get.lastCall.args).to.deep.equal(['server-b']);

    registry.watch(uri);
    await pollStarted(7).promise;
    stale.dispose();
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.callCount(client.get, 10);
  });

  it('suspends on blur and polls immediately on focus', async () => {
    registry.watch(uri);
    await pollStarted(0).promise;
    await clock.tickAsync(POLL_INTERVAL_MS);
    setFocused(false);
    setFocused(false);
    await clock.tickAsync(POLL_INTERVAL_MS * 2);
    sinon.assert.calledTwice(client.get);

    setFocused(true);
    await pollStarted(2).promise;
    setFocused(true);
    sinon.assert.calledThrice(client.get);
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.callCount(client.get, 4);
  });

  it('does not poll a watch created while unfocused until focus', async () => {
    setFocused(false);
    registry.watch(uri);
    await clock.tickAsync(POLL_INTERVAL_MS * 2);
    sinon.assert.notCalled(client.get);

    setFocused(true);
    await pollStarted(0).promise;
    sinon.assert.calledOnce(client.get);
    await clock.tickAsync(POLL_INTERVAL_MS);
    sinon.assert.calledTwice(client.get);
  });

  it('treats a rejected client lookup as a quiet tick', async () => {
    connections.get.onFirstCall().rejects(new Error('unauthorized'));
    registry.watch(uri);
    await clock.tickAsync(POLL_INTERVAL_MS);

    sinon.assert.calledTwice(connections.get);
    sinon.assert.calledOnce(client.get);
    sinon.assert.notCalled(listener);
  });

  it('stops every poller, removes listeners, and rejects watches after disposal', async () => {
    const handle = registry.watch(uri);
    registry.watch(TestUri.parse('colab://server-b/bar'));
    await pollStarted(1).promise;
    expect(revoked.hasListeners()).to.be.true;
    expect(windowState.hasListeners()).to.be.true;

    registry.dispose();
    registry.dispose();
    handle.dispose();
    expect(revoked.hasListeners()).to.be.false;
    expect(windowState.hasListeners()).to.be.false;
    expect(() => registry.watch(uri)).to.throw(
      'Cannot use DirectoryWatcherRegistry after it has been disposed',
    );
    revoked.fire(['server-a']);
    setFocused(false);
    setFocused(true);
    await clock.tickAsync(POLL_INTERVAL_MS * 2);
    sinon.assert.calledTwice(client.get);
    sinon.assert.notCalled(listener);
  });
});
