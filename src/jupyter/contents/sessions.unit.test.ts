/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'crypto';
import { expect } from 'chai';
import sinon from 'sinon';
import {
  ConfigurationChangeEvent,
  ConfigurationScope,
  Disposable,
  WorkspaceConfiguration,
} from 'vscode';
import { AuthChangeEvent } from '../../auth/auth-provider';
import { Variant } from '../../colab/api';
import { COLAB_RUNTIME_PROXY_TOKEN_HEADER } from '../../colab/headers';
import { Deferred } from '../../test/helpers/async';
import { TestEventEmitter } from '../../test/helpers/events';
import {
  createJupyterClientStub,
  JupyterClientStub,
} from '../../test/helpers/jupyter';
import { TestUri } from '../../test/helpers/uri';
import { newVsCodeStub, VsCodeStub } from '../../test/helpers/vscode';
import { AssignmentChangeEvent, AssignmentManager } from '../assignments';
import { ProxiedJupyterClient } from '../client';
import { ColabAssignedServer } from '../servers';
import { JupyterConnectionManager, ServerNotFound } from './sessions';

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

describe('JupyterConnectionManager', () => {
  let vs: VsCodeStub;
  let configChangeEmitter: TestEventEmitter<ConfigurationChangeEvent>;
  let serverMountingEnabled = true;
  let authEmitter: TestEventEmitter<AuthChangeEvent>;
  let assignmentEmitter: TestEventEmitter<AssignmentChangeEvent>;
  let assignmentManager: sinon.SinonStubbedInstance<AssignmentManager>;
  let manager: JupyterConnectionManager;
  let jupyterClientStub: JupyterClientStub &
    sinon.SinonStubbedInstance<Disposable>;
  let withRefreshingConnectionStub: sinon.SinonStubbedMember<
    typeof ProxiedJupyterClient.withRefreshingConnection
  >;
  let fetchStub: sinon.SinonStubbedMember<typeof fetch>;

  beforeEach(() => {
    vs = newVsCodeStub();
    configChangeEmitter = new TestEventEmitter<ConfigurationChangeEvent>();
    vs.workspace.onDidChangeConfiguration.callsFake(configChangeEmitter.event);
    vs.workspace.getConfiguration.withArgs('colab').returns({
      get: sinon
        .stub<[string], boolean>()
        .withArgs('serverMounting')
        .callsFake(() => serverMountingEnabled),
    } as Pick<WorkspaceConfiguration, 'get'> as WorkspaceConfiguration);
    authEmitter = new TestEventEmitter<AuthChangeEvent>();
    assignmentEmitter = new TestEventEmitter<AssignmentChangeEvent>();
    assignmentManager = sinon.createStubInstance(AssignmentManager);
    // Needed to work around the property being readonly.
    Object.defineProperty(assignmentManager, 'onDidAssignmentsChange', {
      value: sinon.stub(),
    });
    assignmentManager.onDidAssignmentsChange.callsFake(assignmentEmitter.event);
    jupyterClientStub = {
      ...createJupyterClientStub(),
      dispose: sinon.stub(),
    };
    withRefreshingConnectionStub = sinon
      .stub(ProxiedJupyterClient, 'withRefreshingConnection')
      .returns(jupyterClientStub);
    fetchStub = sinon.stub(global, 'fetch');

    manager = new JupyterConnectionManager(
      vs.asVsCode(),
      authEmitter.event,
      assignmentManager,
    );
  });

  afterEach(() => {
    manager.dispose();
    sinon.restore();
  });

  enum AuthState {
    SIGNED_OUT,
    SIGNED_IN,
  }

  /**
   * Fires the auth change event emitter, simply toggling whether there's an
   * active session or not.
   */
  function toggleAuth(s: AuthState): void {
    authEmitter.fire({
      added: [],
      changed: [],
      removed: [],
      hasValidSession: s === AuthState.SIGNED_IN ? true : false,
    });
  }

  describe('dispose', () => {
    it('disposes the config changes listener', () => {
      expect(configChangeEmitter.hasListeners()).to.be.true;

      manager.dispose();

      expect(configChangeEmitter.hasListeners()).to.be.false;
    });

    it('disposes the auth changes listener', () => {
      expect(authEmitter.hasListeners()).to.be.true;

      manager.dispose();

      expect(authEmitter.hasListeners()).to.be.false;
    });

    it('disposes the assignment changes listener', () => {
      expect(assignmentEmitter.hasListeners()).to.be.true;

      manager.dispose();

      expect(assignmentEmitter.hasListeners()).to.be.false;
    });

    it('aborts client creation if disposed while in-flight', async () => {
      toggleAuth(AuthState.SIGNED_IN);
      const deferred = new Deferred<ColabAssignedServer[]>();
      // Cast needed due to overload.
      (assignmentManager.getServers as sinon.SinonStub)
        .withArgs('extension')
        .returns(deferred.promise);
      const create = manager.getOrCreate(DEFAULT_SERVER.endpoint);

      // Dispose manager before promise resolves
      manager.dispose();

      expect(create).to.not.be.fulfilled;
      deferred.resolve([DEFAULT_SERVER]);
      await expect(create).to.be.rejectedWith(/disposed/);
      sinon.assert.notCalled(withRefreshingConnectionStub);
    });
  });

  describe('onDidRevokeConnections', () => {
    let listener: sinon.SinonStub<[string[]]>;

    beforeEach(() => {
      toggleAuth(AuthState.SIGNED_IN);
      listener = sinon.stub();
      manager.onDidRevokeConnections(listener);
    });

    describe('auth changes', () => {
      it('fires event when user becomes unauthorized', async () => {
        // Cast needed due to overload.
        (assignmentManager.getServers as sinon.SinonStub).resolves([
          DEFAULT_SERVER,
        ]);
        await manager.getOrCreate(DEFAULT_SERVER.endpoint);

        toggleAuth(AuthState.SIGNED_OUT);

        sinon.assert.calledOnceWithExactly(listener, [DEFAULT_SERVER.endpoint]);
        await expect(manager.get('anything')).to.eventually.be.rejectedWith(
          /unauthorized/,
        );
      });

      it('fires single event with multiple servers when user becomes unauthorized', async () => {
        const server2 = { ...DEFAULT_SERVER, endpoint: 'm-s-bar' };
        // Cast needed due to overload.
        (assignmentManager.getServers as sinon.SinonStub).resolves([
          DEFAULT_SERVER,
          server2,
        ]);
        await manager.getOrCreate(DEFAULT_SERVER.endpoint);
        await manager.getOrCreate(server2.endpoint);

        toggleAuth(AuthState.SIGNED_OUT);

        sinon.assert.calledOnceWithExactly(listener, [
          DEFAULT_SERVER.endpoint,
          server2.endpoint,
        ]);
        await expect(manager.get('anything')).to.eventually.be.rejectedWith(
          /unauthorized/,
        );
      });
    });

    describe('config changes', () => {
      let affectsConfigStub: sinon.SinonStub<
        [string, ConfigurationScope],
        boolean
      >;

      beforeEach(() => {
        affectsConfigStub = sinon.stub();
        affectsConfigStub.withArgs('colab.serverMounting').returns(true);
      });

      it('fires event with single server when disabled', async () => {
        // Cast needed due to overload.
        (assignmentManager.getServers as sinon.SinonStub).resolves([
          DEFAULT_SERVER,
        ]);
        await manager.getOrCreate(DEFAULT_SERVER.endpoint);

        serverMountingEnabled = false;
        configChangeEmitter.fire({ affectsConfiguration: affectsConfigStub });

        sinon.assert.calledOnceWithExactly(listener, [DEFAULT_SERVER.endpoint]);
        await expect(manager.get(DEFAULT_SERVER.endpoint)).to.eventually.be
          .undefined;
      });

      it('fires event with multiple servers when disabled', async () => {
        const server2 = { ...DEFAULT_SERVER, endpoint: 'm-s-bar' };
        // Cast needed due to overload.
        (assignmentManager.getServers as sinon.SinonStub).resolves([
          DEFAULT_SERVER,
          server2,
        ]);
        await manager.getOrCreate(DEFAULT_SERVER.endpoint);
        await manager.getOrCreate(server2.endpoint);

        serverMountingEnabled = false;
        configChangeEmitter.fire({ affectsConfiguration: affectsConfigStub });

        sinon.assert.calledOnceWithExactly(listener, [
          DEFAULT_SERVER.endpoint,
          server2.endpoint,
        ]);
        await expect(manager.get(DEFAULT_SERVER.endpoint)).to.eventually.be
          .undefined;
        await expect(manager.get(server2.endpoint)).to.eventually.be.undefined;
      });

      it('ignores unrelated config changes', async () => {
        // Cast needed due to overload.
        (assignmentManager.getServers as sinon.SinonStub).resolves([
          DEFAULT_SERVER,
        ]);
        await manager.getOrCreate(DEFAULT_SERVER.endpoint);

        configChangeEmitter.fire({ affectsConfiguration: () => false });

        sinon.assert.notCalled(listener);
      });
    });

    it('does not fire again while the user is unauthorized', async () => {
      // Cast needed due to overload.
      (assignmentManager.getServers as sinon.SinonStub).resolves([
        DEFAULT_SERVER,
      ]);
      await manager.getOrCreate(DEFAULT_SERVER.endpoint);

      toggleAuth(AuthState.SIGNED_OUT);
      toggleAuth(AuthState.SIGNED_OUT);
      toggleAuth(AuthState.SIGNED_OUT);

      sinon.assert.calledOnceWithExactly(listener, [DEFAULT_SERVER.endpoint]);
    });

    it('fires event when managed server is removed', async () => {
      // Cast needed due to overload.
      (assignmentManager.getServers as sinon.SinonStub).resolves([
        DEFAULT_SERVER,
      ]);
      await manager.getOrCreate(DEFAULT_SERVER.endpoint);

      assignmentEmitter.fire({
        added: [],
        changed: [],
        removed: [{ server: DEFAULT_SERVER, userInitiated: true }],
      });

      sinon.assert.calledOnceWithExactly(listener, [DEFAULT_SERVER.endpoint]);
      await expect(manager.get(DEFAULT_SERVER.endpoint)).to.eventually.be
        .undefined;
    });

    it('does not fire for unrelated assignment changes', async () => {
      const otherServer = { ...DEFAULT_SERVER, endpoint: 'other' };
      // Cast needed due to overload.
      (assignmentManager.getServers as sinon.SinonStub).resolves([
        DEFAULT_SERVER,
      ]);
      await manager.getOrCreate(DEFAULT_SERVER.endpoint);

      assignmentEmitter.fire({
        added: [],
        changed: [],
        removed: [{ server: otherServer, userInitiated: true }],
      });

      sinon.assert.notCalled(listener);
      await expect(manager.get(DEFAULT_SERVER.endpoint)).to.eventually.not.be
        .undefined;
    });
  });

  describe('get', () => {
    it('throws if disposed', () => {
      manager.dispose();

      expect(manager.get('foo')).to.be.rejectedWith(/disposed/);
    });

    it('throws if unauthorized', () => {
      expect(manager.get('foo')).to.be.rejectedWith(/unauthorized/);
    });

    it('returns undefined when endpoint is not connected', async () => {
      toggleAuth(AuthState.SIGNED_IN);

      const result = await manager.get('foo');

      expect(result).to.be.undefined;
    });

    it('returns in-flight connection creations', async () => {
      toggleAuth(AuthState.SIGNED_IN);
      const deferred = new Deferred<ColabAssignedServer[]>();
      // Cast needed due to overload.
      (assignmentManager.getServers as sinon.SinonStub)
        .withArgs('extension')
        .returns(deferred.promise);

      const createPromise = manager.getOrCreate(DEFAULT_SERVER.endpoint);
      const getPromise = manager.get(DEFAULT_SERVER.endpoint);
      deferred.resolve([DEFAULT_SERVER]);

      const createRes = await createPromise;
      const getRes = await getPromise;
      expect(createRes).to.equal(getRes);
    });

    it('returns established connections', async () => {
      toggleAuth(AuthState.SIGNED_IN);
      // Cast needed due to overload.
      (assignmentManager.getServers as sinon.SinonStub).resolves([
        DEFAULT_SERVER,
      ]);
      const create = await manager.getOrCreate(DEFAULT_SERVER.endpoint);

      const get = await manager.get(DEFAULT_SERVER.endpoint);

      expect(create).to.equal(get);
    });
  });

  describe('getOrCreate', () => {
    it('throws if disposed', () => {
      manager.dispose();
      return expect(manager.getOrCreate('foo')).to.be.rejectedWith(/disposed/);
    });

    it('throws if unauthorized', () => {
      return expect(manager.getOrCreate('foo')).to.be.rejectedWith(
        /unauthorized/,
      );
    });

    it('throws if server is not found', async () => {
      toggleAuth(AuthState.SIGNED_IN);
      (assignmentManager.getServers as sinon.SinonStub).resolves([]);
      await expect(
        manager.getOrCreate(DEFAULT_SERVER.endpoint),
      ).to.be.rejectedWith(ServerNotFound);
    });

    it('establishes a new connection', async () => {
      toggleAuth(AuthState.SIGNED_IN);
      // Cast needed due to overload.
      (assignmentManager.getServers as sinon.SinonStub).resolves([
        DEFAULT_SERVER,
      ]);

      const contents = await manager.getOrCreate(DEFAULT_SERVER.endpoint);

      expect(contents).to.equal(jupyterClientStub.contents);
    });

    it('configures the established connection to use refreshed credentials as they change', async () => {
      withRefreshingConnectionStub.restore();
      toggleAuth(AuthState.SIGNED_IN);
      // Cast needed due to overload.
      (assignmentManager.getServers as sinon.SinonStub).resolves([
        DEFAULT_SERVER,
      ]);
      // Stub fetch to 501 (not implemented), since we are just inspecting the
      // invocations.
      fetchStub.callsFake(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: false }), {
            status: 501,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      );
      const lastToken = () => {
        const fetchArgs = fetchStub.lastCall.args;
        const req = fetchArgs[1];

        const headers = new Headers(req?.headers);
        return headers.get(COLAB_RUNTIME_PROXY_TOKEN_HEADER.key);
      };
      const contents = await manager.getOrCreate(DEFAULT_SERVER.endpoint);
      try {
        await contents.get({ path: 'foo123' });
      } catch {
        // Ignored.
      }
      expect(lastToken()).to.equal(DEFAULT_SERVER.connectionInformation.token);
      const newToken = 'new-token';

      assignmentEmitter.fire({
        added: [],
        changed: [
          {
            ...DEFAULT_SERVER,
            connectionInformation: {
              ...DEFAULT_SERVER.connectionInformation,
              token: newToken,
            },
          },
        ],
        removed: [],
      });
      try {
        await contents.get({ path: 'bar' });
      } catch {
        // Ignored.
      }

      expect(lastToken()).to.equal(newToken);
    });

    it('returns in-flight connection creations', async () => {
      toggleAuth(AuthState.SIGNED_IN);
      const deferred = new Deferred<ColabAssignedServer[]>();
      // Cast needed due to overload.
      (assignmentManager.getServers as sinon.SinonStub)
        .withArgs('extension')
        .returns(deferred.promise);

      const firstPromise = manager.getOrCreate(DEFAULT_SERVER.endpoint);
      const secondPromise = manager.getOrCreate(DEFAULT_SERVER.endpoint);
      deferred.resolve([DEFAULT_SERVER]);

      const firstRes = await firstPromise;
      const secondRes = await secondPromise;
      expect(firstRes).to.equal(secondRes);
    });

    it('returns established connections', async () => {
      toggleAuth(AuthState.SIGNED_IN);
      // Cast needed due to overload.
      (assignmentManager.getServers as sinon.SinonStub).resolves([
        DEFAULT_SERVER,
      ]);
      const first = await manager.getOrCreate(DEFAULT_SERVER.endpoint);

      const second = await manager.get(DEFAULT_SERVER.endpoint);

      expect(first).to.equal(second);
    });

    it('can establish a new connection if a previous attempt failed', async () => {
      toggleAuth(AuthState.SIGNED_IN);
      // Cast needed due to overload.
      (assignmentManager.getServers as sinon.SinonStub)
        .withArgs('extension')
        .onFirstCall()
        .rejects()
        .onSecondCall()
        .resolves([DEFAULT_SERVER]);

      await expect(manager.getOrCreate(DEFAULT_SERVER.endpoint)).to.eventually
        .be.rejected;
      await expect(manager.getOrCreate(DEFAULT_SERVER.endpoint)).to.eventually
        .be.fulfilled;
    });
  });

  describe('drop', () => {
    let listener: sinon.SinonStub<[string[]]>;

    function waitForClientDisposed() {
      return new Promise<void>((r) => {
        jupyterClientStub.dispose.callsFake(() => {
          r();
        });
      });
    }

    beforeEach(() => {
      toggleAuth(AuthState.SIGNED_IN);
      listener = sinon.stub();
      manager.onDidRevokeConnections(listener);
    });

    it('throws if disposed', () => {
      manager.dispose();

      expect(() => manager.drop('foo')).to.throw(/disposed/);
    });

    it("returns false and no-ops when there's no matching connection", () => {
      expect(manager.drop('foo')).to.be.false;
    });

    describe('with a managed connection', () => {
      beforeEach(async () => {
        // Cast needed due to overload.
        (assignmentManager.getServers as sinon.SinonStub).resolves([
          DEFAULT_SERVER,
        ]);
        await manager.getOrCreate(DEFAULT_SERVER.endpoint);
      });

      it('drops it and events the revocation', async () => {
        const clientDisposed = waitForClientDisposed();

        const dropped = manager.drop(DEFAULT_SERVER.endpoint);

        expect(dropped).to.be.true;
        await expect(clientDisposed).to.be.eventually.fulfilled;
        sinon.assert.calledOnceWithExactly(listener, [DEFAULT_SERVER.endpoint]);
      });

      it('drops it silently', async () => {
        const clientDisposed = waitForClientDisposed();

        const dropped = manager.drop(
          DEFAULT_SERVER.endpoint,
          /* silent= */ true,
        );

        expect(dropped).to.be.true;
        await expect(clientDisposed).to.be.eventually.fulfilled;
        sinon.assert.notCalled(listener);
      });
    });
  });
});
