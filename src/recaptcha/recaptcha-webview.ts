/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/* eslint-disable @/max-len */
/* eslint-disable @typescript-eslint/array-type */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
//import {trustedResourceUrl} from 'safevalues'
//import {setScriptSrc} from 'safevalues/dom'
import * as vscode from 'vscode';


const V3SiteKey = "6LfQPtEUAAAAAHBpAdFng54jyuB1V5w5dofknpip"

// something something
// 1. dispatch a message in the webview when the recaptcha button is clicked.
//    Can/should be added in  the getWebViewContents function?
// 2. Add an event listener in the client that once the message from the
//    recaptcha is caught, closes the webview and also calls postAssignment with
//    the recaptcha token.
// 3. Check in backend if we need to 
export class RecaptchaWebview {
  private panel: vscode.WebviewPanel | undefined;
  private context: vscode.ExtensionContext;
  private readonly loadPromises: Array<Promise<void>> = [];
  private evaluatingV2 = false;
  private tokenResult = '';
  private recaptchaTokenListeners: ((newValue: string) => unknown)[] = [];
  private nextResponseId = 0; // I think theres an equivalent to this when they're doing generateUniqueCallback
  private responsePromises: Record<string, (data: any) => void> = {};

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    //this.loadPromises.push(this.load())
  }

  showjslkfj() {
    console.log("ajslkfjalskjf ")
  }

  recaptchaToken(): string  {
    return this.tokenResult
  }

  onTokenChange(listener: (newValue: string) => unknown) {
    this.recaptchaTokenListeners.push(listener)
  }
  
  updateToken(newValue: string) {
    this.tokenResult = newValue
    console.log("UPDATED TOKENA ND NOW SHOOTING OFF THE LISTENERS...")
    this.recaptchaTokenListeners.forEach(listener => { listener(this.tokenResult); })
  }

  deleteListeners() {
    this.recaptchaTokenListeners = []
  }

  sendRequestAndWaitForResponse(
    command: string,
    data?: any
  ): Promise<string> {
    console.log("IN REQUEST ASJKLDFALKSDJ ", command)
    return new Promise((resolve) => {
      const responseId = String(this.nextResponseId++);
      this.responsePromises[responseId] = resolve;
      this.panel?.webview.postMessage({command, ...data, responseId})
    })
  }

  show(){
  // Track the current panel with a webview
         const columnToShowIn = vscode.window.activeTextEditor
        ? vscode.window.activeTextEditor.viewColumn
        : undefined;

      if (this.panel) {
        // If we already have a panel, show it in the target column
        this.panel.reveal(columnToShowIn);
      } else {
        // Otherwise, create a new panel
        this.panel= vscode.window.createWebviewPanel(
          'recaptcha',
          'Cat Coding',
          columnToShowIn ?? vscode.ViewColumn.One,
          {
            enableScripts: true
          }
        );
        this.panel.webview.html = this.getWebviewContent();
        this.panel.webview.onDidReceiveMessage(
        (message) => {
          console.log('AAAAAAAAAAAA got a message', message)
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            if (message.responseId && message.responseId in this.responsePromises) {
              console.log('Received reCAPTCHA token from id:', message.token, message.responseId);
              this.responsePromises[message.responseId](message.token);
              //delete this.responsePromises[message.responseId];
              // Close panel
              this.panel?.dispose();
              }
          },
        undefined,
        this.context.subscriptions);

        // Reset when the current panel is closed
        this.panel.onDidDispose(
          () => {
            this.panel= undefined;
          },
          null,
        );
      }
    }

    private getWebviewContent(): string {
      return `<!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <script src="https://www.google.com/recaptcha/api.js?render=${V3SiteKey}" async defer></script>
          <title>Button Webview</title>
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
                      console.log("grecaptcha?? ", grecaptcha)
                      grecaptcha.ready(function() {
                        grecaptcha.execute('${V3SiteKey}', { action: 'submit' }).then(function(token) {
                          vscode.postMessage({
                            responseId: messageResponseId,
                            token: token
                          });
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