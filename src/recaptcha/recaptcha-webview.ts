/* eslint-disable @cspell/spellchecker */
//import * as vscode from "vscode";
import vscode from "vscode";

const V3SiteKey = "6LfQPtEUAAAAAHBpAdFng54jyuB1V5w5dofknpip";

export class RecaptchaWebview {
  private panel: vscode.WebviewPanel | undefined;
  private nextResponseId = 0; // I think theres an equivalent to this when they're doing generateUniqueCallback
  private responsePromises: Record<string, (resolve: string) => void> = {};

  constructor(
    private readonly vs: typeof vscode,
    private context: vscode.ExtensionContext,
  ) {}

  sendRequestAndWaitForResponse(command: string): Promise<string> {
    return new Promise((resolve) => {
      const responseId = String(this.nextResponseId++);
      this.responsePromises[responseId] = resolve;
      this.panel?.webview.postMessage({ command, responseId });
    });
  }

  show() {
    // Track the current panel with a webview
    const columnToShowIn = this.vs.window.activeTextEditor
      ? this.vs.window.activeTextEditor.viewColumn
      : undefined;

    if (this.panel) {
      // If we already have a panel, show it in the target column
      this.panel.reveal(columnToShowIn);
    } else {
      // Otherwise, create a new panel
      this.panel = this.vs.window.createWebviewPanel(
        "recaptcha",
        "Colab Recaptcha",
        columnToShowIn ?? this.vs.ViewColumn.One,
        {
          enableScripts: true,
        },
      );
      this.panel.webview.html = this.getWebviewContent();
      this.panel.webview.onDidReceiveMessage(
        (message) => {
          /* eslint-disable @typescript-eslint/no-unsafe-member-access */
          if (
            message.responseId &&
            message.responseId in this.responsePromises
          ) {
            // Resolve the recaptcha promise.
            this.responsePromises[message.responseId](String(message.token));
            // Close panel
            this.panel?.dispose();
          }
        },
        this,
        this.context.subscriptions,
      );

      // Reset when the current panel is closed
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      }, null);
    }
  }

  private getWebviewContent(): string {
    return `<!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <script src="https://www.google.com/recaptcha/api.js?render=${V3SiteKey}" async defer></script>
          <style>
              button {
                  padding: 10px 20px;
                  font-size: 16px;
              }
          </style>
      </head>
      <body>
          <button id="myButton">Click Me</button>
          <script>
              const vscode = acquireVsCodeApi();
              const button = document.getElementById('myButton');
              window.addEventListener('message', event => {
                const message = event.data;
                if (message.command === 'requestRecaptcha') {
                  const messageResponseId = message.responseId;
                  if (button) {
                    button.addEventListener('click', () => {
                      grecaptcha.ready(function() {
                        grecaptcha.execute('${V3SiteKey}', { action: 'submit' }).then(function(token) {
                          vscode.postMessage({
                            responseId: messageResponseId,
                            token: token
                          });
                        }).catch(e => {
                          console.log("grecaptcha errored with ", e);
                        });
                      });
                    });
                  }
                }
              });
          </script>
      </body>
      </html>`;
  }
}
