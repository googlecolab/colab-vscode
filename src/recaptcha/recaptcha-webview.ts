/* eslint-disable @/max-len */
/* eslint-disable @typescript-eslint/array-type */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
//import {trustedResourceUrl} from 'safevalues'
//import {setScriptSrc} from 'safevalues/dom'
import * as vscode from 'vscode';

const V3SiteKey = "6LfQPtEUAAAAAHBpAdFng54jyuB1V5w5dofknpip"

export class RecaptchaWebview {
  private panel: vscode.WebviewPanel | undefined;
  private context: vscode.ExtensionContext;
  private readonly loadPromises: Array<Promise<void>> = [];
  private evaluatingV2 = false;
  private tokenResult: string | undefined;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    //this.loadPromises.push(this.load())
  }

  showjslkfj() {
    console.log("ajslkfjalskjf ")
  }

  recaptchaToken(): string | undefined {
    return this.tokenResult
  }

  show() {
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
            if (message.command === 'verifyRecaptcha') {
                // Handle the token (e.g., send to your server for verification)
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                console.log('Received reCAPTCHA token:', message.token);
                this.tokenResult = message.token
                // Close panel
                this.panel?.dispose();
            }
        },
        undefined,
        this.context.subscriptions
    );
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
              if (button) {
                  button.addEventListener('click', () => {
                  grecaptcha.ready(function() {
          grecaptcha.execute('${V3SiteKey}', {action: 'submit'}).then(function(token) {
                      vscode.postMessage({ command: 'verifyRecaptcha',
                                           token: token });
          });
        });
                  });
              }
          </script>
      </body>
      </html>`;
    }
}
//   private getWebviewContent(): string {
//      const renderKey = 'explicit'
//      //const callbackName = `recaptchaCallback${getNonce().replace(/-/g, '')}`;
//      const callbackName = 'hackyTempCallback'
//      const src = trustedResourceUrl`https://www.google.com/recaptcha/api.js?trustedtypes=true&onload=${callbackName}&render=${renderKey}`;
//      return `
// <!DOCTYPE html>
//             <html lang="en">
//             <head>
//                 <meta charset="UTF-8">
//                 <meta name="viewport" content="width=device-width, initial-scale=1.0">
//                 <title>reCAPTCHA Example</title>
//                 <script>
//                  function hackyTempCallback(token) {
//                    console.log("grecaptcha is ready!")
//                    console.log('WebView origin:', window.location.origin);
//                    console.log('WebView hostname:', window.location.hostname);
//                    console.log('WebView protocol:', window.location.protocol);
//                    grecaptcha.render('html_element', {
//                      'sitekey' : '6LfQttQUAAAAADuPanA_VZMaZgBAOnHZNuuqUewp'
//                    });
//                  }
//                 </script>
//             </head>
//             <body>
//            <form action="?" method="POST">
//              <div id="html_element"></div>
//              <br>
//              <input type="submit" value="Submit">
//            </form> 
//             <script src="${src.toString()}" async defer></script>
//             </body>
//             </html>
//      `
//    }
//   }
//     return `
// <!DOCTYPE html>
//             <html lang="en">
//             <head>
//                 <meta charset="UTF-8">
//                 <meta name="viewport" content="width=device-width, initial-scale=1.0">
//                 <title>reCAPTCHA Example</title>
//                 <script src="${src.toString()}" async defer></script>
//                 <script>
//                     function onSubmit(token) {
//                         document.getElementById("recaptcha-form").submit();                     }
//                     window.addEventListener('message', event => {
//                         const message = event.data;
//                         console.log("message? ", message)
//                         vscode.postMessage({ command: 'evaluateRecaptcha', message})
//                         if (message.command === 'verifyRecaptcha') {
//                             grecaptcha.execute();                         }
//                     });
//                 </script>
//             </head>
//             <body>
//                 <form id="recaptcha-form" method="POST">
//                     <button class="g-recaptcha" data-sitekey="6LfQttQUAAAAADuPanA_VZMaZgBAOnHZNuuqUewp" data-callback='onSubmit'>Submit</button>
//                 </form>
//             </body>
//             </html>`;   }


// private getWebviewContent() {
//
//    // Construct the HTML content with a button to initiate reCAPTCHA
//    return `<!DOCTYPE html>
//    <html lang="en">
//    <head>
//        <meta charset="UTF-8">
//        <meta name="viewport" content="width=device-width, initial-scale=1.0">
//        <title>Authentication</title>
//    </head>
//    <body>
//        <h1>Authentication Required</h1>
//        <button id="recaptchaButton">Initiate reCAPTCHA</button>
//        <div id="verificationStatus"></div>
//
//        <script>
//            const recaptchaButton = document.getElementById('recaptchaButton');
//            const verificationStatus = document.getElementById('verificationStatus');
//            recaptchaButton.addEventListener('click', () => {
//                //vscode.postMessage({ command: 'initiateRecaptcha' });
//                verificationStatus.textContent = 'Waiting for reCAPTCHA...';
//            });
//
//            // In a real v2 implementation, you'd have a mechanism (e.g., a local web server
//            // or a deep link) to receive the token back after the user completes the challenge
//            // in the external browser and then post it back to the extension.
//
//            // This is a simplified example for demonstration. For a real v2 setup,
//            // you'd need a more complex flow involving an external browser and a way
//            // to communicate the result back to the extension.
//
//            // For v3, your backend would handle the risk assessment, and this WebView
//            // might send user activity data or receive a status update.
//
//            window.addEventListener('message', event => {
//                const message = event.data;
//                switch (message.command) {
//                case 'verificationResult':
//                    if (message.success) {
//                        verificationStatus.textContent = 'Authentication successful!';
//                    } else {
//                        verificationStatus.textContent = 'Authentication failed.';
//                    }
//      
//            });
//        </script>
//    </body>
//    </html>`;
//}

//}


// /**
//  * @return A unique UUID that is RFC4122 version 4 compliant and uses
//  * the timestamp to lower chance of collisions.
//  */
// export function uuid4(): string {
//   let ts = Date.now();
//   const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
//   return uuid.replace(/[xy]/g, (c) => {
//     let r = (ts + Math.randomInt(16)) % 16;
//     ts = math.safeFloor(ts / 16);
//     if (c === 'y') {
//       r = (r & 0x7) | 0x8;
//     }
//     return r.toString(16);
//   });

//  function getNonce():string {
//    let text = '';
//    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
//    for (let i = 0; i < 32; i++) {
//        text += possible.charAt(Math.floor(Math.random() * possible.length));
//    }
//    return text;
//}