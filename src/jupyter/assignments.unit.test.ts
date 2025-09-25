/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "crypto";
import { assert, expect } from "chai";
import fetch, { Headers } from "node-fetch";
import sinon, { SinonStubbedInstance } from "sinon";
import { Uri } from "vscode";
import {
  Accelerator,
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
  TooManyAssignmentsError,
} from "../colab/client";
import {
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
} from "../colab/headers";
import { ServerStorageFake } from "../test/helpers/server-storage";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { isUUID } from "../utils/uuid";
import { AssignmentChangeEvent, AssignmentManager } from "./assignments";
import {
  COLAB_SERVERS,
  ColabAssignedServer,
  ColabServerDescriptor,
} from "./servers";
import { ServerStorage } from "./storage";

const defaultAssignmentDescriptor: ColabServerDescriptor = {
  label: "Colab GPU A100",
  variant: Variant.GPU,
  accelerator: Accelerator.A100,
};

const defaultAssignment: Assignment & { runtimeProxyInfo: RuntimeProxyInfo } = {
  accelerator: Accelerator.A100,
  endpoint: "m-s-foo",
  idleTimeoutSec: 30,
  subscriptionState: SubscriptionState.UNSUBSCRIBED,
  subscriptionTier: SubscriptionTier.NONE,
  variant: Variant.GPU,
  machineShape: Shape.STANDARD,
  runtimeProxyInfo: {
    token: "mock-token",
    tokenExpiresInSeconds: 42,
    url: "https://example.com",
  },
};

