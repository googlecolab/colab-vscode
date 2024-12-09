import { Jupyter, JupyterServer } from "@vscode/jupyter-extension";
import {
  JupyterServerProvider,
  JupyterServerCollection,
} from "@vscode/jupyter-extension";
import { assert, expect } from "chai";
import * as sinon from "sinon";
import { CancellationToken, Uri } from "vscode";
import { ColabJupyterServerProvider, RpConfig } from "./provider";

describe("register", () => {
  it("creates a Jupyter server collection", () => {
    const id = "colab";
    const label = "Colab";
    const createJupyterServerCollectionStub = sinon
      .stub<
        [id: string, label: string, serverProvider: JupyterServerProvider],
        JupyterServerCollection
      >()
      .returns({ id, label } as JupyterServerCollection);
    const jupyterMock = {
      createJupyterServerCollection: createJupyterServerCollectionStub,
    } as unknown as Jupyter;
    const config: RpConfig = {
      baseUri: {} as Uri,
      token: "foo",
    };

    const servers = ColabJupyterServerProvider.register(jupyterMock, config);

    sinon.assert.calledOnce(createJupyterServerCollectionStub);
    const call = createJupyterServerCollectionStub.getCall(0);
    assert.equal(call.args[0], id);
    assert.equal(servers.id, id);
    assert.equal(call.args[1], label);
    assert.equal(servers.label, label);
  });
});

describe("ColabJupyterServerProvider", () => {
  const config: RpConfig = { baseUri: {} as Uri, token: "foo" };
  const expectedServers: JupyterServer[] = [
    {
      connectionInformation: undefined,
      id: "m",
      label: "Colab CPU",
    },
    {
      connectionInformation: undefined,
      id: "gpu-t4",
      label: "Colab T4",
    },
    {
      connectionInformation: undefined,
      id: "gpu-l4",
      label: "Colab L4",
    },
    {
      connectionInformation: undefined,
      id: "gpu-a100",
      label: "Colab A100",
    },
    {
      connectionInformation: undefined,
      id: "tpu-v28",
      label: "Colab TPU v2-8",
    },
    {
      connectionInformation: undefined,
      id: "tpu-v5e1",
      label: "Colab TPU v5e-1",
    },
  ];
  let serverProvider: ColabJupyterServerProvider;

  beforeEach(() => {
    serverProvider = new ColabJupyterServerProvider(config);
  });

  it("provides Jupyter servers", async () => {
    const providedServers = await serverProvider.provideJupyterServers(
      {} as CancellationToken,
    );

    expect(providedServers).to.deep.equal(expectedServers);
  });

  expectedServers.forEach((server) => {
    it(`resolves the '${server.id}' Jupyter server`, async () => {
      const expectedResolvedServer: JupyterServer = {
        ...server,
        connectionInformation: {
          baseUrl: config.baseUri,
          headers: { "X-Colab-Runtime-Proxy-Token": config.token },
        },
      };

      const resolvedServer = await serverProvider.resolveJupyterServer(
        server,
        {} as CancellationToken,
      );

      expect(resolvedServer).to.deep.equal(expectedResolvedServer);
    });
  });
});
