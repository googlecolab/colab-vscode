/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { assert, expect } from 'chai';
import sinon, { SinonFakeTimers, SinonStubbedInstance } from 'sinon';
import { Uri } from 'vscode';
import { AuthChangeEvent } from '../../auth/auth-provider';
import {
  AssignmentChangeEvent,
  AssignmentManager,
} from '../../jupyter/assignments';
import { ColabAssignedServer } from '../../jupyter/servers';
import { Deferred } from '../../test/helpers/async';
import { TestEventEmitter } from '../../test/helpers/events';
import { ExperimentFlag, Disk, GpuInfo, Memory } from '../api';
import { ColabClient } from '../client';
import { TEST_ONLY as FLAGS_TEST_ONLY } from '../experiment-state';
import { ResourceItem, ResourceType } from './resource-item';
import { ResourceTreeProvider } from './resource-tree';

const DEFAULT_SERVER = {
  label: 'Colab GPU A100',
  endpoint: 'm-s-foo',
  connectionInformation: {
    baseUrl: Uri.parse('https://example.com'),
    token: '123',
  },
} as ColabAssignedServer;

const DEFAULT_MEMORY: Memory = {
  totalBytes: 10 * 1024 * 1024 * 1024,
  freeBytes: 8 * 1024 * 1024 * 1024,
};

const DEFAULT_DISK: Disk = {
  filesystem: {
    label: 'kernel',
    totalBytes: 100 * 1024 * 1024 * 1024,
    usedBytes: 50 * 1024 * 1024 * 1024,
  },
};

const DEFAULT_GPU: GpuInfo = {
  name: 'NVIDIA A100',
  memoryTotalBytes: 20 * 1024 * 1024 * 1024,
  memoryUsedBytes: 10 * 1024 * 1024 * 1024,
};

const TEST_RESOURCE_POLL_INTERVAL_MS = 5000;

