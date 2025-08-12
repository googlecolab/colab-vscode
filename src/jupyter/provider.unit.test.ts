/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "crypto";
import {
  Jupyter,
  JupyterServer,
  JupyterServerCollection,
  JupyterServerCommandProvider,
  JupyterServerProvider,
} from "@vscode/jupyter-extension";
import { assert, expect } from "chai";
import { SinonStubbedInstance } from "sinon";
import * as sinon from "sinon";
import { CancellationToken, CancellationTokenSource } from "vscode";
import { Accelerator, SubscriptionTier, Variant } from "../colab/api";
import { ColabClient } from "../colab/client";
import {
  NEW_SERVER,
  OPEN_COLAB_WEB,
  UPGRADE_TO_PRO,
} from "../colab/commands/constants";
import {
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
} from "../colab/headers";
import { ServerPicker } from "../colab/server-picker";
import { InputFlowAction } from "../common/multi-step-quickpick";
import { TestUri } from "../test/helpers/uri";
import {
  newVsCodeStub as newVsCodeStub,
  VsCodeStub,
} from "../test/helpers/vscode";
import { isUUID } from "../utils/uuid";
import { AssignmentChangeEvent, AssignmentManager } from "./assignments";
import { ColabJupyterServerProvider } from "./provider";
import {
  COLAB_SERVERS,
  ColabAssignedServer,
  ColabServerDescriptor,
} from "./servers";

