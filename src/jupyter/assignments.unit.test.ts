/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "crypto";
import { assert, expect } from "chai";
import fetch, { Headers } from "node-fetch";
import sinon, { SinonFakeTimers, SinonStubbedInstance } from "sinon";
import { MessageItem, Uri } from "vscode";
import {
  Assignment,
  RuntimeProxyInfo,
  Shape,
  SubscriptionState,
  SubscriptionTier,
  Variant,
} from "../colab/api";
import {
  ColabClient,
  DenylistedError,
  InsufficientQuotaError,
  NotFoundError,
  TooManyAssignmentsError,
} from "../colab/client";
import {
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
} from "../colab/headers";
import { TestEventEmitter } from "../test/helpers/events";
import { ServerStorageFake } from "../test/helpers/server-storage";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { isUUID } from "../utils/uuid";
import {
  AssignmentChangeEvent,
  AssignmentManager,
  TEST_ONLY,
} from "./assignments";
import {
  ColabAssignedServer,
  ColabServerDescriptor,
  DEFAULT_CPU_SERVER,
} from "./servers";
import { ServerStorage } from "./storage";

const NOW = new Date();
const TOKEN_EXPIRY_MS = 1000 * 60 * 60;

const defaultAssignmentDescriptor: ColabServerDescriptor = {
  label: "Colab GPU A100",
  variant: Variant.GPU,
  accelerator: "A100",
};

const defaultAssignment: Assignment & { runtimeProxyInfo: RuntimeProxyInfo } = {
  accelerator: "A100",
  endpoint: "m-s-foo",
  idleTimeoutSec: 30,
  subscriptionState: SubscriptionState.UNSUBSCRIBED,
  subscriptionTier: SubscriptionTier.NONE,
  variant: Variant.GPU,
  machineShape: Shape.STANDARD,
  runtimeProxyInfo: {
    token: "mock-token",
    tokenExpiresInSeconds: TOKEN_EXPIRY_MS / 1000,
    url: "https://example.com",
  },
};

