import { Jupyter, JupyterServer } from "@vscode/jupyter-extension";
import { assert, expect } from "chai";
import { SinonStubbedInstance } from "sinon";
import * as sinon from "sinon";
import {
  Accelerator,
  Assignment,
  Shape,
  SubscriptionState,
  SubscriptionTier,
  Variant,
} from "../colab/api";
import { ColabClient } from "../colab/client";
import {
  DisposableStub,
  TestCancellationTokenSource,
  TestUri,
  vscodeStub,
} from "../test/helpers/vscode";
import { ColabJupyterServerProvider } from "./provider";
import { ColabJupyterServer, SERVERS } from "./servers";

describe("ColabJupyterServerProvider", () => {
  const cancellationTokenSource = new TestCancellationTokenSource();
  const cancellationToken = cancellationTokenSource.token;
  let jupyterStub: SinonStubbedInstance<
    Pick<Jupyter, "createJupyterServerCollection">
  >;
  let colabClientStub: SinonStubbedInstance<
    Pick<ColabClient, "ccuInfo" | "assign">
  >;
  let registrationDisposable: DisposableStub;
  let serverProvider: ColabJupyterServerProvider;

  beforeEach(() => {
    jupyterStub = {
      createJupyterServerCollection: sinon.stub(),
    };
    colabClientStub = sinon.createStubInstance(ColabClient);
    registrationDisposable = new DisposableStub();
    DisposableStub.from.returns(registrationDisposable);

    serverProvider = new ColabJupyterServerProvider(
      vscodeStub,
      jupyterStub as Partial<Jupyter> as Jupyter,
      colabClientStub as Partial<ColabClient> as ColabClient,
    );
  });

  afterEach(() => {
    sinon.reset();
  });

  describe("lifecycle", () => {
    it('registers the "Colab" Jupyter server collection', () => {
      sinon.assert.calledOnceWithExactly(
        jupyterStub.createJupyterServerCollection,
        "colab",
        "Colab",
        serverProvider,
      );
    });

    it('disposes the "Colab" Jupyter server collection', () => {
      serverProvider.dispose();

      sinon.assert.calledOnce(registrationDisposable.dispose);
    });
  });

  describe("provideJupyterServers", () => {
    it("all servers eligible", async () => {
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

      const providedServers =
        await serverProvider.provideJupyterServers(cancellationToken);

      expect(providedServers).to.deep.equal(Array.from(SERVERS.values()));
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

      const providedServers =
        await serverProvider.provideJupyterServers(cancellationToken);

      const expectedServers = Array.from(SERVERS.values()).filter(
        (server) => server.accelerator !== Accelerator.L4,
      );
      expect(providedServers).to.deep.equal(expectedServers);
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

      const providedServers =
        await serverProvider.provideJupyterServers(cancellationToken);

      const expectedServers = Array.from(SERVERS.values()).filter(
        (server) => server.accelerator !== Accelerator.L4,
      );
      expect(providedServers).to.deep.equal(expectedServers);
      sinon.assert.calledOnce(colabClientStub.ccuInfo);
    });
  });

  describe("resolveJupyterServer", () => {
    it("rejects for unknown servers", async () => {
      const unknownServer: JupyterServer = {
        id: "unknown",
        label: "Unknown",
      };

      await expect(
        serverProvider.resolveJupyterServer(unknownServer, cancellationToken),
      ).to.eventually.be.rejectedWith(`Unknown server: ${unknownServer.id}`);
    });

    it("rejects for server assignments without connection information", async () => {
      const server = SERVERS.get("gpu-a100");
      assert.isDefined(server);
      const nbh = "booooooooooooooooooooooooooooooooooooooooooo";
      const assignment: Assignment = {
        accelerator: Accelerator.A100,
        endpoint: "mock-endpoint",
        sub: SubscriptionState.UNSUBSCRIBED,
        subTier: SubscriptionTier.UNKNOWN_TIER,
        variant: Variant.DEFAULT,
        machineShape: Shape.STANDARD,
        runtimeProxyInfo: undefined,
      };
      colabClientStub.assign.withArgs(nbh, server.variant).resolves(assignment);

      await expect(
        serverProvider.resolveJupyterServer(server, cancellationToken),
      ).to.eventually.be.rejectedWith(/connection information/);
    });

    it("successfully", async () => {
      const server = SERVERS.get("gpu-a100");
      assert.isDefined(server);
      // TODO: Derive NBH.
      const nbh = "booooooooooooooooooooooooooooooooooooooooooo";
      const assignment: Assignment = {
        accelerator: Accelerator.A100,
        endpoint: "mock-endpoint",
        sub: SubscriptionState.UNSUBSCRIBED,
        subTier: SubscriptionTier.UNKNOWN_TIER,
        variant: Variant.DEFAULT,
        machineShape: Shape.STANDARD,
        runtimeProxyInfo: {
          token: "mock-token",
          tokenExpiresInSeconds: 42,
          url: "https://mock-url.com",
        },
      };
      colabClientStub.assign.withArgs(nbh, server.variant).resolves(assignment);

      const resolvedServer = await serverProvider.resolveJupyterServer(
        server,
        cancellationToken,
      );

      assert.isDefined(assignment.runtimeProxyInfo);
      const expectedResolvedServer: ColabJupyterServer = {
        id: server.id,
        label: server.label,
        connectionInformation: {
          baseUrl: TestUri.parse(assignment.runtimeProxyInfo.url),
          headers: {
            "X-Colab-Runtime-Proxy-Token": assignment.runtimeProxyInfo.token,
          },
        },
        variant: server.variant,
        accelerator: server.accelerator,
      };
      expect(resolvedServer).to.deep.equal(expectedResolvedServer);
    });
  });
});
