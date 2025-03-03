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
  id: "gpu-a100",
  label: "Colab GPU A100",
  variant: Variant.GPU,
  accelerator: Accelerator.A100,
};

const defaultAssignment: Assignment & { runtimeProxyInfo: RuntimeProxyInfo } = {
  accelerator: Accelerator.A100,
  endpoint: "mock-endpoint",
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

  describe("availableServers", () => {
    it("returns all colab servers when all are eligible", async () => {
      colabClientStub.ccuInfo.resolves({
        currentBalance: 1,
        consumptionRateHourly: 2,
        assignmentsCount: 0,
        eligibleGpus: [Accelerator.T4, Accelerator.A100, Accelerator.L4],
        ineligibleGpus: [],
        freeCcuQuotaInfo: {
          remainingTokens: 4,
          nextRefillTimestampSec: 5,
        },
      });

      const servers = await assignmentManager.availableServers();

      expect(servers).to.deep.equal(Array.from(COLAB_SERVERS));
      sinon.assert.calledOnce(colabClientStub.ccuInfo);
    });

    it("filters to only eligible GPU servers", async () => {
      colabClientStub.ccuInfo.resolves({
        currentBalance: 1,
        consumptionRateHourly: 2,
        assignmentsCount: 0,
        eligibleGpus: [Accelerator.T4, Accelerator.A100],
        ineligibleGpus: [],
        freeCcuQuotaInfo: {
          remainingTokens: 4,
          nextRefillTimestampSec: 5,
        },
      });

      const servers = await assignmentManager.availableServers();

      const expectedServers = Array.from(COLAB_SERVERS).filter(
        (server) => server.accelerator !== Accelerator.L4,
      );
      expect(servers).to.deep.equal(expectedServers);
      sinon.assert.calledOnce(colabClientStub.ccuInfo);
    });

    it("filters out ineligible GPU servers", async () => {
      colabClientStub.ccuInfo.resolves({
        currentBalance: 1,
        consumptionRateHourly: 2,
        assignmentsCount: 0,
        eligibleGpus: [Accelerator.T4, Accelerator.A100],
        ineligibleGpus: [Accelerator.L4],
        freeCcuQuotaInfo: {
          remainingTokens: 4,
          nextRefillTimestampSec: 5,
        },
      });

      const servers = await assignmentManager.availableServers();

      const expectedServers = Array.from(COLAB_SERVERS).filter(
        (server) => server.accelerator !== Accelerator.L4,
      );
      expect(servers).to.deep.equal(expectedServers);
      sinon.assert.calledOnce(colabClientStub.ccuInfo);
    });
  });

  describe("assignedServers", () => {
    it("returns an empty list when no servers are assigned", async () => {
      storageStub.get.resolves([]);

      const servers = await assignmentManager.assignedServers();

      expect(servers).to.deep.equal([]);
      sinon.assert.calledOnce(storageStub.get);
    });

    describe("when a server is assigned", () => {
      beforeEach(() => {
        storageStub.get.resolves([defaultServer]);
      });

      it("returns the assigned server when there is one", async () => {
        const servers = await assignmentManager.assignedServers();

        assert.lengthOf(servers, 1);
        const server = servers[0];
        expect(serverWithoutFetch(server)).to.deep.equal(defaultServer);
        sinon.assert.calledOnce(storageStub.get);
      });

      it("includes a fetch implementation that attaches Colab connection info", async () => {
        const servers = await assignmentManager.assignedServers();
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
      storageStub.get.resolves(storedServers);

      const servers = await assignmentManager.assignedServers();

      expect(servers.map(serverWithoutFetch)).to.deep.equal(storedServers);
      sinon.assert.calledOnce(storageStub.get);
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
        sinon.assert.calledOnceWithMatch(storageStub.store, {
          ...defaultServer,
          connectionInformation: {
            ...defaultServer.connectionInformation,
            fetch: sinon.match.func,
          },
        });
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

  describe("refreshToken", () => {
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
      sinon.assert.calledOnceWithMatch(storageStub.store, {
        ...expectedServer,
        connectionInformation: {
          ...expectedServer.connectionInformation,
          fetch: sinon.match.func,
        },
      });
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
