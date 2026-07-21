/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'crypto';
import { assert, expect } from 'chai';
import fetch, { Headers, Request } from 'node-fetch';
import sinon, {
  SinonFakeTimers,
  SinonStubbedFunction,
  SinonStubbedInstance,
} from 'sinon';
import { MessageItem, Uri } from 'vscode';
import { ColabClient } from '../colab/client/v1';
import {
  Assignment,
  ExperimentFlag,
  RuntimeProxyToken,
  SubscriptionState,
  UserInfo,
} from '../colab/client/v1/api';
import { ColabApiClient } from '../colab/client/v2';
import {
  ColaboratoryApi,
  CreateRuntimeRequest,
  Runtime,
} from '../colab/client/v2/generated/colab';
import {
  ColaboratoryApi as OperationsApi,
  WaitOperationRequest,
} from '../colab/client/v2/generated/operations';
import { REMOVE_SERVER } from '../colab/commands/constants';
import {
  AcceleratorUnavailableError,
  DenylistedError,
  InsufficientQuotaError,
  NotFoundError,
  TooManyAssignmentsError,
} from '../colab/errors';
import { TEST_ONLY as EXPERIMENT_TEST } from '../colab/experiment-state';
import {
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
} from '../colab/headers';
import { Shape, SubscriptionTier, Variant } from '../colab/types';
import {
  FetchError as JupyterFetchError,
  ResponseError as JupyterResponseError,
} from '../jupyter/client/generated';
import { telemetry } from '../telemetry';
import { AssignmentOutcome, CommandSource } from '../telemetry/api';
import { TestEventEmitter } from '../test/helpers/events';
import {
  createJupyterClientStub,
  JupyterClientStub,
} from '../test/helpers/jupyter';
import { ServerStorageFake } from '../test/helpers/server-storage';
import { TestUri } from '../test/helpers/uri';
import { newVsCodeStub, VsCodeStub } from '../test/helpers/vscode';
import { isUUID } from '../utils/uuid';
import { AssignmentChangeEvent, AssignmentManager } from './assignments';
import { ProxiedJupyterClient } from './client';
import {
  ColabAssignedServer,
  ColabServerDescriptor,
  DEFAULT_CPU_SERVER,
} from './servers';
import { ServerStorage } from './storage';

const NOW = new Date();
const TOKEN_EXPIRY_MS = 1000 * 60 * 60;
const LIST_UNOWNED_SESSIONS_TIMEOUT_MS = 3000;

const defaultAssignmentDescriptor: ColabServerDescriptor = {
  label: 'Colab GPU A100',
  variant: Variant.GPU,
  accelerator: 'A100',
};

const defaultAssignment: Assignment & { runtimeProxyInfo: RuntimeProxyToken } =
  {
    accelerator: 'A100',
    endpoint: 'm-s-foo',
    idleTimeoutSec: 30,
    subscriptionState: SubscriptionState.UNSUBSCRIBED,
    subscriptionTier: SubscriptionTier.NONE,
    variant: Variant.GPU,
    machineShape: Shape.STANDARD,
    runtimeProxyInfo: {
      token: 'mock-token',
      tokenExpiresInSeconds: TOKEN_EXPIRY_MS / 1000,
      url: 'https://example.com',
    },
  };

const defaultServer: ColabAssignedServer = {
  ...defaultAssignmentDescriptor,
  id: randomUUID(),
  endpoint: defaultAssignment.endpoint,
  connectionInformation: {
    baseUrl: TestUri.parse(defaultAssignment.runtimeProxyInfo.url),
    token: defaultAssignment.runtimeProxyInfo.token,
    tokenExpiry: new Date(NOW.getTime() + TOKEN_EXPIRY_MS),
    headers: {
      [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]:
        defaultAssignment.runtimeProxyInfo.token,
      [COLAB_CLIENT_AGENT_HEADER.key]: COLAB_CLIENT_AGENT_HEADER.value,
    },
  },
  dateAssigned: NOW,
};

const defaultServerDescriptor: ColabServerDescriptor = {
  ...defaultAssignmentDescriptor,
  shape: Shape.STANDARD,
  version: '2026.04',
};

const defaultRuntimeId = `r-${randomUUID()}`;
const defaultRuntime: Runtime = {
  name: `runtimes/${defaultRuntimeId}`,
  runtimeSpec: {
    variant: 'VARIANT_GPU',
    shape: 'SHAPE_STANDARD',
    accelerator: 'A100',
  },
  connectionInfo: {
    token: 'mock-token',
    url: 'https://example.com',
    expireTime: new Date(NOW.getTime() + TOKEN_EXPIRY_MS),
    endpoint: 'm-s-foo',
  },
  version: defaultServerDescriptor.version,
};

const defaultServerV2: ColabAssignedServer = {
  ...defaultServer,
  ...defaultServerDescriptor,
  id: defaultRuntimeId,
};

