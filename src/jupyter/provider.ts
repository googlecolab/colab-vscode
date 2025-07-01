import { randomUUID, UUID } from "crypto";
import {
  Jupyter,
  JupyterServer,
  JupyterServerCollection,
  JupyterServerCommand,
  JupyterServerCommandProvider,
  JupyterServerProvider,
} from "@vscode/jupyter-extension";
import { CancellationToken, ProviderResult } from "vscode";
import vscode from "vscode";
import { SubscriptionTier } from "../colab/api";
import { ColabClient } from "../colab/client";
import {
  NEW_SERVER,
  OPEN_COLAB_WEB,
  UPGRADE_TO_PRO,
} from "../colab/commands/constants";
import { openColabSignup, openColabWeb } from "../colab/commands/external";
import { ServerPicker } from "../colab/server-picker";
import { InputFlowAction } from "../common/multi-step-quickpick";
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
  onDidChangeServers: vscode.Event<void>;

  private readonly serverCollection: JupyterServerCollection;
  private readonly serverChangeEmitter: vscode.EventEmitter<void>;

  constructor(
    private readonly vs: typeof vscode,
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
    this.serverCollection = jupyter.createJupyterServerCollection(
      "colab",
      "Colab",
      this,
    );
    this.serverCollection.commandProvider = this;
    // TODO: Set `this.serverCollection.documentation` once docs exist.
  }

  dispose() {
    this.serverCollection.dispose();
  }

  /**
   * Provides the list of Colab {@link JupyterServer | Jupyter Servers} which
   * can be used.
   */
  provideJupyterServers(
    _token: CancellationToken,
  ): ProviderResult<JupyterServer[]> {
    return this.getUpdatedAssignedServers();
  }

  /**
   * Resolves the connection for the provided Colab {@link JupyterServer}.
   */
  resolveJupyterServer(
    server: JupyterServer,
    _token: CancellationToken,
  ): ProviderResult<JupyterServer> {
    if (!isUUID(server.id)) {
      throw new Error("Unexpected server ID format, expected UUID");
    }
    return this.getServer(server.id);
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
  provideCommands(
    _value: string | undefined,
    _token: CancellationToken,
  ): ProviderResult<JupyterServerCommand[]> {
    return this.provideRelevantCommands();
  }

  /**
   * Invoked when a command has been selected.
   *
   * @returns The newly assigned server or undefined if the command does not
   * create a new server.
   */
  // TODO: Determine why throwing a vscode.CancellationError does not dismiss
  // the kernel picker and instead just puts the Jupyter picker into a busy
  // (loading) state. Filed a GitHub issue on the Jupyter extension repo:
  // https://github.com/microsoft/vscode-jupyter/issues/16469
  //
  // TODO: Consider popping a notification if the `openExternal` call fails.
  handleCommand(
    command: JupyterServerCommand,
    _token: CancellationToken,
  ): ProviderResult<JupyterServer> {
    switch (command.label) {
      case NEW_SERVER.label:
        return this.assignServer().catch((err: unknown) => {
          // Returning `undefined` shows the previous UI (kernel picker).
          if (err === InputFlowAction.back) {
            return undefined;
          }
          throw err;
        });
      case OPEN_COLAB_WEB.label:
        openColabWeb(this.vs);
        return;
      case UPGRADE_TO_PRO.label:
        openColabSignup(this.vs);
        return;
      default:
        throw new Error("Unexpected command");
    }
  }

  private async getUpdatedAssignedServers(): Promise<JupyterServer[]> {
    await this.assignmentManager.reconcileAssignedServers();
    return await this.assignmentManager.getAssignedServers();
  }

  private async provideRelevantCommands(): Promise<JupyterServerCommand[]> {
    const commands = [NEW_SERVER, OPEN_COLAB_WEB];
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

  private async getServer(id: UUID): Promise<JupyterServer> {
    const assignedServers = await this.assignmentManager.getAssignedServers();
    const assignedServer = assignedServers.find((s) => s.id === id);
    if (!assignedServer) {
      throw new Error("Server not found");
    }
    return await this.assignmentManager.refreshConnection(assignedServer);
  }

  private async assignServer(): Promise<JupyterServer> {
    const serverType = await this.serverPicker.prompt(
      await this.assignmentManager.getAvailableServerDescriptors(),
    );
    if (!serverType) {
      throw new this.vs.CancellationError();
    }
    return this.assignmentManager.assignServer(randomUUID(), serverType);
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
