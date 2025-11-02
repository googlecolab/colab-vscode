/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Jupyter,
  JupyterServer,
  JupyterServerCollection,
  JupyterServerCommand,
  JupyterServerCommandProvider,
  JupyterServerProvider,
} from "@vscode/jupyter-extension";
import { CancellationToken, Disposable, ProviderResult } from "vscode";
import vscode from "vscode";
import { SubscriptionTier } from "../colab/api";
import { ColabClient } from "../colab/client";
import {
  AUTO_CONNECT,
  NEW_SERVER,
  OPEN_COLAB_WEB,
  SIGN_IN_VIEW_EXISTING,
  UPGRADE_TO_PRO,
} from "../colab/commands/constants";
import { openColabSignup, openColabWeb } from "../colab/commands/external";
import { ServerPicker } from "../colab/server-picker";
import { traceMethod } from "../common/logging/decorators";
import { InputFlowAction } from "../common/multi-step-quickpick";
import { Toggleable } from "../common/toggleable";
import { isUUID } from "../utils/uuid";
import { AssignmentChangeEvent, AssignmentManager } from "./assignments";

/**
 * Colab Jupyter server provider.
 *
 * Provides a static list of Colab Jupyter servers and resolves the connection
 * information using the provided config.
 */
export class ColabJupyterServerProvider
  implements
    JupyterServerProvider,
    JupyterServerCommandProvider,
    vscode.Disposable
{
  readonly onDidChangeServers: vscode.Event<void>;

  private readonly serverCollection: JupyterServerCollection;
  private readonly serverChangeEmitter: vscode.EventEmitter<void>;
  private isAuthorized = false;
  private authorizedListener: Disposable;

  constructor(
    private readonly vs: typeof vscode,
    whileAuthorized: (...toggles: Toggleable[]) => Disposable,
    private readonly assignmentManager: AssignmentManager,
    private readonly client: ColabClient,
    private readonly serverPicker: ServerPicker,
    jupyter: Jupyter,
  ) {
    this.serverChangeEmitter = new this.vs.EventEmitter<void>();
    this.onDidChangeServers = this.serverChangeEmitter.event;
    this.assignmentManager.onDidAssignmentsChange(
      this.handleAssignmentsChange.bind(this),
    );
    this.authorizedListener = whileAuthorized(
      this.toggleAuthorizationState.bind(this)(),
    );
    this.serverCollection = jupyter.createJupyterServerCollection(
      "colab",
      "Colab",
      this,
    );
    this.serverCollection.commandProvider = this;
    // TODO: Set `this.serverCollection.documentation` once docs exist.
  }

  dispose() {
    this.authorizedListener.dispose();
    this.serverCollection.dispose();
  }

  /**
   * Provides the list of Colab {@link JupyterServer | Jupyter Servers} which
   * can be used.
   */
  @traceMethod
  provideJupyterServers(
    _token: CancellationToken,
  ): ProviderResult<JupyterServer[]> {
    if (!this.isAuthorized) {
      return [];
    }
    return this.assignmentManager.getAssignedServers();
  }

  /**
   * Resolves the connection for the provided Colab {@link JupyterServer}.
   */
  @traceMethod
  resolveJupyterServer(
    server: JupyterServer,
    _token: CancellationToken,
  ): ProviderResult<JupyterServer> {
    if (!isUUID(server.id)) {
      throw new Error("Unexpected server ID format, expected UUID");
    }
    return this.assignmentManager.refreshConnection(server.id);
  }

  /**
   * Returns a list of commands which are displayed in a section below
   * resolved servers.
   *
   * This gets invoked every time the value (what the user has typed into the
   * quick pick) changes. But we just return a static list which will be
   * filtered down by the quick pick automatically.
   */
  // TODO: Integrate rename server alias and remove server commands.
  @traceMethod
  async provideCommands(
    _value: string | undefined,
    _token: CancellationToken,
  ): Promise<JupyterServerCommand[]> {
    const commands: JupyterServerCommand[] = [];
    // Only show the command to view existing servers if the user is not signed
    // in, but previously had assigned servers. Otherwise, the command is
    // redundant.
    if (
      !this.isAuthorized &&
      (await this.assignmentManager.getLastKnownAssignedServers()).length > 0
    ) {
      commands.push(SIGN_IN_VIEW_EXISTING);
    }
    commands.push(AUTO_CONNECT, NEW_SERVER, OPEN_COLAB_WEB);
    if (!this.isAuthorized) {
      return commands;
    }
    try {
      const tier = await this.client.getSubscriptionTier();
      if (tier === SubscriptionTier.NONE) {
        commands.push(UPGRADE_TO_PRO);
      }
    } catch (_) {
      // Including the command to upgrade to pro is non-critical. If it fails,
      // just return the commands without it.
    }
    return commands;
  }

  /**
   * Invoked when a command has been selected.
   *
   * @returns The newly assigned server or undefined if the command does not
   * create a new server.
   */
  // TODO: Consider popping a notification if the `openExternal` call fails.
  @traceMethod
  async handleCommand(
    command: JupyterServerCommand,
    _token: CancellationToken,
  ): Promise<JupyterServer | undefined> {
    try {
      switch (command.label) {
        case SIGN_IN_VIEW_EXISTING.label:
          // The sign-in flow starts by prompting the user with an
          // application-level dialog to sign-in. Since it effectively takes
          // over the application, we fire and forget reconciliation to trigger
          // sign-in and navigate back.
          await this.assignmentManager.reconcileAssignedServers();
          throw InputFlowAction.back;
        case AUTO_CONNECT.label:
          return await this.assignmentManager.latestOrAutoAssignServer();
        case NEW_SERVER.label:
          return await this.assignServer();
        case OPEN_COLAB_WEB.label:
          openColabWeb(this.vs);
          return;
        case UPGRADE_TO_PRO.label:
          openColabSignup(this.vs);
          return;
        default:
          throw new Error("Unexpected command");
      }
    } catch (e: unknown) {
      if (e === InputFlowAction.back) {
        // Navigate "back" by returning undefined.
        return;
      }

      // Which quick open? The open one... 😉. This is a little nasty, but
      // unfortunately it's the only known workaround while
      // https://github.com/microsoft/vscode-jupyter/issues/16469 is unresolved.
      //
      // Throwing a CancellationError is meant to dismiss the dialog, but it
      // doesn't. Additionally, if any other error is thrown while handling
      // commands, the quick pick is left spinning in the "busy" state.
      await this.vs.commands.executeCommand("workbench.action.closeQuickOpen");
      throw e;
    }
  }

  private toggleAuthorizationState(): Toggleable {
    const toggle = (to: boolean) => {
      const didChange = this.isAuthorized !== to;
      if (!didChange) {
        return;
      }
      this.isAuthorized = to;
      this.serverChangeEmitter.fire();
    };

    return {
      on: () => {
        toggle(true);
      },
      off: () => {
        toggle(false);
      },
    };
  }

  private async assignServer(): Promise<JupyterServer> {
    const serverType = await this.serverPicker.prompt(
      await this.assignmentManager.getAvailableServerDescriptors(),
    );
    if (!serverType) {
      throw new this.vs.CancellationError();
    }
    return this.assignmentManager.assignServer(serverType);
  }

  private handleAssignmentsChange(e: AssignmentChangeEvent): void {
    const externalRemovals = e.removed.filter((s) => !s.userInitiated);
    for (const { server: s } of externalRemovals) {
      this.vs.window.showWarningMessage(
        `Server "${s.label}" has been removed, either outside of the extension or due to inactivity.`,
      );
    }
    this.serverChangeEmitter.fire();
  }
}