describe('ResourceTreeProvider', () => {
  let assignmentStub: SinonStubbedInstance<AssignmentManager>;
  let colabClientStub: SinonStubbedInstance<ColabClient>;
  let authChangeEmitter: TestEventEmitter<AuthChangeEvent>;
  let assignmentChangeEmitter: TestEventEmitter<AssignmentChangeEvent>;
  let getRootChildrenBlocker: sinon.SinonStub;
  let tree: TestResourceTreeProvider;

  enum AuthState {
    SIGNED_OUT,
    SIGNED_IN,
  }

  /**
   * Fires the auth change event emitter, simply toggling whether there's an
   * active session or not.
   *
   * @param s - The AuthState to toggle to.
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
    colabClientStub = sinon.createStubInstance(ColabClient);
    authChangeEmitter = new TestEventEmitter<AuthChangeEvent>();
    assignmentChangeEmitter = new TestEventEmitter<AssignmentChangeEvent>();
    getRootChildrenBlocker = sinon.stub();

    FLAGS_TEST_ONLY.setFlagForTest(
      ExperimentFlag.ResourcePollIntervalMs,
      TEST_RESOURCE_POLL_INTERVAL_MS,
    );
    tree = new TestResourceTreeProvider(
      assignmentStub,
      assignmentChangeEmitter.event,
      authChangeEmitter.event,
      colabClientStub,
    );
  });

  afterEach(() => {
    FLAGS_TEST_ONLY.resetFlagsForTest();
    tree.dispose();
    sinon.restore();
  });

  describe('lifecycle', () => {
    it('throws when calling refresh after disposed', () => {
      tree.dispose();

      expect(() => {
        tree.refresh();
      }).to.throw(/disposed/);
    });

    it('throws when calling getTreeItem after disposed', () => {
      tree.dispose();

      const item = ResourceItem.fromServer(DEFAULT_SERVER);
      expect(() => tree.getTreeItem(item)).to.throw(/disposed/);
    });

    it('throws when calling getChildren after disposed', async () => {
      tree.dispose();

      await expect(tree.getChildren(undefined)).to.be.rejectedWith(/disposed/);
    });
  });

  describe('getChildren', () => {
    describe('without servers', () => {
      beforeEach(() => {
        (assignmentStub.getServers as sinon.SinonStub).returns([]);
      });

      const tests = [
        { name: 'authorized', authState: AuthState.SIGNED_IN },
        { name: 'unauthorized', authState: AuthState.SIGNED_OUT },
      ];
      tests.forEach(({ name, authState }) => {
        it(`returns no items while ${name}`, async () => {
          toggleAuth(authState);

          await expect(tree.getChildren(undefined)).to.eventually.deep.equal(
            [],
          );
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
      });

      describe('while authorized', () => {
        beforeEach(() => {
          toggleAuth(AuthState.SIGNED_IN);
          colabClientStub.getResources.withArgs(DEFAULT_SERVER).resolves({
            memory: DEFAULT_MEMORY,
            disks: [DEFAULT_DISK],
            gpus: [DEFAULT_GPU],
          });
        });

        it('returns the server root', async () => {
          await expect(tree.getChildren(undefined)).to.eventually.deep.equal([
            ResourceItem.fromServer(DEFAULT_SERVER),
          ]);
        });

        it('returns child resources by server', async () => {
          const rootServerItems = await tree.getChildren(undefined);
          assert(rootServerItems.length === 1);
          const rootServerItem = rootServerItems[0];

          await expect(
            tree.getChildren(rootServerItem),
          ).to.eventually.deep.equal([
            ResourceItem.fromMemory(DEFAULT_SERVER.endpoint, DEFAULT_MEMORY),
            ResourceItem.fromGpus(DEFAULT_SERVER.endpoint, [DEFAULT_GPU]),
            ResourceItem.fromDisk(DEFAULT_SERVER.endpoint, DEFAULT_DISK),
          ]);
        });

        it('returns child resources by server with no GPU', async () => {
          colabClientStub.getResources.withArgs(DEFAULT_SERVER).resolves({
            memory: DEFAULT_MEMORY,
            disks: [DEFAULT_DISK],
            gpus: [],
          });
          const rootServerItems = await tree.getChildren(undefined);
          assert(rootServerItems.length === 1);
          const rootServerItem = rootServerItems[0];

          await expect(
            tree.getChildren(rootServerItem),
          ).to.eventually.deep.equal([
            ResourceItem.fromMemory(DEFAULT_SERVER.endpoint, DEFAULT_MEMORY),
            ResourceItem.fromDisk(DEFAULT_SERVER.endpoint, DEFAULT_DISK),
          ]);
        });
      });
    });

    describe('with multiple servers', () => {
      const secondServer: ColabAssignedServer = {
        ...DEFAULT_SERVER,
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
      });

      describe('while authorized', () => {
        beforeEach(() => {
          toggleAuth(AuthState.SIGNED_IN);
          colabClientStub.getResources.resolves({
            memory: DEFAULT_MEMORY,
            disks: [],
            gpus: [],
          });
        });

        it('returns multiple servers', async () => {
          await expect(tree.getChildren(undefined)).to.eventually.deep.equal([
            ResourceItem.fromServer(DEFAULT_SERVER),
            ResourceItem.fromServer(secondServer),
          ]);
        });

        it('returns an error item for server that fails resource fetch', async () => {
          colabClientStub.getResources.withArgs(DEFAULT_SERVER).rejects();
          const rootServerItems = await tree.getChildren(undefined);
          assert(rootServerItems.length === 2);

          const result1 = await tree.getChildren(rootServerItems[0]);
          const result2 = await tree.getChildren(rootServerItems[1]);

          // First server failed fetching resources
          expect(result1).to.deep.equal([
            new ResourceItem(
              DEFAULT_SERVER.endpoint,
              'Failed to fetch resources',
              ResourceType.ERROR,
            ),
          ]);
          // Second server succeeded fetching resources
          expect(result2).to.deep.equal([
            ResourceItem.fromMemory(secondServer.endpoint, DEFAULT_MEMORY),
          ]);
        });
      });
    });

    it('aborts previous in-flight getChildren call', async () => {
      (assignmentStub.getServers as sinon.SinonStub).callsFake(
        (_, signal?: AbortSignal) => {
          if (signal?.aborted) {
            throw signal.reason;
          }
          return [DEFAULT_SERVER];
        },
      );
      toggleAuth(AuthState.SIGNED_IN);
      const firstRunStarted = new Deferred<void>();
      const firstRunCompleter = new Deferred<void>();
      getRootChildrenBlocker.onFirstCall().callsFake(async () => {
        firstRunStarted.resolve();
        await firstRunCompleter.promise;
      });

      // Kick off first getChildren call and let it hang
      const firstGetChildrenPromise = tree.getChildren(undefined);
      await firstRunStarted.promise;
      // Complete a second getChildren call
      const secondGetChildrenResult = await tree.getChildren(undefined);
      expect(secondGetChildrenResult).to.deep.equal([
        ResourceItem.fromServer(DEFAULT_SERVER),
      ]);
      // Unblock the first getChildren call
      firstRunCompleter.resolve();

      // First getChildren call should return empty since it was aborted
      await expect(firstGetChildrenPromise).to.eventually.be.empty;
    });
  });

  describe('refresh', () => {
    it('fires an undefined change event', () => {
      const changeSpy = sinon.spy();
      tree.onDidChangeTreeData(changeSpy);

      tree.refresh();

      sinon.assert.calledOnceWithExactly(changeSpy, undefined);
    });
  });

  describe('refresh polling', () => {
    let clock: SinonFakeTimers;
    let refreshSpy: sinon.SinonSpy;

    beforeEach(() => {
      clock = sinon.useFakeTimers();
      refreshSpy = sinon.spy(tree, 'refresh');
    });

    afterEach(() => {
      clock.restore();
    });

    it('does not trigger refresh while unauthorized', () => {
      clock.tick(TEST_RESOURCE_POLL_INTERVAL_MS + 1);

      sinon.assert.notCalled(refreshSpy);
    });

    describe('while authorized', () => {
      beforeEach(() => {
        toggleAuth(AuthState.SIGNED_IN);
        refreshSpy.resetHistory();
      });

      it('triggers refresh at interval', () => {
        clock.tick(TEST_RESOURCE_POLL_INTERVAL_MS + 1);

        sinon.assert.calledOnce(refreshSpy);
      });

      it('does not trigger refresh after disposed', () => {
        tree.dispose();

        clock.tick(TEST_RESOURCE_POLL_INTERVAL_MS + 1);

        sinon.assert.notCalled(refreshSpy);
      });
    });
  });

  class TestResourceTreeProvider extends ResourceTreeProvider {
    protected override async getRootChildren(
      signal?: AbortSignal,
    ): Promise<ResourceItem[]> {
      await getRootChildrenBlocker();
      return super.getRootChildren(signal);
    }
  }
});
