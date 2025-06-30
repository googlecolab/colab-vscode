import vscode from "vscode";

/**
 * A {@link vscode.UriHandler} for handling custom URI events within the
 * extension.
 *
 * This class can be registered to process URIs that are directed to the
 * extension, enabling deep-linking and custom command execution via URI
 * activation.
 *
 * @see https://code.visualstudio.com/api/references/vscode-api#UriHandler
 */
export class ExtensionUriHandler
  implements vscode.UriHandler, vscode.Disposable
{
  /** An event that subscribes the listener to {@link vscode.Uri} invocations to
   * the extension. */
  readonly onReceivedUri: vscode.Event<vscode.Uri>;
  private readonly uriEmitter: vscode.EventEmitter<vscode.Uri>;

  constructor(vs: typeof vscode) {
    this.uriEmitter = new vs.EventEmitter<vscode.Uri>();
    this.onReceivedUri = this.uriEmitter.event;
  }

  dispose() {
    this.uriEmitter.dispose();
  }

  /**
   * Emits a {@link vscode.Uri} event when a URI is handled.
   *
   * Callers can call {@link onReceivedUri} to listen for these events.
   */
  handleUri(uri: vscode.Uri): vscode.ProviderResult<void> {
    this.uriEmitter.fire(uri);
  }
}