describe("AssignmentManager", () => {
  let vsCodeStub: VsCodeStub;
  let colabClientStub: SinonStubbedInstance<ColabClient>;
  let serverStorage: ServerStorage;
  let assignmentChangeListener: sinon.SinonStub<[AssignmentChangeEvent], void>;
  let defaultServer: ColabAssignedServer;
  let assignmentManager: AssignmentManager;

  beforeEach(() => {
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
        headers: {
          [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]:
            defaultAssignment.runtimeProxyInfo.token,
          [COLAB_CLIENT_AGENT_HEADER.key]: COLAB_CLIENT_AGENT_HEADER.value,
        },
      },
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
    sinon.restore();
  });

  describe("getAvailableServerDescriptors", () => {
    it("returns all servers when all are eligible", async () => {
      colabClientStub.getCcuInfo.resolves({
        currentBalance: 1,
        consumptionRateHourly: 2,
        assignmentsCount: 0,
        eligibleGpus: [Accelerator.T4, Accelerator.A100, Accelerator.L4],
        ineligibleGpus: [],
        eligibleTpus: [Accelerator.V5E1, Accelerator.V6E1, Accelerator.V28],
        ineligibleTpus: [],
        freeCcuQuotaInfo: {
          remainingTokens: 4,
          nextRefillTimestampSec: 5,
        },
      });

      const servers = await assignmentManager.getAvailableServerDescriptors();

      expect(servers).to.deep.equal(Array.from(COLAB_SERVERS));
    });

    it("filters to only eligible servers", async () => {
      colabClientStub.getCcuInfo.resolves({
        currentBalance: 1,
        consumptionRateHourly: 2,
        assignmentsCount: 0,
        eligibleGpus: [Accelerator.T4, Accelerator.A100],
        ineligibleGpus: [],
        eligibleTpus: [Accelerator.V6E1, Accelerator.V28],
        ineligibleTpus: [],
        freeCcuQuotaInfo: {
          remainingTokens: 4,
          nextRefillTimestampSec: 5,
        },
      });

      const servers = await assignmentManager.getAvailableServerDescriptors();

      const expectedServers = Array.from(COLAB_SERVERS).filter(
        (server) =>
          server.accelerator !== Accelerator.L4 &&
          server.accelerator !== Accelerator.V5E1,
      );
      expect(servers).to.deep.equal(expectedServers);
    });

    it("filters out ineligible servers", async () => {
      colabClientStub.getCcuInfo.resolves({
        currentBalance: 1,
        consumptionRateHourly: 2,
        assignmentsCount: 0,
        eligibleGpus: [Accelerator.T4, Accelerator.A100],
        ineligibleGpus: [Accelerator.L4],
        eligibleTpus: [Accelerator.V6E1, Accelerator.V28],
        ineligibleTpus: [Accelerator.V5E1],
        freeCcuQuotaInfo: {
          remainingTokens: 4,
          nextRefillTimestampSec: 5,
        },
      });

      const servers = await assignmentManager.getAvailableServerDescriptors();

      const expectedServers = Array.from(COLAB_SERVERS).filter(
        (server) =>
          server.accelerator !== Accelerator.L4 &&
          server.accelerator !== Accelerator.V5E1,
      );
      expect(servers).to.deep.equal(expectedServers);
    });
  });

  describe("reconcileAssignedServers", () => {
    it("does nothing when there are no stored servers", async () => {
      await assignmentManager.reconcileAssignedServers();

      sinon.assert.notCalled(vsCodeStub.commands.executeCommand);
      sinon.assert.notCalled(assignmentChangeListener);
    });

    it("does nothing when no servers need reconciling", async () => {
      await serverStorage.store([defaultServer]);
      colabClientStub.listAssignments.resolves([defaultAssignment]);

      await assignmentManager.reconcileAssignedServers();

      sinon.assert.notCalled(vsCodeStub.commands.executeCommand);
      sinon.assert.notCalled(assignmentChangeListener);
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
    });

    describe("with multiple servers", () => {
      let servers: [ColabAssignedServer, ColabAssignedServer];
      let assignments: [Assignment, Assignment];

      beforeEach(() => {
        servers = [
          defaultServer,
          {
            ...defaultServer,
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
      });

      it("reconciles multiple assigned servers when all need reconciling", async () => {
        await serverStorage.store(servers);
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
          removed: servers.map((s) => ({ server: s, userInitiated: false })),
          changed: [],
        });
      });

      it("reconciles multiple assigned servers when some need reconciling", async () => {
        const thirdServer: ColabAssignedServer = {
          ...defaultServer,
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
      });
    });
  });

  describe("hasAssignedServers", () => {
    it("returns false when no servers are assigned", async () => {
      await expect(assignmentManager.hasAssignedServer()).to.eventually.be
        .false;
    });

    it("returns true when at least one server is assigned", async () => {
      await serverStorage.store([defaultServer]);

      await expect(assignmentManager.hasAssignedServer()).to.eventually.be.true;
    });

    it("returns true when multiple servers are assigned", async () => {
      await serverStorage.store([
        { ...defaultServer, id: randomUUID() },
        { ...defaultServer, id: randomUUID() },
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
        assignmentManager.assignServer(
          randomUUID(),
          defaultAssignmentDescriptor,
        ),
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
        assignmentManager.assignServer(
          randomUUID(),
          defaultAssignmentDescriptor,
        ),
      ).to.be.rejectedWith(/connection info/);
    });

    describe("when a server is assigned", () => {
      let assignedServer: ColabAssignedServer;

      beforeEach(async () => {
        colabClientStub.assign
          .withArgs(
            defaultServer.id,
            defaultServer.variant,
            defaultServer.accelerator,
          )
          .resolves({ assignment: defaultAssignment, isNew: false });
        await serverStorage.store([defaultServer]);

        assignedServer = await assignmentManager.assignServer(
          defaultServer.id,
          defaultAssignmentDescriptor,
        );
      });

      it("stores and returns the server", () => {
        expect(stripFetch(assignedServer)).to.deep.equal(defaultServer);
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
        sinon.assert.calledOnceWithMatch(assignmentChangeListener, {
          added: [],
          removed: [],
          changed: [sinon.match(defaultServer)],
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
          assignmentManager.assignServer(
            defaultServer.id,
            defaultAssignmentDescriptor,
          ),
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
          assignmentManager.assignServer(
            defaultServer.id,
            defaultAssignmentDescriptor,
          ),
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
          assignmentManager.assignServer(
            defaultServer.id,
            defaultAssignmentDescriptor,
          ),
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
          assignmentManager.assignServer(
            defaultServer.id,
            defaultAssignmentDescriptor,
          ),
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
          assignmentManager.assignServer(
            defaultServer.id,
            defaultAssignmentDescriptor,
          ),
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
          assignmentManager.assignServer(
            defaultServer.id,
            defaultAssignmentDescriptor,
          ),
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
        sinon.assert.calledOnceWithExactly(
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
      });
    });
  });

  describe("refreshConnection", () => {
    const newToken = "new-token";
    let refreshedServer: ColabAssignedServer;

    beforeEach(async () => {
      colabClientStub.assign
        .withArgs(
          defaultServer.id,
          defaultServer.variant,
          defaultServer.accelerator,
        )
        .resolves({
          assignment: {
            ...defaultAssignment,
            runtimeProxyInfo: {
              ...defaultAssignment.runtimeProxyInfo,
              token: newToken,
            },
          },
          isNew: false,
        });
      await serverStorage.store([defaultServer]);

      refreshedServer =
        await assignmentManager.refreshConnection(defaultServer);
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

      await refreshedServer.connectionInformation.fetch("https://example.com");

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

function stripFetch(server: ColabAssignedServer): ColabAssignedServer {
  return {
    ...server,
    connectionInformation: {
      baseUrl: server.connectionInformation.baseUrl,
      token: server.connectionInformation.token,
      headers: server.connectionInformation.headers,
    },
  };
}

function stripFetches(servers: ColabAssignedServer[]): ColabAssignedServer[] {
  return servers.map(stripFetch);
}
