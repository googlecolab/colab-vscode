import { randomUUID } from "crypto";
import { assert, expect } from "chai";
import fetch, { Headers } from "node-fetch";
import sinon, { SinonStubbedInstance } from "sinon";
import {
  Accelerator,
  Assignment,
  RuntimeProxyInfo,
  Shape,
  SubscriptionState,
  SubscriptionTier,
  Variant,
} from "../colab/api";
import { ColabClient } from "../colab/client";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { isUUID } from "../utils/uuid";
import { AssignmentManager } from "./assignments";
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
  sub: SubscriptionState.UNSUBSCRIBED,
  subTier: SubscriptionTier.UNKNOWN_TIER,
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
  let storageStub: SinonStubbedInstance<ServerStorage>;
  let defaultServer: ColabAssignedServer;
  let assignmentManager: AssignmentManager;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    colabClientStub = sinon.createStubInstance(ColabClient);
    storageStub = sinon.createStubInstance(ServerStorage);
    defaultServer = {
      ...defaultAssignmentDescriptor,
      id: randomUUID(),
      endpoint: defaultAssignment.endpoint,
      connectionInformation: {
        baseUrl: vsCodeStub.Uri.parse(defaultAssignment.runtimeProxyInfo.url),
        token: defaultAssignment.runtimeProxyInfo.token,
        headers: {
          "X-Colab-Runtime-Proxy-Token":
            defaultAssignment.runtimeProxyInfo.token,
          "X-Colab-Client-Agent": "vscode",
        },
      },
    };
    assignmentManager = new AssignmentManager(
      vsCodeStub.asVsCode(),
      colabClientStub,
      storageStub,
    );
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("getAvailableServerDescriptors", () => {
    it("returns all colab servers when all are eligible", async () => {
      colabClientStub.ccuInfo.resolves({
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
      sinon.assert.calledOnce(colabClientStub.ccuInfo);
    });

    it("filters to only eligible servers", async () => {
      colabClientStub.ccuInfo.resolves({
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
      sinon.assert.calledOnce(colabClientStub.ccuInfo);
    });

    it("filters out ineligible servers", async () => {
      colabClientStub.ccuInfo.resolves({
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
      sinon.assert.calledOnce(colabClientStub.ccuInfo);
    });
  });

  describe("reconcileAssignedServers", () => {
    it("does nothing when there are no stored servers", async () => {
      storageStub.list.resolves([]);

      await assignmentManager.reconcileAssignedServers();

      sinon.assert.notCalled(colabClientStub.listAssignments);
      sinon.assert.notCalled(storageStub.clear);
      sinon.assert.notCalled(storageStub.store);
    });

    it("does nothing when no servers need reconciling", async () => {
      storageStub.list.resolves([defaultServer]);
      colabClientStub.listAssignments.resolves([defaultAssignment]);

      await assignmentManager.reconcileAssignedServers();

      sinon.assert.calledOnce(colabClientStub.listAssignments);
      sinon.assert.notCalled(storageStub.clear);
      sinon.assert.notCalled(storageStub.store);
    });

    it("reconciles a single assigned server when it is the only one", async () => {
      storageStub.list.resolves([defaultServer]);
      colabClientStub.listAssignments.resolves([]);

      await assignmentManager.reconcileAssignedServers();

      sinon.assert.calledOnce(colabClientStub.listAssignments);
      sinon.assert.calledOnce(storageStub.clear);
      sinon.assert.calledOnceWithExactly(storageStub.store, []);
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
        storageStub.list.resolves(servers);
        colabClientStub.listAssignments.resolves([assignments[0]]);

        await assignmentManager.reconcileAssignedServers();

        sinon.assert.calledOnce(colabClientStub.listAssignments);
        sinon.assert.calledOnce(storageStub.clear);
        sinon.assert.calledOnceWithExactly(storageStub.store, [servers[0]]);
      });

      it("reconciles multiple assigned servers when all need reconciling", async () => {
        storageStub.list.resolves(servers);
        colabClientStub.listAssignments.resolves([]);

        await assignmentManager.reconcileAssignedServers();

        sinon.assert.calledOnce(colabClientStub.listAssignments);
        sinon.assert.calledOnce(storageStub.clear);
        sinon.assert.calledOnceWithExactly(storageStub.store, []);
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
        storageStub.list.resolves(threeServers);
        colabClientStub.listAssignments.resolves(assignments);

        await assignmentManager.reconcileAssignedServers();

        sinon.assert.calledOnce(colabClientStub.listAssignments);
        sinon.assert.calledOnce(storageStub.clear);
        sinon.assert.calledOnceWithExactly(storageStub.store, twoServers);
      });

      it("reconciles ignoring assignments originating out of VS Code", async () => {
        storageStub.list.resolves(servers);
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

        sinon.assert.calledOnce(colabClientStub.listAssignments);
        sinon.assert.calledOnce(storageStub.clear);
        sinon.assert.calledOnceWithExactly(storageStub.store, []);
      });
    });
  });

  describe("getAssignedServers", () => {
    it("returns an empty list when no servers are assigned", async () => {
      storageStub.list.resolves([]);

      const servers = await assignmentManager.getAssignedServers();

      expect(servers).to.deep.equal([]);
      sinon.assert.calledOnce(storageStub.list);
    });

    describe("when a server is assigned", () => {
      beforeEach(() => {
        storageStub.list.resolves([defaultServer]);
      });

      it("returns the assigned server when there is one", async () => {
        const servers = await assignmentManager.getAssignedServers();

        assert.lengthOf(servers, 1);
        const server = servers[0];
        expect(serverWithoutFetch(server)).to.deep.equal(defaultServer);
        sinon.assert.calledOnce(storageStub.list);
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
            "X-Colab-Runtime-Proxy-Token": server.connectionInformation.token,
            "X-Colab-Client-Agent": "vscode",
          }),
        });
      });
    });

    it("returns multiple assigned servers when there are some", async () => {
      const storedServers = [
        { ...defaultServer, id: randomUUID() },
        { ...defaultServer, id: randomUUID() },
      ];
      storageStub.list.resolves(storedServers);

      const servers = await assignmentManager.getAssignedServers();

      expect(servers.map(serverWithoutFetch)).to.deep.equal(storedServers);
      sinon.assert.calledOnce(storageStub.list);
    });
  });

  describe("assignServer", () => {
    it("throws an error when the assignment does not include runtime proxy info", () => {
      colabClientStub.assign
        .withArgs(
          sinon.match(isUUID),
          defaultAssignment.variant,
          defaultAssignment.accelerator,
        )
        .resolves({ ...defaultAssignment, runtimeProxyInfo: undefined });

      expect(
        assignmentManager.assignServer(
          randomUUID(),
          defaultAssignmentDescriptor,
        ),
      ).to.be.rejectedWith(/connection info/);
    });

    it("throws an error when the assignment does not include a URL to connect to", () => {
      colabClientStub.assign
        .withArgs(
          sinon.match(isUUID),
          defaultAssignment.variant,
          defaultAssignment.accelerator,
        )
        .resolves({
          ...defaultAssignment,
          runtimeProxyInfo: {
            ...defaultAssignment.runtimeProxyInfo,
            url: "",
          },
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
          ...defaultAssignment,
          runtimeProxyInfo: {
            ...defaultAssignment.runtimeProxyInfo,
            token: "",
          },
        });

      expect(
        assignmentManager.assignServer(
          randomUUID(),
          defaultAssignmentDescriptor,
        ),
      ).to.be.rejectedWith(/connection info/);
    });

    describe("when a server is assigned", () => {
      let listener: sinon.SinonStub<[]>;
      let assignedServer: ColabAssignedServer;

      beforeEach(async () => {
        listener = sinon.stub();
        assignmentManager.onDidAssignmentsChange(listener);
        colabClientStub.assign
          .withArgs(
            defaultServer.id,
            defaultServer.variant,
            defaultServer.accelerator,
          )
          .resolves(defaultAssignment);

        assignedServer = await assignmentManager.assignServer(
          defaultServer.id,
          defaultAssignmentDescriptor,
        );
      });

      it("stores and returns the server", () => {
        sinon.assert.calledOnceWithMatch(storageStub.store, [
          {
            ...defaultServer,
            connectionInformation: {
              ...defaultServer.connectionInformation,
              fetch: sinon.match.func,
            },
          },
        ]);
        expect(serverWithoutFetch(assignedServer)).to.deep.equal(defaultServer);
      });

      it("emits an assignment change event", () => {
        sinon.assert.calledOnce(listener);
      });

      it("includes a fetch implementation that attaches Colab connection info", async () => {
        assert.isDefined(assignedServer.connectionInformation.fetch);
        const fetchStub = sinon.stub(fetch, "default");

        await assignedServer.connectionInformation.fetch("https://example.com");

        sinon.assert.calledOnceWithMatch(fetchStub, "https://example.com", {
          headers: new Headers({
            "X-Colab-Runtime-Proxy-Token":
              assignedServer.connectionInformation.token,
            "X-Colab-Client-Agent": "vscode",
          }),
        });
      });
    });
  });

  describe("refreshConnection", () => {
    const newToken = "new-token";
    let refreshedServer: ColabAssignedServer;
    let listener: sinon.SinonStub<[]>;

    beforeEach(async () => {
      listener = sinon.stub();
      assignmentManager.onDidAssignmentsChange(listener);
      colabClientStub.assign
        .withArgs(
          defaultServer.id,
          defaultServer.variant,
          defaultServer.accelerator,
        )
        .resolves({
          ...defaultAssignment,
          runtimeProxyInfo: {
            ...defaultAssignment.runtimeProxyInfo,
            token: newToken,
          },
        });

      refreshedServer =
        await assignmentManager.refreshConnection(defaultServer);
    });

    it("stores and returns the server with updated connection info", () => {
      const expectedServer: ColabAssignedServer = {
        ...defaultServer,
        connectionInformation: {
          ...defaultServer.connectionInformation,
          headers: {
            "X-Colab-Runtime-Proxy-Token": newToken,
            "X-Colab-Client-Agent": "vscode",
          },
          token: newToken,
        },
      };
      sinon.assert.calledOnceWithMatch(storageStub.store, [
        {
          ...expectedServer,
          connectionInformation: {
            ...expectedServer.connectionInformation,
            fetch: sinon.match.func,
          },
        },
      ]);
      expect(serverWithoutFetch(refreshedServer)).to.deep.equal(expectedServer);
    });

    it("includes a fetch implementation that attaches Colab connection info", async () => {
      assert.isDefined(refreshedServer.connectionInformation.fetch);
      const fetchStub = sinon.stub(fetch, "default");

      await refreshedServer.connectionInformation.fetch("https://example.com");

      sinon.assert.calledOnceWithMatch(fetchStub, "https://example.com", {
        headers: new Headers({
          "X-Colab-Runtime-Proxy-Token":
            refreshedServer.connectionInformation.token,
          "X-Colab-Client-Agent": "vscode",
        }),
      });
    });

    it("emits an assignment change event", () => {
      sinon.assert.calledOnce(listener);
    });
  });
});

function serverWithoutFetch(server: ColabAssignedServer): ColabAssignedServer {
  return {
    ...server,
    connectionInformation: {
      baseUrl: server.connectionInformation.baseUrl,
      token: server.connectionInformation.token,
      headers: server.connectionInformation.headers,
    },
  };
}