describe("AssignmentManager", () => {
  let fakeClock: SinonFakeTimers;
  let vsCodeStub: VsCodeStub;
  let colabClientStub: SinonStubbedInstance<ColabClient>;
  let serverStorage: ServerStorage;
  let assignmentChangeListener: sinon.SinonStub<[AssignmentChangeEvent], void>;
  let defaultServer: ColabAssignedServer;
  let assignmentManager: AssignmentManager;

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
          accelerator: a.accelerator ?? "NONE",
        }),
      ),
    );
    await serverStorage.store(
      assignments.map(
        (a): ColabAssignedServer => ({
          ...defaultServer,
          variant: a.variant,
          accelerator: a.accelerator ?? "NONE",
          label: a.label,
        }),
      ),
    );
  }

  beforeEach(() => {
    fakeClock = sinon.useFakeTimers({ now: NOW, toFake: [] });
    vsCodeStub = newVsCodeStub();
    colabClientStub = sinon.createStubInstance(ColabClient);
    serverStorage = new ServerStorageFake() as ServerStorage;
    defaultServer = {
      ...defaultAssignmentDescriptor,
      id: randomUUID(),
      endpoint: defaultAssignment.endpoint,
      connectionInformation: {
        baseUrl: vsCodeStub.Uri.parse(defaultAssignment.runtimeProxyInfo.url),
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
    assignmentManager = new AssignmentManager(
      vsCodeStub.asVsCode(),
      colabClientStub,
      serverStorage,
    );
    assignmentChangeListener = sinon.stub();
    assignmentManager.onDidAssignmentsChange(assignmentChangeListener);
  });

  afterEach(() => {
    fakeClock.restore();
    sinon.restore();
  });

  describe("getAvailableServerDescriptors", () => {
    it("returns the default CPU and the eligible servers", async () => {
      colabClientStub.getCcuInfo.resolves({
        currentBalance: 1,
        consumptionRateHourly: 2,
        assignmentsCount: 0,
        eligibleGpus: ["T4", "A100"],
        ineligibleGpus: [],
        eligibleTpus: ["V5E1", "V6E1"],
        ineligibleTpus: [],
        freeCcuQuotaInfo: {
          remainingTokens: 4,
          nextRefillTimestampSec: 5,
        },
      });

      const servers = await assignmentManager.getAvailableServerDescriptors();

      expect(servers).to.deep.equal([
        DEFAULT_CPU_SERVER,
        {
          label: "Colab GPU T4",
          variant: Variant.GPU,
          accelerator: "T4",
        },
        {
          label: "Colab GPU A100",
          variant: Variant.GPU,
          accelerator: "A100",
        },
        {
          label: "Colab TPU V5E1",
          variant: Variant.TPU,
          accelerator: "V5E1",
        },
        {
          label: "Colab TPU V6E1",
          variant: Variant.TPU,
          accelerator: "V6E1",
        },
      ]);
    });
  });

  describe("reconcileAssignedServers", () => {
    it("does nothing when there are no stored servers", async () => {
      await assignmentManager.reconcileAssignedServers();

      sinon.assert.notCalled(vsCodeStub.commands.executeCommand);
      sinon.assert.notCalled(assignmentChangeListener);
      sinon.assert.notCalled(vsCodeStub.window.showInformationMessage);
    });

    it("does nothing when no servers need reconciling", async () => {
      await serverStorage.store([defaultServer]);
      colabClientStub.listAssignments.resolves([defaultAssignment]);

      await assignmentManager.reconcileAssignedServers();

      sinon.assert.notCalled(vsCodeStub.commands.executeCommand);
      sinon.assert.notCalled(assignmentChangeListener);
      sinon.assert.notCalled(vsCodeStub.window.showInformationMessage);
    });

    it("reconciles a single assigned server when it is the only one", async () => {
      await serverStorage.store([defaultServer]);
      colabClientStub.listAssignments.resolves([]);

      await assignmentManager.reconcileAssignedServers();

      await expect(assignmentManager.getAssignedServers()).to.eventually.be
        .empty;
      sinon.assert.calledOnceWithExactly(
        vsCodeStub.commands.executeCommand,
        "setContext",
        "colab.hasAssignedServer",
        false,
      );
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

    describe("with multiple servers", () => {
      let servers: [ColabAssignedServer, ColabAssignedServer];
      let assignments: [Assignment, Assignment];

      beforeEach(() => {
        servers = [
          defaultServer,
          {
            ...defaultServer,
            label: "Second Server",
            id: randomUUID(),
            endpoint: "m-s-bar",
            connectionInformation: {
              ...defaultServer.connectionInformation,
              baseUrl: vsCodeStub.Uri.parse("https://example2.com"),
            },
          },
        ];
        assignments = [
          defaultAssignment,
          {
            ...defaultAssignment,
            endpoint: "m-s-bar",
            runtimeProxyInfo: {
              ...defaultAssignment.runtimeProxyInfo,
              url: servers[1].connectionInformation.baseUrl.toString(),
            },
          },
        ];
      });

      it("reconciles a single assigned server when there are others", async () => {
        await serverStorage.store(servers);
        colabClientStub.listAssignments.resolves([assignments[0]]);

        await assignmentManager.reconcileAssignedServers();

        const serversAfter = await assignmentManager.getAssignedServers();
        expect(stripFetches(serversAfter)).to.deep.equal([servers[0]]);
        sinon.assert.calledOnceWithExactly(
          vsCodeStub.commands.executeCommand,
          "setContext",
          "colab.hasAssignedServer",
          true,
        );
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

      it("reconciles multiple assigned servers when all need reconciling", async () => {
        const threeServers = [
          ...servers,
          { ...defaultServer, label: "Third Server" },
        ];
        await serverStorage.store(threeServers);
        colabClientStub.listAssignments.resolves([]);

        await assignmentManager.reconcileAssignedServers();

        await expect(assignmentManager.getAssignedServers()).to.eventually.be
          .empty;
        sinon.assert.calledOnceWithExactly(
          vsCodeStub.commands.executeCommand,
          "setContext",
          "colab.hasAssignedServer",
          false,
        );
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

      it("reconciles multiple assigned servers when some need reconciling", async () => {
        const thirdServer: ColabAssignedServer = {
          ...defaultServer,
          label: "Third Server",
          id: randomUUID(),
          endpoint: "m-s-baz",
          connectionInformation: {
            ...defaultServer.connectionInformation,
            baseUrl: vsCodeStub.Uri.parse("https://example3.com"),
          },
        };
        const twoServers = servers;
        const threeServers = [...twoServers, thirdServer];
        await serverStorage.store(threeServers);
        colabClientStub.listAssignments.resolves(assignments);

        await assignmentManager.reconcileAssignedServers();

        const serversAfter = await assignmentManager.getAssignedServers();
        expect(stripFetches(serversAfter)).to.deep.equal([
          servers[0],
          servers[1],
        ]);
        sinon.assert.calledOnceWithExactly(
          vsCodeStub.commands.executeCommand,
          "setContext",
          "colab.hasAssignedServer",
          true,
        );
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

      it("reconciles ignoring assignments originating out of VS Code", async () => {
        await serverStorage.store(servers);
        const colabAssignment: Assignment = {
          ...defaultAssignment,
          endpoint: "m-s-baz",
          runtimeProxyInfo: {
            ...defaultAssignment.runtimeProxyInfo,
            url: "https://not-from-vs-code.com",
          },
        };
        colabClientStub.listAssignments.resolves([colabAssignment]);

        await assignmentManager.reconcileAssignedServers();

        await expect(assignmentManager.getAssignedServers()).to.eventually.be
          .empty;
        sinon.assert.calledOnceWithExactly(
          vsCodeStub.commands.executeCommand,
          "setContext",
          "colab.hasAssignedServer",
          false,
        );
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

  describe("hasAssignedServers", () => {
    it("returns false when no servers are assigned", async () => {
      colabClientStub.listAssignments.resolves([]);

      await expect(assignmentManager.hasAssignedServer()).to.eventually.be
        .false;
    });

    it("returns true when at least one server is assigned", async () => {
      colabClientStub.listAssignments.resolves([defaultAssignment]);
      await serverStorage.store([defaultServer]);
      await setupAssignments([defaultAssignmentDescriptor]);

      await expect(assignmentManager.hasAssignedServer()).to.eventually.be.true;
    });

    it("returns true when multiple servers are assigned", async () => {
      const secondEndpoint = "m-s-foo";
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

  describe("getAssignedServers", () => {
    it("returns an empty list when no servers are assigned", async () => {
      const servers = await assignmentManager.getAssignedServers();

      expect(servers).to.deep.equal([]);
    });

    describe("when a server is assigned", () => {
      beforeEach(async () => {
        colabClientStub.listAssignments.resolves([defaultAssignment]);
        await serverStorage.store([defaultServer]);
      });

      it("returns the assigned server when there is one", async () => {
        const servers = await assignmentManager.getAssignedServers();

        expect(stripFetches(servers)).to.deep.equal([defaultServer]);
      });

      it("returns multiple assigned servers when there are some", async () => {
        const storedServers = [
          { ...defaultServer, id: randomUUID() },
          { ...defaultServer, id: randomUUID() },
        ];
        await serverStorage.store(storedServers);

        const servers = await assignmentManager.getAssignedServers();

        expect(stripFetches(servers)).to.deep.equal(storedServers);
      });

      it("includes a fetch implementation that attaches Colab connection info", async () => {
        const servers = await assignmentManager.getAssignedServers();
        assert.lengthOf(servers, 1);
        const server = servers[0];
        assert.isDefined(server.connectionInformation.fetch);
        const fetchStub = sinon.stub(fetch, "default");

        await server.connectionInformation.fetch("https://example.com");

        sinon.assert.calledOnceWithMatch(fetchStub, "https://example.com", {
          headers: new Headers({
            [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]:
              server.connectionInformation.token,
            [COLAB_CLIENT_AGENT_HEADER.key]: COLAB_CLIENT_AGENT_HEADER.value,
          }),
        });
      });
    });
  });

  describe("getRemoteServers", () => {
    const endpointWithName = "test-endpoint-with-name";
    const endpointWithoutName = "test-endpoint-without-name";
    const endpointWithoutSession = "test-endpoint-without-session";
    const allAssignments = [
      {
        endpoint: endpointWithName,
        variant: Variant.DEFAULT,
        machineShape: Shape.STANDARD,
        accelerator: "",
      },
      {
        endpoint: endpointWithoutName,
        variant: Variant.DEFAULT,
        machineShape: Shape.STANDARD,
        accelerator: "",
      },
      {
        endpoint: endpointWithoutSession,
        variant: Variant.DEFAULT,
        machineShape: Shape.STANDARD,
        accelerator: "",
      },
    ];
    const defaultSession = {
      id: "",
      path: "",
      type: "",
      kernel: {
        lastActivity: "",
        executionState: "",
        id: "",
        name: "",
        connections: 1,
      },
    };

    beforeEach(() => {
      colabClientStub.listAssignments.resolves(allAssignments);
      colabClientStub.listSessions.withArgs(endpointWithName).resolves([
        {
          ...defaultSession,
          name: "test-session-name",
        },
      ]);
      colabClientStub.listSessions.withArgs(endpointWithoutName).resolves([
        {
          ...defaultSession,
          name: "",
        },
      ]);
      colabClientStub.listSessions
        .withArgs(endpointWithoutSession)
        .resolves([]);
    });

    it("returns all assignments when no server is assigned in VS Code", async () => {
      const results = await assignmentManager.getRemoteServers();

      expect(results).to.deep.equal([
        {
          label: "test-session-name",
          endpoint: endpointWithName,
          variant: Variant.DEFAULT,
          accelerator: "",
        },
        {
          label: TEST_ONLY.UNKNOWN_REMOTE_SERVER_NAME,
          endpoint: endpointWithoutName,
          variant: Variant.DEFAULT,
          accelerator: "",
        },
        {
          label: TEST_ONLY.UNKNOWN_REMOTE_SERVER_NAME,
          endpoint: endpointWithoutSession,
          variant: Variant.DEFAULT,
          accelerator: "",
        },
      ]);
    });

    it("returns only remote assignments assigned outside VS Code", async () => {
      await serverStorage.store([
        {
          ...defaultServer,
          endpoint: endpointWithoutName,
        },
        {
          ...defaultServer,
          endpoint: endpointWithoutSession,
        },
      ]);

      const results = await assignmentManager.getRemoteServers();

      expect(results).to.deep.equal([
        {
          label: "test-session-name",
          endpoint: endpointWithName,
          variant: Variant.DEFAULT,
          accelerator: "",
        },
      ]);
    });
  });

  describe("getLastKnownAssignedServers", () => {
    it("returns an empty list when there are no stored servers", async () => {
      expect(
        await assignmentManager.getLastKnownAssignedServers(),
      ).to.deep.equal([]);
    });

    it("returns all stored servers with connection info omitted", async () => {
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

  describe("assignServer", () => {
    it("throws an error when the assignment does not include a URL to connect to", () => {
      colabClientStub.assign
        .withArgs(
          sinon.match(isUUID),
          defaultAssignment.variant,
          defaultAssignment.accelerator,
        )
        .resolves({
          assignment: {
            ...defaultAssignment,
            runtimeProxyInfo: {
              ...defaultAssignment.runtimeProxyInfo,
              url: "",
            },
          },
          isNew: false,
        });

      expect(
        assignmentManager.assignServer(defaultAssignmentDescriptor),
      ).to.be.rejectedWith(/connection info/);
    });

    it("throws an error when the assignment does not include a token to connect with", () => {
      colabClientStub.assign
        .withArgs(
          sinon.match(isUUID),
          defaultAssignment.variant,
          defaultAssignment.accelerator,
        )
        .resolves({
          assignment: {
            ...defaultAssignment,
            runtimeProxyInfo: {
              ...defaultAssignment.runtimeProxyInfo,
              token: "",
            },
          },
          isNew: false,
        });

      expect(
        assignmentManager.assignServer(defaultAssignmentDescriptor),
      ).to.be.rejectedWith(/connection info/);
    });

    describe("when a server is assigned", () => {
      let assignedServer: ColabAssignedServer;

      beforeEach(async () => {
        colabClientStub.assign
          .withArgs(
            sinon.match(isUUID),
            defaultServer.variant,
            defaultServer.accelerator,
          )
          .resolves({ assignment: defaultAssignment, isNew: false });
        colabClientStub.listAssignments.resolves([defaultAssignment]);
        await serverStorage.store([defaultServer]);

        assignedServer = await assignmentManager.assignServer(
          defaultAssignmentDescriptor,
        );
      });

      it("stores and returns the server", () => {
        const { id: assignedId, ...got } = stripFetch(assignedServer);
        const { id: defaultId, ...want } = defaultServer;
        expect(got).to.deep.equal(want);
        expect(assignedId).to.satisfy(isUUID);
      });

      it("sets the hasAssignedServer context to true", () => {
        sinon.assert.calledOnceWithExactly(
          vsCodeStub.commands.executeCommand,
          "setContext",
          "colab.hasAssignedServer",
          true,
        );
      });

      it("emits an assignment change event", () => {
        const { id: defaultId, ...want } = defaultServer;
        sinon.assert.calledOnceWithMatch(assignmentChangeListener, {
          added: [sinon.match(want)],
          removed: [],
          changed: [],
        });
      });

      it("includes a fetch implementation that attaches Colab connection info", async () => {
        assert.isDefined(assignedServer.connectionInformation.fetch);
        const fetchStub = sinon.stub(fetch, "default");

        await assignedServer.connectionInformation.fetch("https://example.com");

        sinon.assert.calledOnceWithMatch(fetchStub, "https://example.com", {
          headers: new Headers({
            [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]:
              assignedServer.connectionInformation.token,
            [COLAB_CLIENT_AGENT_HEADER.key]: COLAB_CLIENT_AGENT_HEADER.value,
          }),
        });
      });
    });

    describe("with too many assigned servers", () => {
      beforeEach(() => {
        colabClientStub.assign.rejects(new TooManyAssignmentsError());
      });

      it("notifies the user", async () => {
        await expect(
          assignmentManager.assignServer(defaultAssignmentDescriptor),
        ).to.eventually.be.rejectedWith(TooManyAssignmentsError);

        sinon.assert.calledOnceWithMatch(
          vsCodeStub.window.showErrorMessage as sinon.SinonStub,
          /too many/,
        );
      });

      it("presents an action to remove servers from VS Code when theres at least 1 VS Code assignment", async () => {
        sinon.stub(assignmentManager, "hasAssignedServer").resolves(true);
        (vsCodeStub.window.showErrorMessage as sinon.SinonStub).resolves(
          "Remove Server",
        );

        await expect(
          assignmentManager.assignServer(defaultAssignmentDescriptor),
        ).to.eventually.be.rejectedWith(TooManyAssignmentsError);

        sinon.assert.calledOnceWithExactly(
          vsCodeStub.commands.executeCommand,
          "colab.removeServer",
        );
      });

      it("presents an action to remove servers from Colab when there are 0 VS Code assignments", async () => {
        sinon.stub(assignmentManager, "hasAssignedServer").resolves(false);
        (vsCodeStub.window.showErrorMessage as sinon.SinonStub).resolves(
          "Remove Server at Colab Web",
        );

        await expect(
          assignmentManager.assignServer(defaultAssignmentDescriptor),
        ).to.eventually.be.rejectedWith(TooManyAssignmentsError);

        sinon.assert.calledOnceWithMatch(
          vsCodeStub.env.openExternal,
          sinon.match(function (url: Uri) {
            return url.toString() === "https://colab.research.google.com/";
          }),
        );
      });
    });

    describe("with insufficient quota", () => {
      beforeEach(() => {
        colabClientStub.assign.rejects(new InsufficientQuotaError("💰🐖"));
      });

      it("notifies the user", async () => {
        await expect(
          assignmentManager.assignServer(defaultAssignmentDescriptor),
        ).to.eventually.be.rejectedWith(InsufficientQuotaError);

        sinon.assert.calledOnceWithMatch(
          vsCodeStub.window.showErrorMessage as sinon.SinonStub,
          /Unable to assign .* 💰🐖/,
        );
      });

      it("presents an action to learn more", async () => {
        sinon.stub(assignmentManager, "hasAssignedServer").resolves(false);
        (vsCodeStub.window.showErrorMessage as sinon.SinonStub).resolves(
          "Learn More",
        );

        await expect(
          assignmentManager.assignServer(defaultAssignmentDescriptor),
        ).to.eventually.be.rejectedWith(InsufficientQuotaError);

        sinon.assert.calledOnceWithMatch(
          vsCodeStub.env.openExternal,
          sinon.match(function (url: Uri) {
            return (
              url.toString() ===
              "https://research.google.com/colaboratory/faq.html#resource-limits"
            );
          }),
        );
      });
    });

    describe("when the user is banned", () => {
      beforeEach(() => {
        colabClientStub.assign.rejects(new DenylistedError("👨‍⚖️"));
      });

      it("notifies the user", async () => {
        await expect(
          assignmentManager.assignServer(defaultAssignmentDescriptor),
        ).to.eventually.be.rejectedWith(DenylistedError);

        sinon.assert.calledOnceWithMatch(
          vsCodeStub.window.showErrorMessage as sinon.SinonStub,
          /Unable to assign .* 👨‍⚖️/,
        );
      });
    });
  });

  describe("unassignServer", () => {
    it("does nothing when the server does not exist", async () => {
      await assignmentManager.unassignServer(defaultServer);

      sinon.assert.notCalled(colabClientStub.unassign);
      sinon.assert.notCalled(vsCodeStub.commands.executeCommand);
      sinon.assert.notCalled(assignmentChangeListener);
    });

    describe("when the server exists", () => {
      beforeEach(async () => {
        await serverStorage.store([defaultServer]);
      });

      it("deletes sessions", async () => {
        const session1 = {
          id: "mock-session-id-1",
          kernel: {
            id: "mock-kernel-id",
            name: "mock-kernel-name",
            lastActivity: new Date().toISOString(),
            executionState: "idle",
            connections: 1,
          },
          name: "mock-session-name",
          path: "mock-path",
          type: "notebook",
        };
        const session2 = {
          ...session1,
          id: "mock-session-id-2",
        };
        colabClientStub.listSessions
          .withArgs(defaultServer)
          .resolves([session1, session2]);

        await assignmentManager.unassignServer(defaultServer);

        sinon.assert.calledTwice(colabClientStub.deleteSession);
        sinon.assert.calledWith(
          colabClientStub.deleteSession,
          defaultServer,
          session1.id,
        );
        sinon.assert.calledWith(
          colabClientStub.deleteSession,
          defaultServer,
          session2.id,
        );
      });

      it("does not delete sessions when there are none", async () => {
        colabClientStub.listSessions.resolves([]);

        await assignmentManager.unassignServer(defaultServer);

        sinon.assert.notCalled(colabClientStub.deleteSession);
      });

      it("unassigns the server", async () => {
        colabClientStub.listSessions.resolves([]);

        await assignmentManager.unassignServer(defaultServer);

        const serversAfter = await assignmentManager.getAssignedServers();
        expect(serversAfter).to.be.empty;
        sinon.assert.calledOnceWithMatch(
          colabClientStub.unassign,
          defaultServer.endpoint,
        );
        sinon.assert.calledOnceWithExactly(
          vsCodeStub.commands.executeCommand,
          "setContext",
          "colab.hasAssignedServer",
          false,
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
    });
  });

  describe("latestOrAutoAssignServer", () => {
    it("assigns a new default server when none have been assigned", async () => {
      colabClientStub.listAssignments.resolves([]);
      const defaultCpuAssignment = {
        ...defaultAssignment,
        variant: Variant.DEFAULT,
        accelerator: "NONE",
      };
      const defaultCpuServer = {
        ...defaultServer,
        variant: Variant.DEFAULT,
        accelerator: "NONE",
        label: "Colab CPU",
      };
      colabClientStub.assign
        .withArgs(sinon.match(isUUID), Variant.DEFAULT)
        .resolves({ assignment: defaultCpuAssignment, isNew: true });

      const server = await assignmentManager.latestOrAutoAssignServer();

      const { id: _g, ...got } = stripFetch(server);
      const { id: _w, ...want } = defaultCpuServer;
      expect(got).to.deep.equal(want);
    });

    it("reconciles servers before resolving", async () => {
      const deadServer = defaultServer;
      const olderActiveServer: ColabAssignedServer = {
        ...defaultServer,
        id: randomUUID(),
        endpoint: "m-s-bar",
        label: "Older server",
        dateAssigned: new Date(NOW.getTime() - 10000),
      };
      const olderActiveAssignment: Assignment = {
        ...defaultAssignment,
        endpoint: olderActiveServer.endpoint,
      };
      colabClientStub.listAssignments.resolves([olderActiveAssignment]);
      await serverStorage.store([deadServer, olderActiveServer]);

      const server = await assignmentManager.latestOrAutoAssignServer();

      expect(stripFetch(server)).to.deep.equal(olderActiveServer);
    });
  });

  describe("latestServer", () => {
    it("returns undefined when none have been assigned", async () => {
      colabClientStub.listAssignments.resolves([]);

      const server = await assignmentManager.latestServer();
      expect(server).to.equal(undefined);
    });

    it("reconciles servers before resolving", async () => {
      const deadServer = defaultServer;
      const olderActiveServer: ColabAssignedServer = {
        ...defaultServer,
        id: randomUUID(),
        endpoint: "m-s-bar",
        label: "Older server",
        dateAssigned: new Date(NOW.getTime() - 10000),
      };
      const olderActiveAssignment: Assignment = {
        ...defaultAssignment,
        endpoint: olderActiveServer.endpoint,
      };
      colabClientStub.listAssignments.resolves([olderActiveAssignment]);
      await serverStorage.store([deadServer, olderActiveServer]);

      const server = await assignmentManager.latestServer();

      expect(server ? stripFetch(server) : null).to.deep.equal(
        olderActiveServer,
      );
    });
  });

  describe("refreshConnection", () => {
    it("throws a not found error when refreshing a server that's not tracked", async () => {
      await expect(
        assignmentManager.refreshConnection(defaultServer.id),
      ).to.eventually.be.rejectedWith(NotFoundError);
    });

    describe("with a refreshed connection", () => {
      const newToken = "new-token";
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

      it("stores and returns the server with updated connection info", () => {
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
        expect(stripFetch(refreshedServer)).to.deep.equal(expectedServer);
      });

      it("includes a fetch implementation that attaches Colab connection info", async () => {
        assert.isDefined(refreshedServer.connectionInformation.fetch);
        const fetchStub = sinon.stub(fetch, "default");

        await refreshedServer.connectionInformation.fetch(
          "https://example.com",
        );

        sinon.assert.calledOnceWithMatch(fetchStub, "https://example.com", {
          headers: new Headers({
            [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]:
              refreshedServer.connectionInformation.token,
            [COLAB_CLIENT_AGENT_HEADER.key]: COLAB_CLIENT_AGENT_HEADER.value,
          }),
        });
      });

      it("emits an assignment change event", () => {
        sinon.assert.calledOnceWithExactly(assignmentChangeListener, {
          added: [],
          removed: [],
          changed: [refreshedServer],
        });
      });
    });
  });

  describe("getDefaultLabel", () => {
    it("returns a simple variant-accelerator pair when there are no assigned servers", async () => {
      await expect(
        assignmentManager.getDefaultLabel(Variant.GPU, "A100"),
      ).to.eventually.equal("Colab GPU A100");
    });

    it("returns a simple variant-accelerator pair when there are only custom aliased servers", async () => {
      const variant = Variant.GPU;
      const accelerator = "A100";
      await setupAssignments([{ variant, accelerator, label: "foo" }]);

      await expect(
        assignmentManager.getDefaultLabel(variant, accelerator),
      ).to.eventually.equal("Colab GPU A100");
    });

    it("returns the next sequential label with one matching assigned server", async () => {
      const variant = Variant.GPU;
      const accelerator = "A100";
      await setupAssignments([
        { variant, accelerator, label: "Colab GPU A100" },
      ]);

      await expect(
        assignmentManager.getDefaultLabel(variant, accelerator),
      ).to.eventually.equal("Colab GPU A100 (1)");
    });

    it("returns the next sequential label with multiple assigned servers", async () => {
      const variant = Variant.GPU;
      const accelerator = "A100";
      await setupAssignments([
        { variant, accelerator, label: "Colab GPU A100" },
        { variant, accelerator, label: "Colab GPU A100 (1)" },
      ]);

      await expect(
        assignmentManager.getDefaultLabel(variant, accelerator),
      ).to.eventually.equal("Colab GPU A100 (2)");
    });

    it("only increments from matching variant-accelerator server pairs", async () => {
      await setupAssignments([
        { variant: Variant.DEFAULT, label: "Colab CPU" },
        {
          variant: Variant.GPU,
          accelerator: "A100",
          label: "Colab GPU A100",
        },
      ]);

      await expect(
        assignmentManager.getDefaultLabel(Variant.GPU, "A100"),
      ).to.eventually.equal("Colab GPU A100 (1)");
    });

    // To ensure a string sort isn't used, which would put "10" before "2".
    it("uses the next sequential label with many assigned servers", async () => {
      const variant = Variant.GPU;
      const accelerator = "A100";
      await setupAssignments(
        Array.from({ length: 10 }, (_, i) => i + 1)
          .map((i) => ({
            variant,
            accelerator,
            label: `Colab GPU A100 (${i.toString()})`,
          }))
          .concat({ variant, accelerator, label: "Colab GPU A100" }),
      );

      await expect(
        assignmentManager.getDefaultLabel(variant, accelerator),
      ).to.eventually.equal("Colab GPU A100 (11)");
    });

    it("uses the simple variant-accelerator label when the initial assignment is missing", async () => {
      const variant = Variant.GPU;
      const accelerator = "A100";
      await setupAssignments([
        { variant, accelerator, label: "Colab GPU A100 (2)" },
      ]);

      await expect(
        assignmentManager.getDefaultLabel(variant, accelerator),
      ).to.eventually.equal("Colab GPU A100");
    });

    it("uses the next sequential label when there's an assigned server gap", async () => {
      const variant = Variant.GPU;
      const accelerator = "A100";
      await setupAssignments([
        { variant, accelerator, label: "Colab GPU A100 (2)" },
        { variant, accelerator, label: "Colab GPU A100" },
      ]);

      await expect(
        assignmentManager.getDefaultLabel(variant, accelerator),
      ).to.eventually.equal("Colab GPU A100 (1)");
    });

    it("reconciles servers before determining label", async () => {
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

  describe("when the notification to reload notebooks is shown", () => {
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
            server: { ...defaultServer, label: "server A" },
            userInitiated: false,
          },
        ],
        changed: [],
      });
    });

    it("opens the Jupyter Github issue when the notification is clicked", async () => {
      showInfoMessageResolver({
        title: "View Issue",
      });

      await expect(showInfoMessage).to.eventually.be.fulfilled;
      sinon.assert.calledWithMatch(
        vsCodeStub.env.openExternal,
        vsCodeStub.Uri.parse(
          "https://github.com/microsoft/vscode-jupyter/issues/17094",
        ),
      );
    });

    it("does not open the Jupyter Github issue when the notification is dismissed", async () => {
      showInfoMessageResolver(undefined);

      await expect(showInfoMessage).to.eventually.be.fulfilled;
      sinon.assert.notCalled(vsCodeStub.env.openExternal);
    });
  });
});

function stripFetch(server: ColabAssignedServer): ColabAssignedServer {
  const { fetch: _, ...c } = server.connectionInformation;
  return {
    ...server,
    connectionInformation: c,
  };
}

function stripFetches(servers: ColabAssignedServer[]): ColabAssignedServer[] {
  return servers.map(stripFetch);
}
