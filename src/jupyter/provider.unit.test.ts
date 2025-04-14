import { randomUUID } from "crypto";
import {
  Jupyter,
  JupyterServer,
  JupyterServerCollection,
  JupyterServerCommandProvider,
  JupyterServerProvider,
} from "@vscode/jupyter-extension";
import { JupyterServerCommand } from "@vscode/jupyter-extension";
import { assert, expect } from "chai";
import { SinonStubbedInstance } from "sinon";
import * as sinon from "sinon";
import { CancellationToken, CancellationTokenSource } from "vscode";
import { Accelerator, SubscriptionTier, Variant } from "../colab/api";
import { ColabClient } from "../colab/client";
import { ServerPicker } from "../colab/server-picker";
import { InputFlowAction } from "../common/multi-step-quickpick";
import {
  newVsCodeStub as newVsCodeStub,
  VsCodeStub,
} from "../test/helpers/vscode";
import { isUUID } from "../utils/uuid";
import { AssignmentManager } from "./assignments";
import { ColabJupyterServerProvider } from "./provider";
import {
  COLAB_SERVERS,
  ColabAssignedServer,
  ColabServerDescriptor,
} from "./servers";

describe("ColabJupyterServerProvider", () => {
  let vsCodeStub: VsCodeStub;
  let cancellationTokenSource: CancellationTokenSource;
  let cancellationToken: CancellationToken;
  let jupyterStub: SinonStubbedInstance<
    Pick<Jupyter, "createJupyterServerCollection">
  >;
  let serverCollectionStub: SinonStubbedInstance<JupyterServerCollection>;
  let serverCollectionDisposeStub: sinon.SinonStub<[], void>;
  let assignmentStub: SinonStubbedInstance<AssignmentManager>;
  let colabClientStub: SinonStubbedInstance<ColabClient>;
  let serverPickerStub: SinonStubbedInstance<ServerPicker>;
  let defaultServer: ColabAssignedServer;
  let serverProvider: ColabJupyterServerProvider;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    cancellationTokenSource = new vsCodeStub.CancellationTokenSource();
    cancellationToken = cancellationTokenSource.token;
    serverCollectionDisposeStub = sinon.stub();
    jupyterStub = {
      createJupyterServerCollection: sinon.stub(),
    };
    jupyterStub.createJupyterServerCollection.callsFake(
      (
        id: string,
        label: string,
        serverProvider: JupyterServerProvider,
      ): JupyterServerCollection => {
        if (!isJupyterServerCommandProvider(serverProvider)) {
          throw new Error(
            "Stub expects the `serverProvider` to also be the `JupyterServerCommandProvider`",
          );
        }
        serverCollectionStub = {
          id,
          label,
          commandProvider: serverProvider,
          dispose: serverCollectionDisposeStub,
        };
        return serverCollectionStub;
      },
    );
    assignmentStub = sinon.createStubInstance(AssignmentManager);
    colabClientStub = sinon.createStubInstance(ColabClient);
    serverPickerStub = sinon.createStubInstance(ServerPicker);
    defaultServer = {
      id: randomUUID(),
      label: "Colab GPU A100",
      variant: Variant.GPU,
      accelerator: Accelerator.A100,
      endpoint: "m-s-foo",
      connectionInformation: {
        baseUrl: vsCodeStub.Uri.parse("https://example.com"),
        token: "123",
        headers: {
          "X-Colab-Runtime-Proxy-Token": "123",
          "X-Colab-Client-Agent": "vscode",
        },
      },
    };

    serverProvider = new ColabJupyterServerProvider(
      vsCodeStub.asVsCode(),
      assignmentStub,
      colabClientStub,
      serverPickerStub,
      jupyterStub as Partial<Jupyter> as Jupyter,
    );
  });

  afterEach(() => {
    sinon.restore();
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

      sinon.assert.calledOnce(serverCollectionDisposeStub);
    });
  });

  describe("provideJupyterServers", () => {
    it("returns no servers when none are assigned", async () => {
      assignmentStub.getAssignedServers.resolves([]);

      const servers =
        await serverProvider.provideJupyterServers(cancellationToken);

      expect(servers).to.have.lengthOf(0);
    });

    it("returns a single server when one is assigned", async () => {
      assignmentStub.getAssignedServers.resolves([defaultServer]);

      const servers =
        await serverProvider.provideJupyterServers(cancellationToken);

      expect(servers).to.deep.equal([defaultServer]);
    });

    it("returns multiple servers when they are assigned", async () => {
      const assignedServers = [
        defaultServer,
        { ...defaultServer, id: randomUUID() },
      ];
      assignmentStub.getAssignedServers.resolves(assignedServers);

      const servers =
        await serverProvider.provideJupyterServers(cancellationToken);

      expect(servers).to.deep.equal(assignedServers);
    });
  });

  describe("resolveJupyterServer", () => {
    it("throws when the server ID is not a UUID", () => {
      const server = { ...defaultServer, id: "not-a-uuid" };

      expect(() =>
        serverProvider.resolveJupyterServer(server, cancellationToken),
      ).to.throw(/expected UUID/);
    });

    it("rejects if the server is not found", async () => {
      assignmentStub.getAssignedServers.resolves([defaultServer]);
      const server: JupyterServer = { id: randomUUID(), label: "foo" };

      await expect(
        serverProvider.resolveJupyterServer(server, cancellationToken),
      ).to.eventually.be.rejectedWith(/not found/);
    });

    it("returns the assigned server with refreshed connection info", async () => {
      const refreshedServer: ColabAssignedServer = {
        ...defaultServer,
        connectionInformation: {
          ...defaultServer.connectionInformation,
          token: "456",
        },
      };
      assignmentStub.getAssignedServers.resolves([defaultServer]);
      assignmentStub.refreshConnection
        .withArgs(defaultServer)
        .resolves(refreshedServer);

      await expect(
        serverProvider.resolveJupyterServer(defaultServer, cancellationToken),
      ).to.eventually.deep.equal(refreshedServer);
    });
  });

  describe("commands", () => {
    const newServerCommand: JupyterServerCommand = {
      label: "$(add) New Colab Server",
      description: "CPU, GPU or TPU.",
    };
    const openWebCommand: JupyterServerCommand = {
      label: "$(ports-open-browser-icon) Open Colab Web",
      description: "Open Colab web.",
    };
    const upgradeToProCommand: JupyterServerCommand = {
      label: "$(accounts-view-bar-icon) Upgrade to Pro",
      description: "More machines, more quota, more Colab!",
    };

    describe("provideCommands", () => {
      it("excludes upgrade to pro command when getting the subscription tier fails", async () => {
        colabClientStub.getSubscriptionTier.rejects(new Error("foo"));

        const commands = await serverProvider.provideCommands(
          undefined,
          cancellationToken,
        );

        assert.isDefined(commands);
        expect(commands).to.deep.equal([newServerCommand, openWebCommand]);
      });

      it("excludes upgrade to pro command for users with pro", async () => {
        colabClientStub.getSubscriptionTier.resolves(SubscriptionTier.PRO);

        const commands = await serverProvider.provideCommands(
          undefined,
          cancellationToken,
        );

        assert.isDefined(commands);
        expect(commands).to.deep.equal([newServerCommand, openWebCommand]);
      });

      it("excludes upgrade to pro command for users with pro-plus", async () => {
        colabClientStub.getSubscriptionTier.resolves(SubscriptionTier.PRO_PLUS);

        const commands = await serverProvider.provideCommands(
          undefined,
          cancellationToken,
        );

        assert.isDefined(commands);
        expect(commands).to.deep.equal([newServerCommand, openWebCommand]);
      });

      it("returns commands to create a server, open Colab web and upgrade to pro for free users", async () => {
        colabClientStub.getSubscriptionTier.resolves(SubscriptionTier.NONE);

        const commands = await serverProvider.provideCommands(
          undefined,
          cancellationToken,
        );

        assert.isDefined(commands);
        expect(commands).to.deep.equal([
          newServerCommand,
          openWebCommand,
          upgradeToProCommand,
        ]);
      });
    });

    describe("handleCommand", () => {
      it('opens a browser to the Colab web client for "Open Colab Web"', () => {
        vsCodeStub.env.openExternal.resolves(true);

        expect(
          serverProvider.handleCommand(
            { label: "$(ports-open-browser-icon) Open Colab Web" },
            cancellationToken,
          ),
        ).to.be.equal(undefined);

        sinon.assert.calledOnceWithExactly(
          vsCodeStub.env.openExternal,
          vsCodeStub.Uri.parse("https://colab.research.google.com"),
        );
      });

      it('opens a browser to the Colab signup page for "Upgrade to Pro"', () => {
        vsCodeStub.env.openExternal.resolves(true);

        expect(
          serverProvider.handleCommand(
            { label: "$(accounts-view-bar-icon) Upgrade to Pro" },
            cancellationToken,
          ),
        ).to.be.equal(undefined);

        sinon.assert.calledOnceWithExactly(
          vsCodeStub.env.openExternal,
          vsCodeStub.Uri.parse("https://colab.research.google.com/signup"),
        );
      });

      describe("for new Colab server", () => {
        it("returns undefined when navigating back out of the flow", async () => {
          serverPickerStub.prompt.rejects(InputFlowAction.back);

          await expect(
            serverProvider.handleCommand(
              { label: "$(add) New Colab Server" },
              cancellationToken,
            ),
          ).to.eventually.be.equal(undefined);
          sinon.assert.calledOnce(serverPickerStub.prompt);
        });

        it("completes assigning a server", async () => {
          const availableServers = Array.from(COLAB_SERVERS);
          assignmentStub.getAvailableServerDescriptors.resolves(
            availableServers,
          );
          const selectedServer: ColabServerDescriptor = {
            label: "My new server",
            variant: defaultServer.variant,
            accelerator: defaultServer.accelerator,
          };
          serverPickerStub.prompt
            .withArgs(availableServers)
            .resolves(selectedServer);
          assignmentStub.assignServer
            .withArgs(sinon.match(isUUID), selectedServer)
            .resolves(defaultServer);

          await expect(
            serverProvider.handleCommand(
              { label: "$(add) New Colab Server" },
              cancellationToken,
            ),
          ).to.eventually.deep.equal(defaultServer);

          sinon.assert.calledOnce(serverPickerStub.prompt);
          sinon.assert.calledOnce(assignmentStub.assignServer);
        });
      });
    });
  });
});

// A quick and dirty sanity check to ensure we're dealing with a command
// provider.
function isJupyterServerCommandProvider(
  obj: unknown,
): obj is JupyterServerCommandProvider {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }
  return (
    "provideCommands" in obj &&
    "handleCommand" in obj &&
    typeof obj.provideCommands === "function" &&
    typeof obj.handleCommand === "function"
  );
}