describe('AssignmentManager', () => {
  let fakeClock: SinonFakeTimers;
  let vsCodeStub: VsCodeStub;
  let colabClientStub: SinonStubbedInstance<ColabClient>;
  let colabApiClientStub: SinonStubbedInstance<ColabApiClient>;
  let serverStorage: ServerStorage;
  let assignmentChangeListener: sinon.SinonStub<[AssignmentChangeEvent], void>;
  let assignmentManager: AssignmentManager;
  let jupyterStaticConnectionStub: sinon.SinonStubbedFunction<
    typeof ProxiedJupyterClient.withStaticConnection
  >;

  /**
   * Set up the stubs to return the given assignments from both the Colab client
   * and the server storage.
   *
   * The stored server and mocked assignment use {@link defaultServer} and
   * {@link defaultAssignment} as templates, with fields overridden from the
   * given assignments.
   *
   * @param assignments - The assignments to set up as both stored and returned
   * by the Colab client.
   */
  async function setupAssignments(assignments: ColabServerDescriptor[]) {
    colabClientStub.listAssignments.resolves(
      assignments.map(
        (a): Assignment => ({
          ...defaultAssignment,
          variant: a.variant,
          accelerator: a.accelerator ?? 'NONE',
        }),
      ),
    );
    await serverStorage.store(
      assignments.map(
        (a): ColabAssignedServer => ({
          ...defaultServer,
          variant: a.variant,
          accelerator: a.accelerator ?? 'NONE',
          label: a.label,
        }),
      ),
    );
  }

  beforeEach(() => {
    fakeClock = sinon.useFakeTimers({ now: NOW, toFake: [] });
    vsCodeStub = newVsCodeStub();
    colabClientStub = sinon.createStubInstance(ColabClient);
    colabApiClientStub = {
      colab: sinon.createStubInstance(ColaboratoryApi),
      operations: sinon.createStubInstance(OperationsApi),
    };
    serverStorage = new ServerStorageFake() as ServerStorage;
    assignmentManager = new AssignmentManager(
      vsCodeStub.asVsCode(),
      colabClientStub,
      colabApiClientStub,
      serverStorage,
    );
    assignmentChangeListener = sinon.stub();
    assignmentManager.onDidAssignmentsChange(assignmentChangeListener);
    jupyterStaticConnectionStub = sinon.stub(
      ProxiedJupyterClient,
      'withStaticConnection',
    );
  });

  afterEach(() => {
    EXPERIMENT_TEST.resetFlagsForTest();
    fakeClock.restore();
    sinon.restore();
  });

  describe('getAvailableServerDescriptors', () => {
    it('throws after being disposed', async () => {
      assignmentManager.dispose();

      await expect(
        assignmentManager.getAvailableServerDescriptors(),
      ).to.be.rejectedWith(/disposed/);
    });

    const defaultGpuT4Descriptor = {
      label: 'Colab GPU T4',
      variant: Variant.GPU,
      accelerator: 'T4',
    };

    const defaultGpuA100Descriptor = {
      label: 'Colab GPU A100',
      variant: Variant.GPU,
      accelerator: 'A100',
    };

    const defaultTpuV5E1Descriptor = {
      label: 'Colab TPU V5E1',
      variant: Variant.TPU,
      accelerator: 'V5E1',
    };

    const defaultTpuV6E1Descriptor = {
      label: 'Colab TPU V6E1',
      variant: Variant.TPU,
      accelerator: 'V6E1',
    };

    describe('with Public API disabled', () => {
      const mockUserInfo: UserInfo = {
        subscriptionTier: SubscriptionTier.NONE,
        paidComputeUnitsBalance: 1,
        eligibleAccelerators: [
          {
            variant: Variant.GPU,
            models: ['T4', 'A100'],
          },
          {
            variant: Variant.TPU,
            models: ['V5E1', 'V6E1'],
          },
        ],
        ineligibleAccelerators: [],
      };

      beforeEach(() => {
        EXPERIMENT_TEST.setFlagForTest(ExperimentFlag.EnablePublicApi, false);
      });

      it('returns the default CPU and the eligible servers', async () => {
        colabClientStub.getUserInfo.resolves(mockUserInfo);

        const servers = await assignmentManager.getAvailableServerDescriptors();

        expect(servers).to.deep.equal([
          DEFAULT_CPU_SERVER,
          defaultGpuT4Descriptor,
          defaultGpuA100Descriptor,
          defaultTpuV5E1Descriptor,
          defaultTpuV6E1Descriptor,
        ]);
      });

      it('returns the default CPU and the eligible servers for pro users', async () => {
        colabClientStub.getUserInfo.resolves({
          ...mockUserInfo,
          subscriptionTier: SubscriptionTier.PRO,
        });

        const servers = await assignmentManager.getAvailableServerDescriptors();

        expect(servers).to.deep.equal([
          { ...DEFAULT_CPU_SERVER, shape: Shape.STANDARD },
          { ...DEFAULT_CPU_SERVER, shape: Shape.HIGHMEM },
          { ...defaultGpuT4Descriptor, shape: Shape.STANDARD },
          { ...defaultGpuT4Descriptor, shape: Shape.HIGHMEM },
          { ...defaultGpuA100Descriptor, shape: Shape.STANDARD },
          { ...defaultGpuA100Descriptor, shape: Shape.HIGHMEM },
          { ...defaultTpuV5E1Descriptor, shape: Shape.HIGHMEM },
          { ...defaultTpuV6E1Descriptor, shape: Shape.HIGHMEM },
        ]);
      });
    });

    describe('with Public API enabled', () => {
      const defaultCpuSpec = {
        variant: 'VARIANT_CPU',
        shape: 'SHAPE_STANDARD',
        accelerator: 'NONE',
      };
      const defaultGpuSpec = {
        variant: 'VARIANT_GPU',
        shape: 'SHAPE_STANDARD',
        accelerator: 'T4',
      };
      const defaultTpuSpec = {
        variant: 'VARIANT_TPU',
        shape: 'SHAPE_STANDARD',
        accelerator: 'V5E1',
      };

      beforeEach(() => {
        EXPERIMENT_TEST.setFlagForTest(ExperimentFlag.EnablePublicApi, true);
        (colabApiClientStub.colab.listRuntimeSpecs as sinon.SinonStub).resolves(
          {
            runtimeSpecs: [
              {
                key: defaultCpuSpec,
                eligible: true,
              },
              {
                key: defaultGpuSpec,
                eligible: true,
              },
              {
                key: defaultTpuSpec,
                eligible: true,
              },
              {
                key: {
                  variant: 'VARIANT_GPU',
                  shape: 'SHAPE_HIGHMEM',
                  accelerator: 'DOES_NOT_MATTER',
                },
                eligible: false,
              },
            ],
          },
        );
      });

      it('returns the eligible server specs', async () => {
        await expect(
          assignmentManager.getAvailableServerDescriptors(),
        ).to.eventually.deep.equal([
          { ...DEFAULT_CPU_SERVER, shape: Shape.STANDARD, accelerator: 'NONE' },
          { ...defaultGpuT4Descriptor, shape: Shape.STANDARD },
          { ...defaultTpuV5E1Descriptor, shape: Shape.STANDARD },
        ]);
      });
    });
  });

  describe('reconcileAssignedServers', () => {
    it('throws after being disposed', async () => {
      assignmentManager.dispose();

      await expect(
        assignmentManager.reconcileAssignedServers(),
      ).to.be.rejectedWith(/disposed/);
    });

    it('does nothing when there are no stored servers', async () => {
      await assignmentManager.reconcileAssignedServers();

      sinon.assert.notCalled(vsCodeStub.commands.executeCommand);
      sinon.assert.notCalled(assignmentChangeListener);
      sinon.assert.notCalled(vsCodeStub.window.showInformationMessage);
    });

    it('does nothing when no servers need reconciling', async () => {
      await serverStorage.store([defaultServer]);
      colabClientStub.listAssignments.resolves([defaultAssignment]);

      await assignmentManager.reconcileAssignedServers();

      sinon.assert.notCalled(vsCodeStub.commands.executeCommand);
      sinon.assert.notCalled(assignmentChangeListener);
      sinon.assert.notCalled(vsCodeStub.window.showInformationMessage);
    });

    it('reconciles a single assigned server when it is the only one', async () => {
      await serverStorage.store([defaultServer]);
      colabClientStub.listAssignments.resolves([]);

      await assignmentManager.reconcileAssignedServers();

      await expect(assignmentManager.getServers('extension')).to.eventually.be
        .empty;
      sinon.assert.calledOnceWithExactly(assignmentChangeListener, {
        added: [],
        removed: [{ server: defaultServer, userInitiated: false }],
        changed: [],
      });
      sinon.assert.calledOnceWithMatch(
        vsCodeStub.window.showInformationMessage,
        sinon.match(/notebooks Colab GPU A100 was/),
      );
    });

    describe('with multiple servers', () => {
      let servers: [ColabAssignedServer, ColabAssignedServer];
      let assignments: [Assignment, Assignment];

      beforeEach(() => {
        servers = [
          defaultServer,
          {
            ...defaultServer,
            label: 'Second Server',
            id: randomUUID(),
            endpoint: 'm-s-bar',
            connectionInformation: {
              ...defaultServer.connectionInformation,
              baseUrl: vsCodeStub.Uri.parse('https://example2.com'),
            },
          },
        ];
        assignments = [
          defaultAssignment,
          {
            ...defaultAssignment,
            endpoint: 'm-s-bar',
            runtimeProxyInfo: {
              ...defaultAssignment.runtimeProxyInfo,
              url: servers[1].connectionInformation.baseUrl.toString(),
            },
          },
        ];
      });

      it('reconciles a single assigned server when there are others', async () => {
        await serverStorage.store(servers);
        colabClientStub.listAssignments.resolves([assignments[0]]);

        await assignmentManager.reconcileAssignedServers();

        const serversAfter = await assignmentManager.getServers('extension');
        expect(stripNetworkOverrides(serversAfter)).to.deep.equal([servers[0]]);
        sinon.assert.calledOnceWithExactly(assignmentChangeListener, {
          added: [],
          removed: [{ server: servers[1], userInitiated: false }],
          changed: [],
        });
        sinon.assert.calledOnceWithMatch(
          vsCodeStub.window.showInformationMessage,
          sinon.match(/notebooks Second Server was/),
        );
      });

      it('reconciles multiple assigned servers when all need reconciling', async () => {
        const threeServers = [
          ...servers,
          { ...defaultServer, label: 'Third Server' },
        ];
        await serverStorage.store(threeServers);
        colabClientStub.listAssignments.resolves([]);

        await assignmentManager.reconcileAssignedServers();

        await expect(assignmentManager.getServers('extension')).to.eventually.be
          .empty;
        sinon.assert.calledOnceWithExactly(assignmentChangeListener, {
          added: [],
          removed: threeServers.map((s) => ({
            server: s,
            userInitiated: false,
          })),
          changed: [],
        });
        sinon.assert.calledOnceWithMatch(
          vsCodeStub.window.showInformationMessage,
          sinon.match(
            /notebooks Colab GPU A100, Second Server and Third Server were/,
          ),
        );
      });

      it('reconciles multiple assigned servers when some need reconciling', async () => {
        const thirdServer: ColabAssignedServer = {
          ...defaultServer,
          label: 'Third Server',
          id: randomUUID(),
          endpoint: 'm-s-baz',
          connectionInformation: {
            ...defaultServer.connectionInformation,
            baseUrl: vsCodeStub.Uri.parse('https://example3.com'),
          },
        };
        const twoServers = servers;
        const threeServers = [...twoServers, thirdServer];
        await serverStorage.store(threeServers);
        colabClientStub.listAssignments.resolves(assignments);

        await assignmentManager.reconcileAssignedServers();

        const serversAfter = await assignmentManager.getServers('extension');
        expect(stripNetworkOverrides(serversAfter)).to.deep.equal([
          servers[0],
          servers[1],
        ]);
        sinon.assert.calledOnceWithExactly(assignmentChangeListener, {
          added: [],
          removed: [{ server: thirdServer, userInitiated: false }],
          changed: [],
        });
        sinon.assert.calledOnceWithMatch(
          vsCodeStub.window.showInformationMessage,
          sinon.match(/notebooks Third Server was/),
        );
      });

      it('reconciles ignoring assignments originating out of VS Code', async () => {
        await serverStorage.store(servers);
        const colabAssignment: Assignment = {
          ...defaultAssignment,
          endpoint: 'm-s-baz',
          runtimeProxyInfo: {
            ...defaultAssignment.runtimeProxyInfo,
            url: 'https://not-from-vs-code.com',
          },
        };
        colabClientStub.listAssignments.resolves([colabAssignment]);

        await assignmentManager.reconcileAssignedServers();

        await expect(assignmentManager.getServers('extension')).to.eventually.be
          .empty;
        sinon.assert.calledOnceWithExactly(assignmentChangeListener, {
          added: [],
          removed: servers.map((s) => ({ server: s, userInitiated: false })),
          changed: [],
        });
        sinon.assert.calledOnceWithMatch(
          vsCodeStub.window.showInformationMessage,
          sinon.match(/notebooks Colab GPU A100 and Second Server were/),
        );
      });
    });
  });

  describe('hasAssignedServers', () => {
    it('throws after being disposed', async () => {
      assignmentManager.dispose();

      await expect(assignmentManager.hasAssignedServer()).to.be.rejectedWith(
        /disposed/,
      );
    });

    it('returns false when no servers are assigned', async () => {
      colabClientStub.listAssignments.resolves([]);

      await expect(assignmentManager.hasAssignedServer()).to.eventually.be
        .false;
    });

    it('returns true when at least one server is assigned', async () => {
      colabClientStub.listAssignments.resolves([defaultAssignment]);
      await serverStorage.store([defaultServer]);
      await setupAssignments([defaultAssignmentDescriptor]);

      await expect(assignmentManager.hasAssignedServer()).to.eventually.be.true;
    });

    it('returns true when multiple servers are assigned', async () => {
      const secondEndpoint = 'm-s-foo';
      colabClientStub.listAssignments.resolves([
        defaultAssignment,
        { ...defaultAssignment, endpoint: secondEndpoint },
      ]);
      await serverStorage.store([
        { ...defaultServer, id: randomUUID() },
        { ...defaultServer, id: randomUUID(), endpoint: secondEndpoint },
      ]);

      await expect(assignmentManager.hasAssignedServer()).to.eventually.be.true;
    });
  });

  describe('getServers', () => {
    const TEST_SESSION_NAME = 'test-session-name';
    const UNKNOWN_REMOTE_SERVER_NAME = 'Untitled';

    const assignmentWithName = {
      ...defaultAssignment,
      endpoint: 'test-endpoint-with-name',
      runtimeProxyInfo: {
        ...defaultAssignment.runtimeProxyInfo,
        url: 'https://test.url.with.session.name',
      },
    };
    const assignmentWithoutName = {
      ...defaultAssignment,
      endpoint: 'test-endpoint-without-name',
      runtimeProxyInfo: {
        ...defaultAssignment.runtimeProxyInfo,
        url: 'https://test.url.without.session.name',
      },
    };
    const assignmentWithoutSession = {
      ...defaultAssignment,
      endpoint: 'test-endpoint-without-session',
      runtimeProxyInfo: {
        ...defaultAssignment.runtimeProxyInfo,
        url: 'https://test.url.without.session',
      },
    };
    const defaultSession = {
      id: '',
      path: '',
      type: '',
      kernel: {
        lastActivity: '',
        executionState: '',
        id: '',
        name: '',
        connections: 1,
      },
    };

    let jupyterStubWithSessionName: JupyterClientStub;
    let jupyterStubWithoutSessionName: JupyterClientStub;
    let jupyterStubWithoutSession: JupyterClientStub;

    beforeEach(() => {
      jupyterStubWithSessionName = createJupyterClientStub();
      jupyterStaticConnectionStub
        .withArgs(
          assignmentWithName.runtimeProxyInfo.url,
          assignmentWithName.runtimeProxyInfo.token,
        )
        .returns(jupyterStubWithSessionName);
      jupyterStubWithSessionName.sessions.list.resolves([
        {
          ...defaultSession,
          name: TEST_SESSION_NAME,
        },
      ]);

      jupyterStubWithoutSessionName = createJupyterClientStub();
      jupyterStaticConnectionStub
        .withArgs(
          assignmentWithoutName.runtimeProxyInfo.url,
          assignmentWithoutName.runtimeProxyInfo.token,
        )
        .returns(jupyterStubWithoutSessionName);
      jupyterStubWithoutSessionName.sessions.list.resolves([
        {
          ...defaultSession,
          name: UNKNOWN_REMOTE_SERVER_NAME,
        },
      ]);

      jupyterStubWithoutSession = createJupyterClientStub();
      jupyterStaticConnectionStub
        .withArgs(
          assignmentWithoutSession.runtimeProxyInfo.url,
          assignmentWithoutSession.runtimeProxyInfo.token,
        )
        .returns(jupyterStubWithoutSession);
      jupyterStubWithoutSession.sessions.list.resolves([]);
    });

    it('throws after being disposed', async () => {
      assignmentManager.dispose();

      await expect(assignmentManager.getServers('all')).to.be.rejectedWith(
        /disposed/,
      );
    });

    describe('from extension', () => {
      it('returns an empty list when no servers are assigned', async () => {
        const servers = await assignmentManager.getServers('extension');

        expect(servers).to.deep.equal([]);
      });

      describe('when a server is assigned', () => {
        beforeEach(async () => {
          colabClientStub.listAssignments.resolves([defaultAssignment]);
          await serverStorage.store([defaultServer]);
        });

        it('returns the assigned server when there is one', async () => {
          const servers = await assignmentManager.getServers('extension');

          expect(stripNetworkOverrides(servers)).to.deep.equal([defaultServer]);
        });

        it('returns multiple assigned servers when there are some', async () => {
          const storedServers = [
            { ...defaultServer, id: randomUUID() },
            { ...defaultServer, id: randomUUID() },
          ];
          await serverStorage.store(storedServers);

          const servers = await assignmentManager.getServers('extension');

          expect(stripNetworkOverrides(servers)).to.deep.equal(storedServers);
        });

        it('reconciles assigned servers before returning', async () => {
          colabClientStub.listAssignments.resolves([defaultAssignment]);
          const noLongerAssignedServer = {
            ...defaultServer,
            endpoint: 'no-longer-assigned',
          };
          await serverStorage.store([defaultServer, noLongerAssignedServer]);

          const results = await assignmentManager.getServers('extension');

          expect(stripNetworkOverrides(results)).to.deep.equal([defaultServer]);
        });

        it('includes a fetch implementation that attaches Colab connection info', async () => {
          const servers = await assignmentManager.getServers('extension');
          assert.lengthOf(servers, 1);
          const server = servers[0];
          assert.isDefined(server.connectionInformation.fetch);
          const fetchStub = sinon.stub(fetch, 'default');

          await server.connectionInformation.fetch('https://example.com');

          sinon.assert.calledOnceWithMatch(fetchStub, 'https://example.com', {
            headers: new Headers({
              [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]:
                server.connectionInformation.token,
              [COLAB_CLIENT_AGENT_HEADER.key]: COLAB_CLIENT_AGENT_HEADER.value,
            }),
          });
        });

        it('preserves request headers when wrapping a Request object', async () => {
          const servers = await assignmentManager.getServers('extension');
          assert.lengthOf(servers, 1);
          const server = servers[0];
          assert.isDefined(server.connectionInformation.fetch);
          const fetchStub = sinon.stub(fetch, 'default');
          const request = new Request('https://example.com', {
            headers: {
              Accept: 'application/json',
              'X-Test': 'existing-value',
            },
          });

          await server.connectionInformation.fetch(request);

          sinon.assert.calledOnceWithMatch(
            fetchStub,
            sinon.match.instanceOf(Request),
            {
              headers: new Headers({
                Accept: 'application/json',
                'X-Test': 'existing-value',
                [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]:
                  server.connectionInformation.token,
                [COLAB_CLIENT_AGENT_HEADER.key]:
                  COLAB_CLIENT_AGENT_HEADER.value,
              }),
            },
          );
        });

        it('allows init headers to override request headers', async () => {
          const servers = await assignmentManager.getServers('extension');
          assert.lengthOf(servers, 1);
          const server = servers[0];
          assert.isDefined(server.connectionInformation.fetch);
          const fetchStub = sinon.stub(fetch, 'default');
          const request = new Request('https://example.com', {
            headers: {
              Accept: 'text/plain',
              'X-Test': 'request-value',
            },
          });

          await server.connectionInformation.fetch(request, {
            headers: {
              Accept: 'application/json',
              'X-Test': 'init-value',
            },
          });

          sinon.assert.calledOnceWithMatch(
            fetchStub,
            sinon.match.instanceOf(Request),
            {
              headers: new Headers({
                Accept: 'application/json',
                'X-Test': 'init-value',
                [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]:
                  server.connectionInformation.token,
                [COLAB_CLIENT_AGENT_HEADER.key]:
                  COLAB_CLIENT_AGENT_HEADER.value,
              }),
            },
          );
        });

        it('overrides caller-supplied Colab proxy headers', async () => {
          const servers = await assignmentManager.getServers('extension');
          assert.lengthOf(servers, 1);
          const server = servers[0];
          assert.isDefined(server.connectionInformation.fetch);
          const fetchStub = sinon.stub(fetch, 'default');
          const request = new Request('https://example.com', {
            headers: {
              [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]: 'spoofed-request-token',
              [COLAB_CLIENT_AGENT_HEADER.key]: 'spoofed-request-agent',
            },
          });

          await server.connectionInformation.fetch(request, {
            headers: {
              [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]: 'spoofed-init-token',
              [COLAB_CLIENT_AGENT_HEADER.key]: 'spoofed-init-agent',
            },
          });

          sinon.assert.calledOnceWithMatch(
            fetchStub,
            sinon.match.instanceOf(Request),
            {
              headers: new Headers({
                [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]:
                  server.connectionInformation.token,
                [COLAB_CLIENT_AGENT_HEADER.key]:
                  COLAB_CLIENT_AGENT_HEADER.value,
              }),
            },
          );
        });

        it('includes a custom WebSocket implementation', async () => {
          const servers = await assignmentManager.getServers('extension');
          assert.lengthOf(servers, 1);
          const server = servers[0];
          assert.isDefined(server.connectionInformation.WebSocket);
        });
      });
    });

    describe('from external', () => {
      it('returns unowned servers', async () => {
        // Given 3 total assignments
        colabClientStub.listAssignments.resolves([
          assignmentWithName,
          assignmentWithoutName,
          assignmentWithoutSession,
        ]);
        // One of the assignments was assigned within VS Code extension
        const assignedServer = {
          ...defaultServer,
          endpoint: assignmentWithoutName.endpoint,
        };
        await serverStorage.store([assignedServer]);

        // When we get servers from external
        const results = await assignmentManager.getServers('external');

        // Then only 2 unowned external servers are returned
        expect(results).to.deep.equal([
          {
            label: TEST_SESSION_NAME,
            endpoint: assignmentWithName.endpoint,
            variant: assignmentWithName.variant,
            accelerator: assignmentWithName.accelerator,
          },
          {
            label: UNKNOWN_REMOTE_SERVER_NAME,
            endpoint: assignmentWithoutSession.endpoint,
            variant: assignmentWithoutSession.variant,
            accelerator: assignmentWithoutSession.accelerator,
          },
        ]);
      });

      it('drops orphan unowned servers whose Jupyter client throws a FetchError', async () => {
        // Simulates a race where the orphan assignment is deleted (e.g. via
        // Colab web or another VS Code instance sharing the account) between
        // listing assignments and listing its sessions.
        colabClientStub.listAssignments.resolves([
          assignmentWithName,
          assignmentWithoutSession,
        ]);
        jupyterStubWithoutSession.sessions.list.rejects(
          new JupyterFetchError(new Error('network error')),
        );

        const results = await assignmentManager.getServers('external');

        expect(results).to.deep.equal([
          {
            label: TEST_SESSION_NAME,
            endpoint: assignmentWithName.endpoint,
            variant: assignmentWithName.variant,
            accelerator: assignmentWithName.accelerator,
          },
        ]);
      });

      it('falls back to placeholder label when sessions.list throws a non-FetchError', async () => {
        colabClientStub.listAssignments.resolves([
          assignmentWithName,
          assignmentWithoutSession,
        ]);
        jupyterStubWithoutSession.sessions.list.rejects(
          new JupyterResponseError(new Response(undefined, { status: 500 })),
        );

        const results = await assignmentManager.getServers('external');

        expect(results).to.deep.equal([
          {
            label: TEST_SESSION_NAME,
            endpoint: assignmentWithName.endpoint,
            variant: assignmentWithName.variant,
            accelerator: assignmentWithName.accelerator,
          },
          {
            label: UNKNOWN_REMOTE_SERVER_NAME,
            endpoint: assignmentWithoutSession.endpoint,
            variant: assignmentWithoutSession.variant,
            accelerator: assignmentWithoutSession.accelerator,
          },
        ]);
      });
    });

    it('falls back to placeholder label when sessions.list times out', async () => {
      colabClientStub.listAssignments.resolves([assignmentWithName]);
      jupyterStubWithSessionName.sessions.list.callsFake(async () => {
        // Block listSessions to trigger the timeout.
        await new Promise((resolve) =>
          setTimeout(resolve, LIST_UNOWNED_SESSIONS_TIMEOUT_MS + 100),
        );
        return [
          {
            ...defaultSession,
            name: 'test-session-name-that-does-not-matter',
          },
        ];
      });

      const resultsPromise = assignmentManager.getServers('external');
      await fakeClock.tickAsync(LIST_UNOWNED_SESSIONS_TIMEOUT_MS);

      await expect(resultsPromise).to.eventually.deep.equal([
        {
          label: UNKNOWN_REMOTE_SERVER_NAME,
          endpoint: assignmentWithName.endpoint,
          variant: assignmentWithName.variant,
          accelerator: assignmentWithName.accelerator,
        },
      ]);
    });

    describe('from all', () => {
      it('returns both assigned and unowned servers', async () => {
        // Given 3 total assignments
        colabClientStub.listAssignments.resolves([
          assignmentWithName,
          assignmentWithoutName,
          assignmentWithoutSession,
        ]);
        // One of the assignments was assigned within VS Code extension
        const assignedServer = {
          ...defaultServer,
          endpoint: assignmentWithoutName.endpoint,
        };
        await serverStorage.store([assignedServer]);

        // When we get servers from all
        const results = await assignmentManager.getServers('all');

        // Then 1 assigned server and 2 unowned servers are returned
        expect(stripNetworkOverrides([...results.assigned])).to.deep.equal([
          assignedServer,
        ]);
        expect(results.unowned).to.deep.equal([
          {
            label: TEST_SESSION_NAME,
            endpoint: assignmentWithName.endpoint,
            variant: assignmentWithName.variant,
            accelerator: assignmentWithName.accelerator,
          },
          {
            label: UNKNOWN_REMOTE_SERVER_NAME,
            endpoint: assignmentWithoutSession.endpoint,
            variant: assignmentWithoutSession.variant,
            accelerator: assignmentWithoutSession.accelerator,
          },
        ]);
      });

      it('returns only unowned servers when no server is assigned in VS Code', async () => {
        colabClientStub.listAssignments.resolves([
          assignmentWithName,
          assignmentWithoutName,
          assignmentWithoutSession,
        ]);
        await serverStorage.store([]);

        const results = await assignmentManager.getServers('all');

        expect(results).to.deep.equal({
          assigned: [],
          unowned: [
            {
              label: TEST_SESSION_NAME,
              endpoint: assignmentWithName.endpoint,
              variant: assignmentWithName.variant,
              accelerator: assignmentWithName.accelerator,
            },
            {
              label: UNKNOWN_REMOTE_SERVER_NAME,
              endpoint: assignmentWithoutName.endpoint,
              variant: assignmentWithoutName.variant,
              accelerator: assignmentWithoutName.accelerator,
            },
            {
              label: UNKNOWN_REMOTE_SERVER_NAME,
              endpoint: assignmentWithoutSession.endpoint,
              variant: assignmentWithoutSession.variant,
              accelerator: assignmentWithoutSession.accelerator,
            },
          ],
        });
      });

      it('returns only assigned servers when no server is unowned', async () => {
        colabClientStub.listAssignments.resolves([
          assignmentWithName,
          assignmentWithoutName,
          assignmentWithoutSession,
        ]);
        const assignedServer1 = {
          ...defaultServer,
          endpoint: assignmentWithName.endpoint,
        };
        const assignedServer2 = {
          ...defaultServer,
          endpoint: assignmentWithoutName.endpoint,
        };
        const assignedServer3 = {
          ...defaultServer,
          endpoint: assignmentWithoutSession.endpoint,
        };
        await serverStorage.store([
          assignedServer1,
          assignedServer2,
          assignedServer3,
        ]);

        const results = await assignmentManager.getServers('all');

        expect(stripNetworkOverrides([...results.assigned])).to.deep.equal([
          assignedServer1,
          assignedServer2,
          assignedServer3,
        ]);
        expect(results.unowned).to.be.empty;
      });

      it('reconciles assigned servers before returning', async () => {
        colabClientStub.listAssignments.resolves([assignmentWithName]);
        const assignedServer = {
          ...defaultServer,
          endpoint: assignmentWithName.endpoint,
        };
        const noLongerAssignedServer = {
          ...defaultServer,
          endpoint: 'no-longer-assigned',
        };
        await serverStorage.store([assignedServer, noLongerAssignedServer]);

        const results = await assignmentManager.getServers('all');

        expect(stripNetworkOverrides([...results.assigned])).to.deep.equal([
          assignedServer,
        ]);
      });
    });
  });

  describe('getLastKnownAssignedServers', () => {
    it('throws after being disposed', async () => {
      assignmentManager.dispose();

      await expect(
        assignmentManager.getLastKnownAssignedServers(),
      ).to.be.rejectedWith(/disposed/);
    });

    it('returns an empty list when there are no stored servers', async () => {
      expect(
        await assignmentManager.getLastKnownAssignedServers(),
      ).to.deep.equal([]);
    });

    it('returns all stored servers with connection info omitted', async () => {
      const storedServers = [
        { ...defaultServer, id: randomUUID() },
        { ...defaultServer, id: randomUUID() },
      ];
      await serverStorage.store(storedServers);

      const servers = await assignmentManager.getLastKnownAssignedServers();

      expect(servers).to.deep.equal([
        {
          id: storedServers[0].id,
          label: storedServers[0].label,
          variant: storedServers[0].variant,
          accelerator: storedServers[0].accelerator,
          dateAssigned: storedServers[0].dateAssigned,
          endpoint: storedServers[0].endpoint,
        },
        {
          id: storedServers[1].id,
          label: storedServers[1].label,
          variant: storedServers[1].variant,
          accelerator: storedServers[1].accelerator,
          dateAssigned: storedServers[1].dateAssigned,
          endpoint: storedServers[1].endpoint,
        },
      ]);
    });
  });

  describe('assignServer', () => {
    describe('with Public API disabled', () => {
      beforeEach(() => {
        EXPERIMENT_TEST.setFlagForTest(ExperimentFlag.EnablePublicApi, false);
      });

      it('throws after being disposed', async () => {
        assignmentManager.dispose();

        await expect(
          assignmentManager.assignServer(defaultAssignmentDescriptor),
        ).to.be.rejectedWith(/disposed/);
      });

      it('throws an error when the assignment does not include a URL to connect to', () => {
        colabClientStub.assign
          .withArgs(sinon.match(isUUID), {
            variant: defaultAssignment.variant,
            accelerator: defaultAssignment.accelerator,
          })
          .resolves({
            assignment: {
              ...defaultAssignment,
              runtimeProxyInfo: {
                ...defaultAssignment.runtimeProxyInfo,
                url: '',
              },
            },
            isNew: false,
          });

        expect(
          assignmentManager.assignServer(defaultAssignmentDescriptor),
        ).to.be.rejectedWith(/connection info/);
      });

      it('throws an error when the assignment does not include a token to connect with', () => {
        colabClientStub.assign
          .withArgs(sinon.match(isUUID), {
            variant: defaultAssignment.variant,
            accelerator: defaultAssignment.accelerator,
          })
          .resolves({
            assignment: {
              ...defaultAssignment,
              runtimeProxyInfo: {
                ...defaultAssignment.runtimeProxyInfo,
                token: '',
              },
            },
            isNew: false,
          });

        expect(
          assignmentManager.assignServer(defaultAssignmentDescriptor),
        ).to.be.rejectedWith(/connection info/);
      });

      describe('when a server is assigned', () => {
        let assignedServer: ColabAssignedServer;

        beforeEach(async () => {
          colabClientStub.assign
            .withArgs(sinon.match(isUUID), {
              variant: defaultServer.variant,
              accelerator: defaultServer.accelerator,
              shape: undefined,
              version: undefined,
            })
            .resolves({ assignment: defaultAssignment, isNew: false });
          colabClientStub.listAssignments.resolves([defaultAssignment]);
          await serverStorage.store([defaultServer]);

          assignedServer = await assignmentManager.assignServer(
            defaultAssignmentDescriptor,
          );
        });

        it('stores and returns the server', () => {
          const { id: assignedId, ...got } =
            stripNetworkOverride(assignedServer);
          const { id: defaultId, ...want } = defaultServer;
          expect(got).to.deep.equal(want);
          expect(assignedId).to.satisfy(isUUID);
        });

        it('emits an assignment change event', () => {
          const { id: defaultId, ...want } = defaultServer;
          sinon.assert.calledOnceWithMatch(assignmentChangeListener, {
            added: [sinon.match(want)],
            removed: [],
            changed: [],
          });
        });

        it('includes a fetch implementation that attaches Colab connection info', async () => {
          assert.isDefined(assignedServer.connectionInformation.fetch);
          const fetchStub = sinon.stub(fetch, 'default');

          await assignedServer.connectionInformation.fetch(
            'https://example.com',
          );

          sinon.assert.calledOnceWithMatch(fetchStub, 'https://example.com', {
            headers: new Headers({
              [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]:
                assignedServer.connectionInformation.token,
              [COLAB_CLIENT_AGENT_HEADER.key]: COLAB_CLIENT_AGENT_HEADER.value,
            }),
          });
        });

        it('includes a custom WebSocket implementation', () => {
          assert.isDefined(assignedServer.connectionInformation.WebSocket);
        });
      });

      describe('with too many assigned servers', () => {
        beforeEach(() => {
          colabClientStub.assign.rejects(new TooManyAssignmentsError());
        });

        it('notifies the user', async () => {
          await expect(
            assignmentManager.assignServer(defaultAssignmentDescriptor),
          ).to.eventually.be.rejectedWith(TooManyAssignmentsError);

          sinon.assert.calledOnceWithMatch(
            vsCodeStub.window.showErrorMessage as sinon.SinonStub,
            /too many/,
          );
        });

        it('presents an action to remove servers', async () => {
          (vsCodeStub.window.showErrorMessage as sinon.SinonStub).resolves(
            'Remove Server',
          );

          await expect(
            assignmentManager.assignServer(defaultAssignmentDescriptor),
          ).to.eventually.be.rejectedWith(TooManyAssignmentsError);

          sinon.assert.calledOnceWithExactly(
            vsCodeStub.commands.executeCommand,
            REMOVE_SERVER.id,
            CommandSource.COMMAND_SOURCE_NOTIFICATION,
          );
        });
      });

      describe('with insufficient quota', () => {
        beforeEach(() => {
          colabClientStub.assign.rejects(new InsufficientQuotaError('💰🐖'));
        });

        it('notifies the user', async () => {
          await expect(
            assignmentManager.assignServer(defaultAssignmentDescriptor),
          ).to.eventually.be.rejectedWith(InsufficientQuotaError);

          sinon.assert.calledOnceWithMatch(
            vsCodeStub.window.showErrorMessage as sinon.SinonStub,
            /Unable to assign .* 💰🐖/,
          );
        });

        it('presents an action to learn more', async () => {
          sinon.stub(assignmentManager, 'hasAssignedServer').resolves(false);
          (vsCodeStub.window.showErrorMessage as sinon.SinonStub).resolves(
            'Learn More',
          );

          await expect(
            assignmentManager.assignServer(defaultAssignmentDescriptor),
          ).to.eventually.be.rejectedWith(InsufficientQuotaError);

          sinon.assert.calledOnceWithMatch(
            vsCodeStub.env.openExternal,
            sinon.match(function (url: Uri) {
              return (
                url.toString() ===
                'https://research.google.com/colaboratory/faq.html#resource-limits'
              );
            }),
          );
        });
      });

      describe('when the user is banned', () => {
        beforeEach(() => {
          colabClientStub.assign.rejects(new DenylistedError('👨‍⚖️'));
        });

        it('notifies the user', async () => {
          await expect(
            assignmentManager.assignServer(defaultAssignmentDescriptor),
          ).to.eventually.be.rejectedWith(DenylistedError);

          sinon.assert.calledOnceWithMatch(
            vsCodeStub.window.showErrorMessage as sinon.SinonStub,
            /Unable to assign .* 👨‍⚖️/,
          );
        });
      });

      describe('with an accelerator that is unavailable', () => {
        beforeEach(() => {
          colabClientStub.getUserInfo.resolves({
            subscriptionTier: SubscriptionTier.PRO,
            paidComputeUnitsBalance: 1,
            eligibleAccelerators: [
              {
                variant: Variant.GPU,
                models: ['T4', 'V100', 'A100', 'H100'],
              },
            ],
            ineligibleAccelerators: [],
          });

          colabClientStub.assign
            .withArgs(sinon.match(isUUID), {
              variant: Variant.GPU,
              accelerator: 'A100',
              shape: undefined,
              version: undefined,
            })
            .rejects(new AcceleratorUnavailableError('A100'));
        });

        it('falls back to the next available accelerator', async () => {
          colabClientStub.assign
            .withArgs(sinon.match(isUUID), {
              variant: Variant.GPU,
              accelerator: 'T4',
              shape: undefined,
              version: undefined,
            })
            .resolves({
              assignment: { ...defaultAssignment, accelerator: 'T4' },
              isNew: false,
            });

          const result = await assignmentManager.assignServer({
            label: 'Colab GPU A100',
            variant: Variant.GPU,
            accelerator: 'A100',
          });

          expect(result.accelerator).to.equal('T4');
          sinon.assert.calledWithMatch(
            vsCodeStub.window.showInformationMessage as sinon.SinonStub,
            /Requested accelerator "A100" is unavailable, assigned "T4"/,
          );
        });

        it('falls back multiple times to the next available accelerator', async () => {
          colabClientStub.assign
            .withArgs(
              sinon.match(isUUID),
              sinon.match({
                accelerator: sinon.match.in(['A100', 'T4', 'V100']),
              }),
            )
            .rejects(new AcceleratorUnavailableError('A100'))
            .withArgs(sinon.match(isUUID), sinon.match({ accelerator: 'H100' }))
            .resolves({
              assignment: { ...defaultAssignment, accelerator: 'H100' },
              isNew: false,
            });

          const result = await assignmentManager.assignServer({
            label: 'Colab GPU A100',
            variant: Variant.GPU,
            accelerator: 'A100',
          });

          expect(result.accelerator).to.equal('H100');
          sinon.assert.calledWithMatch(
            vsCodeStub.window.showInformationMessage as sinon.SinonStub,
            /Requested accelerator "A100" is unavailable, assigned "H100"/,
          );
        });

        it('throws an error if all fallbacks fail', async () => {
          colabClientStub.assign.rejects(
            new AcceleratorUnavailableError('any'),
          );

          await expect(
            assignmentManager.assignServer({
              label: 'Colab GPU A100',
              variant: Variant.GPU,
              accelerator: 'A100',
            }),
          ).to.be.rejectedWith(
            /All GPU accelerators are unavailable: A100, T4, V100/,
          );

          sinon.assert.calledWithMatch(
            vsCodeStub.window.showErrorMessage as sinon.SinonStub,
            /Unable to assign server. All GPU accelerators are unavailable: A100, T4, V100/,
          );
        });
      });

      describe('telemetry', () => {
        let logStub: SinonStubbedFunction<typeof telemetry.logAssignServer>;

        beforeEach(() => {
          logStub = sinon.stub(telemetry, 'logAssignServer');
        });

        afterEach(() => {
          logStub.restore();
        });

        it('logs OUTCOME_SUCCEEDED with the requested configuration', async () => {
          colabClientStub.assign.resolves({
            assignment: defaultAssignment,
            isNew: false,
          });

          await assignmentManager.assignServer(defaultAssignmentDescriptor);

          sinon.assert.calledOnceWithExactly(
            logStub,
            AssignmentOutcome.ASSIGNMENT_OUTCOME_SUCCEEDED,
            {
              variant: Variant.GPU,
              accelerator: 'A100',
              shape: '',
              version: '',
              hadFallback: false,
            },
          );
        });

        it('logs hadFallback=true when a fallback succeeds', async () => {
          colabClientStub.getUserInfo.resolves({
            subscriptionTier: SubscriptionTier.PRO,
            paidComputeUnitsBalance: 1,
            eligibleAccelerators: [
              { variant: Variant.GPU, models: ['T4', 'A100'] },
            ],
            ineligibleAccelerators: [],
          });
          colabClientStub.assign
            .withArgs(sinon.match(isUUID), {
              variant: Variant.GPU,
              accelerator: 'A100',
              shape: undefined,
              version: undefined,
            })
            .rejects(new AcceleratorUnavailableError('A100'))
            .withArgs(sinon.match(isUUID), {
              variant: Variant.GPU,
              accelerator: 'T4',
              shape: undefined,
              version: undefined,
            })
            .resolves({
              assignment: { ...defaultAssignment, accelerator: 'T4' },
              isNew: false,
            });

          await assignmentManager.assignServer(defaultAssignmentDescriptor);

          sinon.assert.calledOnceWithExactly(
            logStub,
            AssignmentOutcome.ASSIGNMENT_OUTCOME_SUCCEEDED,
            {
              variant: Variant.GPU,
              accelerator: 'A100',
              shape: '',
              version: '',
              hadFallback: true,
            },
          );
        });

        it('logs OUTCOME_ALL_ACCELERATORS_UNAVAILABLE when fallbacks are exhausted', async () => {
          colabClientStub.getUserInfo.resolves({
            subscriptionTier: SubscriptionTier.PRO,
            paidComputeUnitsBalance: 1,
            eligibleAccelerators: [
              { variant: Variant.GPU, models: ['T4', 'A100'] },
            ],
            ineligibleAccelerators: [],
          });
          colabClientStub.assign.rejects(
            new AcceleratorUnavailableError('any'),
          );

          await expect(
            assignmentManager.assignServer(defaultAssignmentDescriptor),
          ).to.be.rejected;

          sinon.assert.calledOnceWithExactly(
            logStub,
            AssignmentOutcome.ASSIGNMENT_OUTCOME_ALL_ACCELERATORS_UNAVAILABLE,
            {
              variant: Variant.GPU,
              accelerator: 'A100',
              shape: '',
              version: '',
              hadFallback: true,
            },
          );
        });

        const errorOutcomeCases = [
          {
            label: 'OUTCOME_TOO_MANY_ASSIGNMENTS',
            error: new TooManyAssignmentsError(),
            outcome: AssignmentOutcome.ASSIGNMENT_OUTCOME_TOO_MANY_ASSIGNMENTS,
          },
          {
            label: 'OUTCOME_INSUFFICIENT_QUOTA',
            error: new InsufficientQuotaError('💰🐖'),
            outcome: AssignmentOutcome.ASSIGNMENT_OUTCOME_INSUFFICIENT_QUOTA,
          },
          {
            label: 'OUTCOME_DENYLISTED',
            error: new DenylistedError('👨‍⚖️'),
            outcome: AssignmentOutcome.ASSIGNMENT_OUTCOME_DENYLISTED,
          },
          {
            label: 'OUTCOME_OTHER_FAILURE for unexpected errors',
            error: new Error('boom'),
            outcome: AssignmentOutcome.ASSIGNMENT_OUTCOME_OTHER_FAILURE,
          },
        ];
        for (const { label, error, outcome } of errorOutcomeCases) {
          it(`logs ${label}`, async () => {
            colabClientStub.assign.rejects(error);

            await expect(
              assignmentManager.assignServer(defaultAssignmentDescriptor),
            ).to.be.rejected;

            sinon.assert.calledOnceWithExactly(logStub, outcome, {
              variant: Variant.GPU,
              accelerator: 'A100',
              shape: '',
              version: '',
              hadFallback: false,
            });
          });
        }

        it('logs the requested shape and version when present', async () => {
          colabClientStub.assign.resolves({
            assignment: defaultAssignment,
            isNew: false,
          });

          await assignmentManager.assignServer({
            ...defaultAssignmentDescriptor,
            shape: Shape.HIGHMEM,
            version: 'v1',
          });

          sinon.assert.calledOnceWithExactly(
            logStub,
            AssignmentOutcome.ASSIGNMENT_OUTCOME_SUCCEEDED,
            {
              variant: Variant.GPU,
              accelerator: 'A100',
              shape: 'HIGHMEM',
              version: 'v1',
              hadFallback: false,
            },
          );
        });

        it('logs an empty accelerator for the default CPU descriptor', async () => {
          colabClientStub.assign.resolves({
            assignment: { ...defaultAssignment, accelerator: 'NONE' },
            isNew: false,
          });

          await assignmentManager.assignServer(DEFAULT_CPU_SERVER);

          sinon.assert.calledOnceWithExactly(
            logStub,
            AssignmentOutcome.ASSIGNMENT_OUTCOME_SUCCEEDED,
            {
              variant: Variant.DEFAULT,
              accelerator: '',
              shape: '',
              version: '',
              hadFallback: false,
            },
          );
        });
      });
    });

    describe('with Public API enabled', () => {
      beforeEach(() => {
        EXPERIMENT_TEST.setFlagForTest(ExperimentFlag.EnablePublicApi, true);
      });

      it('throws after being disposed', async () => {
        assignmentManager.dispose();

        await expect(
          assignmentManager.assignServer(defaultAssignmentDescriptor),
        ).to.be.rejectedWith(/disposed/);
      });

      it('throws an error when the assignment does not include a URL to connect to', () => {
        (colabApiClientStub.colab.createRuntime as sinon.SinonStub)
          .withArgs(
            sinon.match((req: CreateRuntimeRequest) => {
              const spec = req.runtime?.runtimeSpec;
              return (
                req.requestId &&
                isUUID(req.requestId) &&
                spec?.variant === defaultRuntime.runtimeSpec.variant &&
                spec.shape === defaultRuntime.runtimeSpec.shape &&
                spec.accelerator === defaultRuntime.runtimeSpec.accelerator &&
                req.runtime?.version === defaultRuntime.version
              );
            }),
          )
          .resolves({
            done: true,
            response: {
              ...defaultRuntime,
              connectionInfo: {
                ...defaultRuntime.connectionInfo,
                url: '',
              },
            },
          });

        expect(
          assignmentManager.assignServer(defaultAssignmentDescriptor),
        ).to.be.rejectedWith(/connection info/);
      });

      it('throws an error when the assignment does not include a token to connect with', () => {
        (colabApiClientStub.colab.createRuntime as sinon.SinonStub)
          .withArgs(
            sinon.match((req: CreateRuntimeRequest) => {
              const spec = req.runtime?.runtimeSpec;
              return (
                req.requestId &&
                isUUID(req.requestId) &&
                spec?.variant === defaultRuntime.runtimeSpec.variant &&
                spec.shape === defaultRuntime.runtimeSpec.shape &&
                spec.accelerator === defaultRuntime.runtimeSpec.accelerator &&
                req.runtime?.version === defaultRuntime.version
              );
            }),
          )
          .resolves({
            done: true,
            response: {
              ...defaultRuntime,
              connectionInfo: {
                ...defaultRuntime.connectionInfo,
                token: '',
              },
            },
          });

        expect(
          assignmentManager.assignServer(defaultAssignmentDescriptor),
        ).to.be.rejectedWith(/connection info/);
      });

      describe('when a server is assigned', () => {
        let assignedServer: ColabAssignedServer;

        beforeEach(async () => {
          (colabApiClientStub.colab.createRuntime as sinon.SinonStub)
            .withArgs(
              sinon.match((req: CreateRuntimeRequest) => {
                const spec = req.runtime?.runtimeSpec;
                return (
                  req.requestId &&
                  isUUID(req.requestId) &&
                  spec?.variant === defaultRuntime.runtimeSpec.variant &&
                  spec.shape === defaultRuntime.runtimeSpec.shape &&
                  spec.accelerator === defaultRuntime.runtimeSpec.accelerator &&
                  req.runtime?.version === defaultRuntime.version
                );
              }),
            )
            .resolves({
              done: true,
              response: defaultRuntime,
            });
          colabClientStub.listAssignments.resolves([defaultAssignment]);
          await serverStorage.store([defaultServerV2]);

          assignedServer = await assignmentManager.assignServer(
            defaultServerDescriptor,
          );
        });

        it('stores and returns the server', () => {
          expect(stripNetworkOverride(assignedServer)).to.deep.equal(
            defaultServerV2,
          );
        });

        it('emits an assignment change event', () => {
          sinon.assert.calledOnceWithMatch(assignmentChangeListener, {
            added: [sinon.match(defaultServerV2)],
            removed: [],
            changed: [],
          });
        });

        it('includes a fetch implementation that attaches Colab connection info', async () => {
          assert.isDefined(assignedServer.connectionInformation.fetch);
          const fetchStub = sinon.stub(fetch, 'default');

          await assignedServer.connectionInformation.fetch(
            'https://example.com',
          );

          sinon.assert.calledOnceWithMatch(fetchStub, 'https://example.com', {
            headers: new Headers({
              [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]:
                assignedServer.connectionInformation.token,
              [COLAB_CLIENT_AGENT_HEADER.key]: COLAB_CLIENT_AGENT_HEADER.value,
            }),
          });
        });

        it('includes a custom WebSocket implementation', () => {
          assert.isDefined(assignedServer.connectionInformation.WebSocket);
        });
      });

      describe('when a server is assigned in a long-running operation', () => {
        const OPERATION_ID = randomUUID();
        const WAIT_OPERATION_TIMEOUT = '120s';

        beforeEach(() => {
          (colabApiClientStub.colab.createRuntime as sinon.SinonStub)
            .withArgs(
              sinon.match((req: CreateRuntimeRequest) => {
                const spec = req.runtime?.runtimeSpec;
                return (
                  req.requestId &&
                  isUUID(req.requestId) &&
                  spec?.variant === defaultRuntime.runtimeSpec.variant &&
                  spec.shape === defaultRuntime.runtimeSpec.shape &&
                  spec.accelerator === defaultRuntime.runtimeSpec.accelerator &&
                  req.runtime?.version === defaultRuntime.version
                );
              }),
            )
            .resolves({
              name: `operations/${OPERATION_ID}`,
              done: false,
            });
          (colabApiClientStub.operations.waitOperation as sinon.SinonStub)
            .withArgs(
              sinon.match(
                (req: WaitOperationRequest) =>
                  req.operationsId === OPERATION_ID &&
                  req.timeout === WAIT_OPERATION_TIMEOUT,
              ),
            )
            .resolves({
              name: `operations/${OPERATION_ID}`,
              done: true,
              response: defaultRuntime,
            });

          vsCodeStub.window.withProgress
            .withArgs(
              sinon.match({
                location: vsCodeStub.ProgressLocation.Notification,
                title: 'Assigning server...',
                cancellable: false,
              }),
              sinon.match.any,
            )
            .callsFake((_, task) => {
              const tokenSource = new vsCodeStub.CancellationTokenSource();
              return task({ report: sinon.stub() }, tokenSource.token);
            });
        });

        it('stores and returns the server with progress', async () => {
          const assignedServer = await assignmentManager.assignServer(
            defaultServerDescriptor,
          );

          expect(stripNetworkOverride(assignedServer)).to.deep.equal(
            defaultServerV2,
          );
          sinon.assert.calledOnce(vsCodeStub.window.withProgress);
        });
      });

      describe('with too many assigned servers', () => {
        beforeEach(() => {
          (colabApiClientStub.colab.createRuntime as sinon.SinonStub).resolves({
            done: true,
            error: {
              code: 9,
              details: [{ reason: 'TOO_MANY_ACTIVE_RUNTIMES' }],
            },
          });
        });

        it('notifies the user', async () => {
          await expect(
            assignmentManager.assignServer(defaultServerDescriptor),
          ).to.eventually.be.rejectedWith(TooManyAssignmentsError);

          sinon.assert.calledOnceWithMatch(
            vsCodeStub.window.showErrorMessage as sinon.SinonStub,
            /too many/,
          );
        });

        it('presents an action to remove servers', async () => {
          (vsCodeStub.window.showErrorMessage as sinon.SinonStub).resolves(
            'Remove Server',
          );

          await expect(
            assignmentManager.assignServer(defaultServerDescriptor),
          ).to.eventually.be.rejectedWith(TooManyAssignmentsError);

          sinon.assert.calledOnceWithExactly(
            vsCodeStub.commands.executeCommand,
            REMOVE_SERVER.id,
            CommandSource.COMMAND_SOURCE_NOTIFICATION,
          );
        });
      });

      describe('with insufficient quota', () => {
        beforeEach(() => {
          (colabApiClientStub.colab.createRuntime as sinon.SinonStub).resolves({
            done: true,
            error: {
              code: 9,
              details: [{ reason: 'QUOTA_EXCEEDED_USAGE_TIME' }],
            },
          });
        });

        it('notifies the user', async () => {
          await expect(
            assignmentManager.assignServer(defaultServerDescriptor),
          ).to.eventually.be.rejectedWith(InsufficientQuotaError);

          sinon.assert.calledOnceWithMatch(
            vsCodeStub.window.showErrorMessage as sinon.SinonStub,
            /Unable to assign/,
          );
        });

        it('presents an action to learn more', async () => {
          sinon.stub(assignmentManager, 'hasAssignedServer').resolves(false);
          (vsCodeStub.window.showErrorMessage as sinon.SinonStub).resolves(
            'Learn More',
          );

          await expect(
            assignmentManager.assignServer(defaultServerDescriptor),
          ).to.eventually.be.rejectedWith(InsufficientQuotaError);

          sinon.assert.calledOnceWithMatch(
            vsCodeStub.env.openExternal,
            sinon.match(function (url: Uri) {
              return (
                url.toString() ===
                'https://research.google.com/colaboratory/faq.html#resource-limits'
              );
            }),
          );
        });
      });

      describe('when the user is banned', () => {
        beforeEach(() => {
          (colabApiClientStub.colab.createRuntime as sinon.SinonStub).resolves({
            done: true,
            error: {
              code: 9,
              details: [{ reason: 'DENYLISTED' }],
            },
          });
        });

        it('notifies the user', async () => {
          await expect(
            assignmentManager.assignServer(defaultServerDescriptor),
          ).to.eventually.be.rejectedWith(DenylistedError);

          sinon.assert.calledOnceWithMatch(
            vsCodeStub.window.showErrorMessage as sinon.SinonStub,
            /Unable to assign/,
          );
        });
      });

      describe('with an accelerator that is unavailable', () => {
        beforeEach(() => {
          (
            colabApiClientStub.colab.listRuntimeSpecs as sinon.SinonStub
          ).resolves({
            runtimeSpecs: [
              {
                key: {
                  variant: 'VARIANT_GPU',
                  accelerator: 'A100',
                  shape: 'SHAPE_STANDARD',
                },
                eligible: true,
              },
              {
                key: {
                  variant: 'VARIANT_GPU',
                  accelerator: 'T4',
                  shape: 'SHAPE_STANDARD',
                },
                eligible: true,
              },
              // Intentionally include a second T4 spec of high-mem shape to
              // ensure accelerator fallbacks are de-dupped.
              {
                key: {
                  variant: 'VARIANT_GPU',
                  accelerator: 'T4',
                  shape: 'SHAPE_HIGHMEM',
                },
                eligible: true,
              },
              {
                key: {
                  variant: 'VARIANT_GPU',
                  accelerator: 'V100',
                  shape: 'SHAPE_STANDARD',
                },
                eligible: true,
              },
              {
                key: {
                  variant: 'VARIANT_GPU',
                  accelerator: 'H100',
                  shape: 'SHAPE_STANDARD',
                },
                eligible: true,
              },
            ],
          });
          (colabApiClientStub.colab.createRuntime as sinon.SinonStub)
            .withArgs(
              sinon.match((req: CreateRuntimeRequest) => {
                const spec = req.runtime?.runtimeSpec;
                return (
                  spec?.variant === 'VARIANT_GPU' && spec.accelerator === 'A100'
                );
              }),
            )
            .resolves({
              done: true,
              error: {
                code: 9,
                details: [{ reason: 'NO_RUNTIMES' }],
              },
            });
        });

        it('falls back to the next available accelerator', async () => {
          (colabApiClientStub.colab.createRuntime as sinon.SinonStub)
            .withArgs(
              sinon.match((req: CreateRuntimeRequest) => {
                const spec = req.runtime?.runtimeSpec;
                return (
                  spec?.variant === 'VARIANT_GPU' && spec.accelerator === 'T4'
                );
              }),
            )
            .resolves({
              done: true,
              response: {
                ...defaultRuntime,
                runtimeSpec: {
                  ...defaultRuntime.runtimeSpec,
                  accelerator: 'T4',
                },
              },
            });

          const result = await assignmentManager.assignServer({
            label: 'Colab GPU A100',
            variant: Variant.GPU,
            accelerator: 'A100',
          });

          expect(result.accelerator).to.equal('T4');
          sinon.assert.calledWithMatch(
            vsCodeStub.window.showInformationMessage as sinon.SinonStub,
            /Requested accelerator "A100" is unavailable, assigned "T4"/,
          );
        });

        it('falls back multiple times to the next available accelerator', async () => {
          (colabApiClientStub.colab.createRuntime as sinon.SinonStub)
            .withArgs(
              sinon.match((req: CreateRuntimeRequest) => {
                const spec = req.runtime?.runtimeSpec;
                return (
                  spec?.variant === 'VARIANT_GPU' &&
                  ['A100', 'T4', 'V100'].includes(spec.accelerator)
                );
              }),
            )
            .resolves({
              done: true,
              error: {
                code: 9,
                details: [{ reason: 'NO_RUNTIMES' }],
              },
            })
            .withArgs(
              sinon.match((req: CreateRuntimeRequest) => {
                const spec = req.runtime?.runtimeSpec;
                return (
                  spec?.variant === 'VARIANT_GPU' && spec.accelerator === 'H100'
                );
              }),
            )
            .resolves({
              done: true,
              response: {
                ...defaultRuntime,
                runtimeSpec: {
                  ...defaultRuntime.runtimeSpec,
                  accelerator: 'H100',
                },
              },
            });

          const result = await assignmentManager.assignServer({
            label: 'Colab GPU A100',
            variant: Variant.GPU,
            accelerator: 'A100',
          });

          expect(result.accelerator).to.equal('H100');
          sinon.assert.calledWithMatch(
            vsCodeStub.window.showInformationMessage as sinon.SinonStub,
            /Requested accelerator "A100" is unavailable, assigned "H100"/,
          );
        });

        it('throws an error if all fallbacks fail', async () => {
          (colabApiClientStub.colab.createRuntime as sinon.SinonStub).resolves({
            done: true,
            error: {
              code: 9,
              details: [{ reason: 'NO_RUNTIMES' }],
            },
          });

          await expect(
            assignmentManager.assignServer({
              label: 'Colab GPU A100',
              variant: Variant.GPU,
              accelerator: 'A100',
            }),
          ).to.be.rejectedWith(
            /All GPU accelerators are unavailable: A100, T4, V100/,
          );

          sinon.assert.calledWithMatch(
            vsCodeStub.window.showErrorMessage as sinon.SinonStub,
            /Unable to assign server. All GPU accelerators are unavailable: A100, T4, V100/,
          );
        });
      });

      describe('telemetry', () => {
        let logStub: SinonStubbedFunction<typeof telemetry.logAssignServer>;

        beforeEach(() => {
          logStub = sinon.stub(telemetry, 'logAssignServer');
        });

        afterEach(() => {
          logStub.restore();
        });

        it('logs OUTCOME_SUCCEEDED with the requested configuration', async () => {
          (colabApiClientStub.colab.createRuntime as sinon.SinonStub).resolves({
            done: true,
            response: defaultRuntime,
          });

          await assignmentManager.assignServer(defaultServerDescriptor);

          sinon.assert.calledOnceWithExactly(
            logStub,
            AssignmentOutcome.ASSIGNMENT_OUTCOME_SUCCEEDED,
            {
              variant: defaultServerDescriptor.variant,
              accelerator: defaultServerDescriptor.accelerator ?? '',
              shape: 'STANDARD',
              version: defaultServerDescriptor.version ?? '',
              hadFallback: false,
            },
          );
        });

        it('logs hadFallback=true when a fallback succeeds', async () => {
          (
            colabApiClientStub.colab.listRuntimeSpecs as sinon.SinonStub
          ).resolves({
            runtimeSpecs: [
              {
                key: {
                  variant: 'VARIANT_GPU',
                  accelerator: 'A100',
                  shape: 'SHAPE_STANDARD',
                },
                eligible: true,
              },
              {
                key: {
                  variant: 'VARIANT_GPU',
                  accelerator: 'T4',
                  shape: 'SHAPE_STANDARD',
                },
                eligible: true,
              },
            ],
          });
          (colabApiClientStub.colab.createRuntime as sinon.SinonStub)
            .withArgs(
              sinon.match((req: CreateRuntimeRequest) => {
                const spec = req.runtime?.runtimeSpec;
                return (
                  spec?.variant === 'VARIANT_GPU' && spec.accelerator === 'A100'
                );
              }),
            )
            .resolves({
              done: true,
              error: {
                code: 9,
                details: [{ reason: 'NO_RUNTIMES' }],
              },
            })
            .withArgs(
              sinon.match((req: CreateRuntimeRequest) => {
                const spec = req.runtime?.runtimeSpec;
                return (
                  spec?.variant === 'VARIANT_GPU' && spec.accelerator === 'T4'
                );
              }),
            )
            .resolves({
              done: true,
              response: {
                ...defaultRuntime,
                runtimeSpec: {
                  ...defaultRuntime.runtimeSpec,
                  accelerator: 'T4',
                },
              },
            });

          await assignmentManager.assignServer(defaultServerDescriptor);

          sinon.assert.calledOnceWithExactly(
            logStub,
            AssignmentOutcome.ASSIGNMENT_OUTCOME_SUCCEEDED,
            {
              variant: defaultServerDescriptor.variant,
              accelerator: defaultServerDescriptor.accelerator ?? '',
              shape: 'STANDARD',
              version: defaultServerDescriptor.version ?? '',
              hadFallback: true,
            },
          );
        });

        it('logs OUTCOME_ALL_ACCELERATORS_UNAVAILABLE when fallbacks are exhausted', async () => {
          (
            colabApiClientStub.colab.listRuntimeSpecs as sinon.SinonStub
          ).resolves({
            runtimeSpecs: [
              {
                key: {
                  variant: 'VARIANT_GPU',
                  accelerator: 'A100',
                  shape: 'SHAPE_STANDARD',
                },
                eligible: true,
              },
              {
                key: {
                  variant: 'VARIANT_GPU',
                  accelerator: 'T4',
                  shape: 'SHAPE_STANDARD',
                },
                eligible: true,
              },
            ],
          });
          (colabApiClientStub.colab.createRuntime as sinon.SinonStub).resolves({
            done: true,
            error: {
              code: 9,
              details: [{ reason: 'NO_RUNTIMES' }],
            },
          });

          await expect(assignmentManager.assignServer(defaultServerDescriptor))
            .to.be.rejected;

          sinon.assert.calledOnceWithExactly(
            logStub,
            AssignmentOutcome.ASSIGNMENT_OUTCOME_ALL_ACCELERATORS_UNAVAILABLE,
            {
              variant: defaultServerDescriptor.variant,
              accelerator: defaultServerDescriptor.accelerator ?? '',
              shape: 'STANDARD',
              version: defaultServerDescriptor.version ?? '',
              hadFallback: true,
            },
          );
        });

        const errorOutcomeCases = [
          {
            label: 'OUTCOME_TOO_MANY_ASSIGNMENTS',
            code: 9,
            reason: 'TOO_MANY_ACTIVE_RUNTIMES',
            outcome: AssignmentOutcome.ASSIGNMENT_OUTCOME_TOO_MANY_ASSIGNMENTS,
          },
          {
            label: 'OUTCOME_INSUFFICIENT_QUOTA',
            code: 9,
            reason: 'QUOTA_EXCEEDED_USAGE_TIME',
            outcome: AssignmentOutcome.ASSIGNMENT_OUTCOME_INSUFFICIENT_QUOTA,
          },
          {
            label: 'OUTCOME_DENYLISTED',
            code: 9,
            reason: 'DENYLISTED',
            outcome: AssignmentOutcome.ASSIGNMENT_OUTCOME_DENYLISTED,
          },
          {
            label: 'OUTCOME_OTHER_FAILURE for unexpected errors',
            code: 6,
            reason: 'ALREADY_EXISTS',
            outcome: AssignmentOutcome.ASSIGNMENT_OUTCOME_OTHER_FAILURE,
          },
        ];
        for (const { label, code, reason, outcome } of errorOutcomeCases) {
          it(`logs ${label}`, async () => {
            (
              colabApiClientStub.colab.createRuntime as sinon.SinonStub
            ).resolves({
              done: true,
              error: {
                code,
                details: [{ reason }],
              },
            });

            await expect(
              assignmentManager.assignServer(defaultServerDescriptor),
            ).to.be.rejected;

            sinon.assert.calledOnceWithExactly(logStub, outcome, {
              variant: defaultServerDescriptor.variant,
              accelerator: defaultServerDescriptor.accelerator ?? '',
              shape: 'STANDARD',
              version: defaultServerDescriptor.version ?? '',
              hadFallback: false,
            });
          });
        }

        it('logs an empty accelerator for the default CPU descriptor', async () => {
          (colabApiClientStub.colab.createRuntime as sinon.SinonStub).resolves({
            done: true,
            response: {
              ...defaultRuntime,
              runtimeSpec: {
                ...defaultRuntime.runtimeSpec,
                accelerator: 'NONE',
              },
            },
          });

          await assignmentManager.assignServer(DEFAULT_CPU_SERVER);

          sinon.assert.calledOnceWithExactly(
            logStub,
            AssignmentOutcome.ASSIGNMENT_OUTCOME_SUCCEEDED,
            {
              variant: DEFAULT_CPU_SERVER.variant,
              accelerator: '',
              shape: '',
              version: '',
              hadFallback: false,
            },
          );
        });
      });
    });
  });

  describe('unassignServer', () => {
    it('throws after being disposed', async () => {
      assignmentManager.dispose();

      await expect(
        assignmentManager.unassignServer(defaultServer),
      ).to.be.rejectedWith(/disposed/);
    });

    it('does nothing when the server does not exist', async () => {
      await assignmentManager.unassignServer(defaultServer);

      sinon.assert.notCalled(colabClientStub.unassign);
      sinon.assert.notCalled(vsCodeStub.commands.executeCommand);
      sinon.assert.notCalled(assignmentChangeListener);
    });

    describe('when a server created in VS Code exists', () => {
      let jupyterStub: JupyterClientStub;

      beforeEach(async () => {
        await serverStorage.store([defaultServer]);
        jupyterStub = createJupyterClientStub();
        jupyterStaticConnectionStub
          .withArgs(
            defaultServer.connectionInformation.baseUrl,
            defaultServer.connectionInformation.token,
          )
          .returns(jupyterStub);
      });

      it('deletes sessions', async () => {
        const session1 = {
          id: 'mock-session-id-1',
          kernel: {
            id: 'mock-kernel-id',
            name: 'mock-kernel-name',
            lastActivity: new Date().toISOString(),
            executionState: 'idle',
            connections: 1,
          },
          name: 'mock-session-name',
          path: 'mock-path',
          type: 'notebook',
        };
        const session2 = {
          ...session1,
          id: 'mock-session-id-2',
        };
        jupyterStub.sessions.list.resolves([session1, session2]);

        await assignmentManager.unassignServer(defaultServer);

        sinon.assert.calledTwice(jupyterStub.sessions.delete);
        sinon.assert.calledWith(jupyterStub.sessions.delete, {
          session: session1.id,
        });
        sinon.assert.calledWith(jupyterStub.sessions.delete, {
          session: session2.id,
        });
      });

      it('does not delete sessions when there are none', async () => {
        jupyterStub.sessions.list.resolves([]);

        await assignmentManager.unassignServer(defaultServer);

        sinon.assert.notCalled(jupyterStub.sessions.delete);
      });

      it('unassigns the server', async () => {
        jupyterStub.sessions.list.resolves([]);

        await assignmentManager.unassignServer(defaultServer);

        const serversAfter = await assignmentManager.getServers('extension');
        expect(serversAfter).to.be.empty;
        sinon.assert.calledOnceWithMatch(
          colabClientStub.unassign,
          defaultServer.endpoint,
        );
        sinon.assert.calledOnceWithExactly(assignmentChangeListener, {
          added: [],
          removed: [{ server: defaultServer, userInitiated: true }],
          changed: [],
        });
        sinon.assert.calledOnceWithMatch(
          vsCodeStub.window.showInformationMessage,
          sinon.match(/notebooks Colab GPU A100 was/),
        );
      });

      it('unassigns the server even if listing session fails', async () => {
        jupyterStub.sessions.list.rejects(new Error('list failed'));

        await assignmentManager.unassignServer(defaultServer);

        const serversAfter = await assignmentManager.getServers('extension');
        expect(serversAfter).to.be.empty;
        sinon.assert.calledOnceWithMatch(
          colabClientStub.unassign,
          defaultServer.endpoint,
        );
        sinon.assert.calledOnceWithExactly(assignmentChangeListener, {
          added: [],
          removed: [{ server: defaultServer, userInitiated: true }],
          changed: [],
        });
        sinon.assert.calledOnceWithMatch(
          vsCodeStub.window.showInformationMessage,
          sinon.match(/notebooks Colab GPU A100 was/),
        );
      });

      it('unassigns the server even if deleting session fails', async () => {
        const session = {
          id: 'mock-session-id-1',
          kernel: {
            id: 'mock-kernel-id',
            name: 'mock-kernel-name',
            lastActivity: new Date().toISOString(),
            executionState: 'idle',
            connections: 1,
          },
          name: 'mock-session-name',
          path: 'mock-path',
          type: 'notebook',
        };
        jupyterStub.sessions.list.resolves([session]);
        jupyterStub.sessions.delete.rejects(new Error('delete failed'));

        await assignmentManager.unassignServer(defaultServer);

        const serversAfter = await assignmentManager.getServers('extension');
        expect(serversAfter).to.be.empty;
        sinon.assert.calledOnceWithMatch(
          colabClientStub.unassign,
          defaultServer.endpoint,
        );
        sinon.assert.calledOnceWithExactly(assignmentChangeListener, {
          added: [],
          removed: [{ server: defaultServer, userInitiated: true }],
          changed: [],
        });
        sinon.assert.calledOnceWithMatch(
          vsCodeStub.window.showInformationMessage,
          sinon.match(/notebooks Colab GPU A100 was/),
        );
      });

      it('keeps the server tracked if remote unassign fails', async () => {
        jupyterStub.sessions.list.resolves([]);
        colabClientStub.unassign.rejects(new Error('unassign failed'));

        await expect(
          assignmentManager.unassignServer(defaultServer),
        ).to.be.rejectedWith('unassign failed');

        const serversAfter =
          await assignmentManager.getLastKnownAssignedServers();
        expect(serversAfter).to.deep.equal([
          {
            id: defaultServer.id,
            label: defaultServer.label,
            variant: defaultServer.variant,
            accelerator: defaultServer.accelerator,
            endpoint: defaultServer.endpoint,
            dateAssigned: defaultServer.dateAssigned,
          },
        ]);
        sinon.assert.calledOnceWithMatch(
          colabClientStub.unassign,
          defaultServer.endpoint,
        );
        sinon.assert.notCalled(assignmentChangeListener);
      });
    });

    describe('when an unowned server exists', () => {
      it('unassigns the server', async () => {
        const remoteServer = {
          endpoint: 'test-endpoint',
          label: 'name',
          variant: Variant.DEFAULT,
        };

        await assignmentManager.unassignServer(remoteServer);

        sinon.assert.calledOnceWithMatch(
          colabClientStub.unassign,
          remoteServer.endpoint,
        );
      });
    });
  });

  describe('latestOrAutoAssignServer', () => {
    it('throws after being disposed', async () => {
      assignmentManager.dispose();

      await expect(
        assignmentManager.latestOrAutoAssignServer(),
      ).to.be.rejectedWith(/disposed/);
    });

    it('assigns a new default server when none have been assigned', async () => {
      colabClientStub.listAssignments.resolves([]);
      const defaultCpuAssignment = {
        ...defaultAssignment,
        variant: Variant.DEFAULT,
        accelerator: 'NONE',
      };
      const defaultCpuServer = {
        ...defaultServer,
        variant: Variant.DEFAULT,
        accelerator: 'NONE',
        label: 'Colab CPU',
      };
      colabClientStub.assign
        .withArgs(sinon.match(isUUID), {
          variant: Variant.DEFAULT,
          accelerator: undefined,
          shape: undefined,
          version: undefined,
        })
        .resolves({ assignment: defaultCpuAssignment, isNew: true });

      const server = await assignmentManager.latestOrAutoAssignServer();

      const { id: _g, ...got } = stripNetworkOverride(server);
      const { id: _w, ...want } = defaultCpuServer;
      expect(got).to.deep.equal(want);
    });

    it('reconciles servers before resolving', async () => {
      const deadServer = defaultServer;
      const olderActiveServer: ColabAssignedServer = {
        ...defaultServer,
        id: randomUUID(),
        endpoint: 'm-s-bar',
        label: 'Older server',
        dateAssigned: new Date(NOW.getTime() - 10000),
      };
      const olderActiveAssignment: Assignment = {
        ...defaultAssignment,
        endpoint: olderActiveServer.endpoint,
      };
      colabClientStub.listAssignments.resolves([olderActiveAssignment]);
      await serverStorage.store([deadServer, olderActiveServer]);

      const server = await assignmentManager.latestOrAutoAssignServer();

      expect(stripNetworkOverride(server)).to.deep.equal(olderActiveServer);
    });
  });

  describe('latestServer', () => {
    it('throws after being disposed', async () => {
      assignmentManager.dispose();

      await expect(assignmentManager.latestServer()).to.be.rejectedWith(
        /disposed/,
      );
    });

    it('returns undefined when none have been assigned', async () => {
      colabClientStub.listAssignments.resolves([]);

      const server = await assignmentManager.latestServer();
      expect(server).to.equal(undefined);
    });

    it('reconciles servers before resolving', async () => {
      const deadServer = defaultServer;
      const olderActiveServer: ColabAssignedServer = {
        ...defaultServer,
        id: randomUUID(),
        endpoint: 'm-s-bar',
        label: 'Older server',
        dateAssigned: new Date(NOW.getTime() - 10000),
      };
      const olderActiveAssignment: Assignment = {
        ...defaultAssignment,
        endpoint: olderActiveServer.endpoint,
      };
      colabClientStub.listAssignments.resolves([olderActiveAssignment]);
      await serverStorage.store([deadServer, olderActiveServer]);

      const server = await assignmentManager.latestServer();

      expect(server ? stripNetworkOverride(server) : null).to.deep.equal(
        olderActiveServer,
      );
    });
  });

  describe('refreshConnection', () => {
    it('throws after being disposed', async () => {
      assignmentManager.dispose();

      await expect(
        assignmentManager.refreshConnection(randomUUID()),
      ).to.be.rejectedWith(/disposed/);
    });

    it("throws a not found error when refreshing a server that's not tracked", async () => {
      await expect(
        assignmentManager.refreshConnection(defaultServer.id),
      ).to.eventually.be.rejectedWith(NotFoundError);
    });

    describe('with a refreshed connection', () => {
      const newToken = 'new-token';
      let refreshedServer: ColabAssignedServer;

      beforeEach(async () => {
        colabClientStub.listAssignments.resolves([defaultAssignment]);
        await serverStorage.store([defaultServer]);
        colabClientStub.refreshConnection
          .withArgs(defaultServer.endpoint)
          .resolves({
            ...defaultAssignment.runtimeProxyInfo,
            token: newToken,
          });

        refreshedServer = await assignmentManager.refreshConnection(
          defaultServer.id,
        );
      });

      it('stores and returns the server with updated connection info', () => {
        const expectedServer: ColabAssignedServer = {
          ...defaultServer,
          connectionInformation: {
            ...defaultServer.connectionInformation,
            headers: {
              [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]: newToken,
              [COLAB_CLIENT_AGENT_HEADER.key]: COLAB_CLIENT_AGENT_HEADER.value,
            },
            token: newToken,
          },
        };
        expect(stripNetworkOverride(refreshedServer)).to.deep.equal(
          expectedServer,
        );
      });

      it('includes a fetch implementation that attaches Colab connection info', async () => {
        assert.isDefined(refreshedServer.connectionInformation.fetch);
        const fetchStub = sinon.stub(fetch, 'default');

        await refreshedServer.connectionInformation.fetch(
          'https://example.com',
        );

        sinon.assert.calledOnceWithMatch(fetchStub, 'https://example.com', {
          headers: new Headers({
            [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]:
              refreshedServer.connectionInformation.token,
            [COLAB_CLIENT_AGENT_HEADER.key]: COLAB_CLIENT_AGENT_HEADER.value,
          }),
        });
      });

      it('includes a custom WebSocket implementation', () => {
        assert.isDefined(refreshedServer.connectionInformation.WebSocket);
      });

      it('emits an assignment change event', () => {
        sinon.assert.calledOnceWithExactly(assignmentChangeListener, {
          added: [],
          removed: [],
          changed: [refreshedServer],
        });
      });
    });
  });

  describe('getDefaultLabel', () => {
    it('throws after being disposed', async () => {
      assignmentManager.dispose();

      await expect(
        assignmentManager.getDefaultLabel(Variant.DEFAULT),
      ).to.be.rejectedWith(/disposed/);
    });

    it('returns a simple variant-accelerator pair when there are no assigned servers', async () => {
      await expect(
        assignmentManager.getDefaultLabel(Variant.GPU, 'A100'),
      ).to.eventually.equal('Colab GPU A100');
    });

    it('returns a simple variant-accelerator pair when there are only custom aliased servers', async () => {
      const variant = Variant.GPU;
      const accelerator = 'A100';
      await setupAssignments([{ variant, accelerator, label: 'foo' }]);

      await expect(
        assignmentManager.getDefaultLabel(variant, accelerator),
      ).to.eventually.equal('Colab GPU A100');
    });

    it('returns the next sequential label with one matching assigned server', async () => {
      const variant = Variant.GPU;
      const accelerator = 'A100';
      await setupAssignments([
        { variant, accelerator, label: 'Colab GPU A100' },
      ]);

      await expect(
        assignmentManager.getDefaultLabel(variant, accelerator),
      ).to.eventually.equal('Colab GPU A100 (1)');
    });

    it('returns the next sequential label with multiple assigned servers', async () => {
      const variant = Variant.GPU;
      const accelerator = 'A100';
      await setupAssignments([
        { variant, accelerator, label: 'Colab GPU A100' },
        { variant, accelerator, label: 'Colab GPU A100 (1)' },
      ]);

      await expect(
        assignmentManager.getDefaultLabel(variant, accelerator),
      ).to.eventually.equal('Colab GPU A100 (2)');
    });

    it('only increments from matching variant-accelerator server pairs', async () => {
      await setupAssignments([
        { variant: Variant.DEFAULT, label: 'Colab CPU' },
        {
          variant: Variant.GPU,
          accelerator: 'A100',
          label: 'Colab GPU A100',
        },
      ]);

      await expect(
        assignmentManager.getDefaultLabel(Variant.GPU, 'A100'),
      ).to.eventually.equal('Colab GPU A100 (1)');
    });

    // To ensure a string sort isn't used, which would put "10" before "2".
    it('uses the next sequential label with many assigned servers', async () => {
      const variant = Variant.GPU;
      const accelerator = 'A100';
      await setupAssignments(
        Array.from({ length: 10 }, (_, i) => i + 1)
          .map((i) => ({
            variant,
            accelerator,
            label: `Colab GPU A100 (${i.toString()})`,
          }))
          .concat({ variant, accelerator, label: 'Colab GPU A100' }),
      );

      await expect(
        assignmentManager.getDefaultLabel(variant, accelerator),
      ).to.eventually.equal('Colab GPU A100 (11)');
    });

    it('uses the simple variant-accelerator label when the initial assignment is missing', async () => {
      const variant = Variant.GPU;
      const accelerator = 'A100';
      await setupAssignments([
        { variant, accelerator, label: 'Colab GPU A100 (2)' },
      ]);

      await expect(
        assignmentManager.getDefaultLabel(variant, accelerator),
      ).to.eventually.equal('Colab GPU A100');
    });

    it("uses the next sequential label when there's an assigned server gap", async () => {
      const variant = Variant.GPU;
      const accelerator = 'A100';
      await setupAssignments([
        { variant, accelerator, label: 'Colab GPU A100 (2)' },
        { variant, accelerator, label: 'Colab GPU A100' },
      ]);

      await expect(
        assignmentManager.getDefaultLabel(variant, accelerator),
      ).to.eventually.equal('Colab GPU A100 (1)');
    });

    it('reconciles servers before determining label', async () => {
      colabClientStub.listAssignments.resolves([]);
      await serverStorage.store([defaultServer]);

      await expect(
        assignmentManager.getDefaultLabel(
          defaultServer.variant,
          defaultServer.accelerator,
        ),
      ).to.eventually.equal(defaultServer.label);
    });
  });

  describe('when the notification to reload notebooks is shown', () => {
    let showInfoMessageResolver: (value: MessageItem | undefined) => void;
    let showInfoMessage: Promise<MessageItem | undefined>;

    beforeEach(() => {
      /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */
      const assignmentChangeEmitter = (assignmentManager as any)
        .assignmentChange as TestEventEmitter<AssignmentChangeEvent>;
      /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access */
      showInfoMessage = new Promise<MessageItem | undefined>((resolve) => {
        showInfoMessageResolver = resolve;
      });
      vsCodeStub.window.showInformationMessage.callsFake(() => {
        return showInfoMessage;
      });
      assignmentChangeEmitter.fire({
        added: [],
        removed: [
          {
            server: { ...defaultServer, label: 'server A' },
            userInitiated: false,
          },
        ],
        changed: [],
      });
    });

    it('opens the Jupyter Github issue when the notification is clicked', async () => {
      showInfoMessageResolver({
        title: 'View Issue',
      });

      await expect(showInfoMessage).to.eventually.be.fulfilled;
      sinon.assert.calledWithMatch(
        vsCodeStub.env.openExternal,
        vsCodeStub.Uri.parse(
          'https://github.com/microsoft/vscode-jupyter/issues/17094',
        ),
      );
    });

    it('does not open the Jupyter Github issue when the notification is dismissed', async () => {
      showInfoMessageResolver(undefined);

      await expect(showInfoMessage).to.eventually.be.fulfilled;
      sinon.assert.notCalled(vsCodeStub.env.openExternal);
    });
  });
});

function stripNetworkOverride(
  server: ColabAssignedServer,
): ColabAssignedServer {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { fetch: _f, WebSocket: _ws, ...c } = server.connectionInformation;
  return {
    ...server,
    connectionInformation: c,
  };
}

function stripNetworkOverrides(
  servers: ColabAssignedServer[],
): ColabAssignedServer[] {
  return servers.map(stripNetworkOverride);
}