const DEFAULT_SERVER: ColabAssignedServer = {
  id: randomUUID(),
  label: "Colab GPU A100",
  variant: Variant.GPU,
  accelerator: Accelerator.A100,
  endpoint: "m-s-foo",
  connectionInformation: {
    baseUrl: TestUri.parse("https://example.com"),
    token: "123",
    headers: {
      [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]: "123",
      [COLAB_CLIENT_AGENT_HEADER.key]: COLAB_CLIENT_AGENT_HEADER.value,
    },
  },
};

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
    assignmentStub.onDidAssignmentsChange = sinon.stub();
    colabClientStub = sinon.createStubInstance(ColabClient);
    serverPickerStub = sinon.createStubInstance(ServerPicker);

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
      assignmentStub.getAssignedServers.resolves([DEFAULT_SERVER]);

      const servers =
        await serverProvider.provideJupyterServers(cancellationToken);

      expect(servers).to.deep.equal([DEFAULT_SERVER]);
    });

    it("returns multiple servers when they are assigned", async () => {
      const assignedServers = [
        DEFAULT_SERVER,
        { ...DEFAULT_SERVER, id: randomUUID() },
      ];
      assignmentStub.getAssignedServers.resolves(assignedServers);

      const servers =
        await serverProvider.provideJupyterServers(cancellationToken);

      expect(servers).to.deep.equal(assignedServers);
    });

    it("returns only reconciled servers", async () => {
      const nonReconciledServers = [
        DEFAULT_SERVER,
        { ...DEFAULT_SERVER, id: randomUUID() },
      ];
      // Setup the assignment manager stub to return two servers, but then
      // once reconciled, return only the first one. This effectively ensures
      // that the server provider only returns servers that are reconciled.
      assignmentStub.getAssignedServers.resolves(nonReconciledServers);
      assignmentStub.reconcileAssignedServers.callsFake(() => {
        assignmentStub.getAssignedServers.resolves([DEFAULT_SERVER]);
        return Promise.resolve();
      });

      const servers =
        await serverProvider.provideJupyterServers(cancellationToken);

      expect(servers).to.deep.equal([DEFAULT_SERVER]);
    });
  });

  describe("resolveJupyterServer", () => {
    it("throws when the server ID is not a UUID", () => {
      const server = { ...DEFAULT_SERVER, id: "not-a-uuid" };

      expect(() =>
        serverProvider.resolveJupyterServer(server, cancellationToken),
      ).to.throw(/expected UUID/);
    });

    it("rejects if the server is not found", async () => {
      assignmentStub.getAssignedServers.resolves([DEFAULT_SERVER]);
      const server: JupyterServer = { id: randomUUID(), label: "foo" };

      await expect(
        serverProvider.resolveJupyterServer(server, cancellationToken),
      ).to.eventually.be.rejectedWith(/not found/);
    });

    it("returns the assigned server with refreshed connection info", async () => {
      const refreshedServer: ColabAssignedServer = {
        ...DEFAULT_SERVER,
        connectionInformation: {
          ...DEFAULT_SERVER.connectionInformation,
          token: "456",
        },
      };
      assignmentStub.getAssignedServers.resolves([DEFAULT_SERVER]);
      assignmentStub.refreshConnection
        .withArgs(DEFAULT_SERVER)
        .resolves(refreshedServer);

      await expect(
        serverProvider.resolveJupyterServer(DEFAULT_SERVER, cancellationToken),
      ).to.eventually.deep.equal(refreshedServer);
    });
  });

  describe("commands", () => {
    describe("provideCommands", () => {
      it("excludes upgrade to pro command when getting the subscription tier fails", async () => {
        colabClientStub.getSubscriptionTier.rejects(new Error("foo"));

        const commands = await serverProvider.provideCommands(
          undefined,
          cancellationToken,
        );

        assert.isDefined(commands);
        expect(commands).to.deep.equal([NEW_SERVER, OPEN_COLAB_WEB]);
      });

      it("excludes upgrade to pro command for users with pro", async () => {
        colabClientStub.getSubscriptionTier.resolves(SubscriptionTier.PRO);

        const commands = await serverProvider.provideCommands(
          undefined,
          cancellationToken,
        );

        assert.isDefined(commands);
        expect(commands).to.deep.equal([NEW_SERVER, OPEN_COLAB_WEB]);
      });

      it("excludes upgrade to pro command for users with pro-plus", async () => {
        colabClientStub.getSubscriptionTier.resolves(SubscriptionTier.PRO_PLUS);

        const commands = await serverProvider.provideCommands(
          undefined,
          cancellationToken,
        );

        assert.isDefined(commands);
        expect(commands).to.deep.equal([NEW_SERVER, OPEN_COLAB_WEB]);
      });

      it("returns commands to create a server, open Colab web and upgrade to pro for free users", async () => {
        colabClientStub.getSubscriptionTier.resolves(SubscriptionTier.NONE);

        const commands = await serverProvider.provideCommands(
          undefined,
          cancellationToken,
        );

        assert.isDefined(commands);
        expect(commands).to.deep.equal([
          NEW_SERVER,
          OPEN_COLAB_WEB,
          UPGRADE_TO_PRO,
        ]);
      });
    });

    describe("handleCommand", () => {
      it('opens a browser to the Colab web client for "Open Colab Web"', () => {
        vsCodeStub.env.openExternal.resolves(true);

        expect(
          serverProvider.handleCommand(
            { label: OPEN_COLAB_WEB.label },
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
            { label: UPGRADE_TO_PRO.label },
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
              { label: NEW_SERVER.label },
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
            variant: DEFAULT_SERVER.variant,
            accelerator: DEFAULT_SERVER.accelerator,
          };
          serverPickerStub.prompt
            .withArgs(availableServers)
            .resolves(selectedServer);
          assignmentStub.assignServer
            .withArgs(sinon.match(isUUID), selectedServer)
            .resolves(DEFAULT_SERVER);

          await expect(
            serverProvider.handleCommand(
              { label: NEW_SERVER.label },
              cancellationToken,
            ),
          ).to.eventually.deep.equal(DEFAULT_SERVER);

          sinon.assert.calledOnce(serverPickerStub.prompt);
          sinon.assert.calledOnce(assignmentStub.assignServer);
        });
      });
    });
  });

  describe("onDidChangeServers", () => {
    const events: Map<"added" | "removed" | "changed", AssignmentChangeEvent> =
      new Map<"added" | "removed" | "changed", AssignmentChangeEvent>([
        ["added", { added: [DEFAULT_SERVER], removed: [], changed: [] }],
        [
          "removed",
          {
            added: [],
            removed: [{ server: DEFAULT_SERVER, userInitiated: false }],
            changed: [],
          },
        ],
        ["changed", { added: [], removed: [], changed: [DEFAULT_SERVER] }],
      ]);
    let listener: sinon.SinonStub<[]>;

    beforeEach(() => {
      sinon.assert.calledOnce(assignmentStub.onDidAssignmentsChange);
      listener = sinon.stub();
      serverProvider.onDidChangeServers(listener);
    });

    for (const [label, event] of events) {
      it(`fires when servers are ${label}`, () => {
        assignmentStub.onDidAssignmentsChange.yield(event);

        sinon.assert.calledOnce(listener);
      });
    }

    it("warns of server removal when not initiated by the user", () => {
      assignmentStub.onDidAssignmentsChange.yield(events.get("removed"));

      sinon.assert.calledOnceWithMatch(
        vsCodeStub.window.showWarningMessage,
        sinon.match(new RegExp(`"${DEFAULT_SERVER.label}" .+ removed`)),
      );
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
