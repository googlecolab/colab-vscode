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
import { ServerPicker } from "../colab/server-picker";
import { InputFlowAction } from "../common/multi-step-quickpick";
import { isUUID } from "../utils/uuid";
import { AssignmentManager } from "./assignments";

const NEW_COLAB_SERVER_LABEL = "$(add) New Colab Server";
const OPEN_COLAB_WEB_LABEL = "$(ports-open-browser-icon) Open Colab Web";
const UPGRADE_TO_PRO_LABEL = "$(accounts-view-bar-icon) Upgrade to Pro";

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

  constructor(
    private readonly vs: typeof vscode,
    private readonly assignmentManager: AssignmentManager,
    private readonly serverPicker: ServerPicker,
    jupyter: Jupyter,
  ) {
    this.onDidChangeServers = this.assignmentManager.onDidAssignmentsChange;
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
   * Provides the list of Colab {@link JupyterServer Jupyter Servers} which can
   * be used.
   */
  provideJupyterServers(
    _token: CancellationToken,
  ): ProviderResult<JupyterServer[]> {
    return this.assignmentManager.assignedServers();
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
  provideCommands(
    _value: string | undefined,
    _token: CancellationToken,
  ): ProviderResult<JupyterServerCommand[]> {
    return [
      {
        label: NEW_COLAB_SERVER_LABEL,
        description: "CPU, GPU or TPU.",
      },
      {
        label: OPEN_COLAB_WEB_LABEL,
        description: "Open Colab web.",
      },
      {
        label: UPGRADE_TO_PRO_LABEL,
        description: "More machines, more quota, more Colab!",
      },
    ];
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
      case NEW_COLAB_SERVER_LABEL:
        return this.assignServer().catch((err: unknown) => {
          // Returning `undefined` shows the previous UI (kernel picker).
          if (err === InputFlowAction.back) {
            return undefined;
          }
          throw err;
        });
      case OPEN_COLAB_WEB_LABEL:
        this.vs.env.openExternal(
          this.vs.Uri.parse("https://colab.research.google.com"),
        );
        return;
      case UPGRADE_TO_PRO_LABEL:
        this.vs.env.openExternal(
          this.vs.Uri.parse("https://colab.research.google.com/signup"),
        );
        return;
      default:
        throw new Error("Unexpected command");
    }
  }

  private async getServer(id: UUID): Promise<JupyterServer> {
    const assignedServers = await this.assignmentManager.assignedServers();
    const assignedServer = assignedServers.find((s) => s.id === id);
    if (!assignedServer) {
      throw new Error("Server not found");
    }
    return await this.assignmentManager.refreshConnection(assignedServer);
  }

  private async assignServer(): Promise<JupyterServer> {
    const serverType = await this.serverPicker.prompt(
      await this.assignmentManager.availableServers(),
    );
    if (!serverType) {
      throw new this.vs.CancellationError();
    }
    return this.assignmentManager.assignServer(randomUUID(), serverType);
  }
}
