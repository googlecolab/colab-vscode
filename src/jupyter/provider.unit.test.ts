/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "crypto";
import {
  Jupyter,
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
  AUTO_CONNECT,
  NEW_SERVER,
  OPEN_COLAB_WEB,
  SIGN_IN_VIEW_EXISTING,
  UPGRADE_TO_PRO,
} from "../colab/commands/constants";
import {
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
} from "../colab/headers";
import { ServerPicker } from "../colab/server-picker";
import { InputFlowAction } from "../common/multi-step-quickpick";
import { Toggleable } from "../common/toggleable";
import { TestUri } from "../test/helpers/uri";
import {
  newVsCodeStub as newVsCodeStub,
  VsCodeStub,
} from "../test/helpers/vscode";
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
    tokenExpiry: new Date(Date.now() + 1000 * 60 * 60),
    headers: {
      [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]: "123",
      [COLAB_CLIENT_AGENT_HEADER.key]: COLAB_CLIENT_AGENT_HEADER.value,
    },
  },
  dateAssigned: new Date(),
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
  let whileAuthorizedToggles: Toggleable[];
  let whileAuthorizedDisposeStub: sinon.SinonStub<[], void>;
  let assignmentStub: SinonStubbedInstance<AssignmentManager>;
  let colabClientStub: SinonStubbedInstance<ColabClient>;
  let serverPickerStub: SinonStubbedInstance<ServerPicker>;
  let serverProvider: ColabJupyterServerProvider;

  enum AuthStatus {
    SIGNED_OUT,
    SIGNED_IN,
  }

  function toggleAuth(s: AuthStatus) {
    for (const t of whileAuthorizedToggles) {
      switch (s) {
        case AuthStatus.SIGNED_OUT:
          t.off();
          break;
        case AuthStatus.SIGNED_IN:
          t.on();
          break;
      }
    }
  }

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
    whileAuthorizedToggles = [];
    whileAuthorizedDisposeStub = sinon.stub();
    const whileAuthorized = (...toggles: Toggleable[]) => {
      whileAuthorizedToggles.push(...toggles);

      return {
        dispose: whileAuthorizedDisposeStub,
      };
    };

    assignmentStub = sinon.createStubInstance(AssignmentManager);
    Object.defineProperty(assignmentStub, "onDidAssignmentsChange", {
      value: sinon.stub(),
    });
    colabClientStub = sinon.createStubInstance(ColabClient);
    serverPickerStub = sinon.createStubInstance(ServerPicker);

    serverProvider = new ColabJupyterServerProvider(
      vsCodeStub.asVsCode(),
      whileAuthorized,
      assignmentStub,
      colabClientStub,
      serverPickerStub,
      jupyterStub as Partial<Jupyter> as Jupyter,
    );
    toggleAuth(AuthStatus.SIGNED_IN);
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

    it("disposes the authorization toggle listener", () => {
      serverProvider.dispose();

      sinon.assert.calledOnce(whileAuthorizedDisposeStub);
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

    it("returns no servers when not signed in", async () => {
      toggleAuth(AuthStatus.SIGNED_OUT);

      const servers =
        await serverProvider.provideJupyterServers(cancellationToken);

      expect(servers).to.have.lengthOf(0);
      // Assert the call was never made, which requires the user to be signed
      // in.
      sinon.assert.notCalled(assignmentStub.getAssignedServers);
    });
  });

  describe("resolveJupyterServer", () => {
    it("throws when the server ID is not a UUID", () => {
      const server = { ...DEFAULT_SERVER, id: "not-a-uuid" };

      expect(() =>
        serverProvider.resolveJupyterServer(server, cancellationToken),
      ).to.throw(/expected UUID/);
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
        .withArgs(DEFAULT_SERVER.id)
        .resolves(refreshedServer);

      await expect(
        serverProvider.resolveJupyterServer(DEFAULT_SERVER, cancellationToken),
      ).to.eventually.deep.equal(refreshedServer);
    });
  });

  describe("commands", () => {
    describe("provideCommands", () => {
      describe("when signed in", () => {
        beforeEach(() => {
          toggleAuth(AuthStatus.SIGNED_IN);
        });

        it("excludes upgrade to pro command when getting the subscription tier fails", async () => {
          colabClientStub.getSubscriptionTier.rejects(new Error("foo"));

          const commands = await serverProvider.provideCommands(
            undefined,
            cancellationToken,
          );

          assert.isDefined(commands);
          expect(commands).to.deep.equal([
            AUTO_CONNECT,
            NEW_SERVER,
            OPEN_COLAB_WEB,
          ]);
        });

        it("excludes upgrade to pro command for users with pro", async () => {
          colabClientStub.getSubscriptionTier.resolves(SubscriptionTier.PRO);

          const commands = await serverProvider.provideCommands(
            undefined,
            cancellationToken,
          );

          assert.isDefined(commands);
          expect(commands).to.deep.equal([
            AUTO_CONNECT,
            NEW_SERVER,
            OPEN_COLAB_WEB,
          ]);
        });

        it("excludes upgrade to pro command for users with pro-plus", async () => {
          colabClientStub.getSubscriptionTier.resolves(
            SubscriptionTier.PRO_PLUS,
          );

          const commands = await serverProvider.provideCommands(
            undefined,
            cancellationToken,
          );

          assert.isDefined(commands);
          expect(commands).to.deep.equal([
            AUTO_CONNECT,
            NEW_SERVER,
            OPEN_COLAB_WEB,
          ]);
        });

        it("returns commands to auto-connect, create a server, open Colab web and upgrade to pro for free users", async () => {
          colabClientStub.getSubscriptionTier.resolves(SubscriptionTier.NONE);

          const commands = await serverProvider.provideCommands(
            undefined,
            cancellationToken,
          );

          assert.isDefined(commands);
          expect(commands).to.deep.equal([
            AUTO_CONNECT,
            NEW_SERVER,
            OPEN_COLAB_WEB,
            UPGRADE_TO_PRO,
          ]);
        });
      });

      describe("when signed out", () => {
        beforeEach(() => {
          toggleAuth(AuthStatus.SIGNED_OUT);
        });

        it("includes command to sign-in and view existing servers if there previously were some", async () => {
          assignmentStub.getLastKnownAssignedServers.resolves([DEFAULT_SERVER]);

          const commands = await serverProvider.provideCommands(
            undefined,
            cancellationToken,
          );

          assert.isDefined(commands);
          expect(commands).to.deep.equal([
            SIGN_IN_VIEW_EXISTING,
            AUTO_CONNECT,
            NEW_SERVER,
            OPEN_COLAB_WEB,
          ]);
        });

        it("returns commands to auto-connect, create a server and open Colab web", async () => {
          assignmentStub.getLastKnownAssignedServers.resolves([]);

          const commands = await serverProvider.provideCommands(
            undefined,
            cancellationToken,
          );

          assert.isDefined(commands);
          expect(commands).to.deep.equal([
            AUTO_CONNECT,
            NEW_SERVER,
            OPEN_COLAB_WEB,
          ]);
        });
      });
    });

    describe("handleCommand", () => {
      // See catch block of ColabJupyterServerProvider.handleCommand for
      // context. This is a required workaround until
      // https://github.com/microsoft/vscode-jupyter/issues/16469 is resolved.
      it("dismisses the input when an error is thrown", async () => {
        assignmentStub.latestOrAutoAssignServer.rejects(new Error("barf"));

        await expect(
          serverProvider.handleCommand(
            { label: AUTO_CONNECT.label },
            cancellationToken,
          ),
        ).to.eventually.be.rejectedWith(/barf/);

        sinon.assert.calledOnceWithExactly(
          vsCodeStub.commands.executeCommand,
          "workbench.action.closeQuickOpen",
        );
      });

      it('opens a browser to the Colab web client for "Open Colab Web"', async () => {
        vsCodeStub.env.openExternal.resolves(true);

        await expect(
          serverProvider.handleCommand(
            { label: OPEN_COLAB_WEB.label },
            cancellationToken,
          ),
        ).to.eventually.equal(undefined);

        sinon.assert.calledOnceWithExactly(
          vsCodeStub.env.openExternal,
          vsCodeStub.Uri.parse("https://colab.research.google.com"),
        );
      });

      it('opens a browser to the Colab signup page for "Upgrade to Pro"', async () => {
        vsCodeStub.env.openExternal.resolves(true);

        await expect(
          serverProvider.handleCommand(
            { label: UPGRADE_TO_PRO.label },
            cancellationToken,
          ),
        ).to.eventually.equal(undefined);

        sinon.assert.calledOnceWithExactly(
          vsCodeStub.env.openExternal,
          vsCodeStub.Uri.parse("https://colab.research.google.com/signup"),
        );
      });

      describe("for signing-in to view existing servers", () => {
        it("triggers server reconciliation and navigates back out of the flow", async () => {
          assignmentStub.reconcileAssignedServers.resolves();

          await expect(
            serverProvider.handleCommand(
              { label: SIGN_IN_VIEW_EXISTING.label },
              cancellationToken,
            ),
          ).to.eventually.be.equal(undefined);

          sinon.assert.calledOnce(assignmentStub.reconcileAssignedServers);
        });
      });

      describe("for auto-connecting", () => {
        it("assigns the latest server or auto-assigns one", async () => {
          assignmentStub.latestOrAutoAssignServer.resolves(DEFAULT_SERVER);

          await expect(
            serverProvider.handleCommand(
              { label: AUTO_CONNECT.label },
              cancellationToken,
            ),
          ).to.eventually.deep.equal(DEFAULT_SERVER);
        });
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
            .withArgs(selectedServer)
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
