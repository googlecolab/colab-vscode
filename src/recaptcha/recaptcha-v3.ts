/* eslint-disable @/max-len */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-invalid-void-type */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import {load} from 'recaptcha-v3'
import {trustedResourceUrl} from 'safevalues';
import {setScriptSrc} from 'safevalues/dom';
import * as vscode from 'vscode';

//import {uuid} from 'uuid'
const V3SiteKey = "6LfQPtEUAAAAAHBpAdFng54jyuB1V5w5dofknpip"

export class RecaptchaService extends EventTarget {
    //private readonly loadPromises: Promise<void>[] = [];
    constructor() {
        super();
        //this.loadPromises.push(this.load(V3SiteKey));
        console.log("done with constructor")
    }

//    private async load(renderKey: string): Promise<void> {
//    const {readyToRenderPromise, callbackName} = this.generateUniqueCallback();
//    const script = vscode.window.createElement('script');
//
//    const src = trustedResourceUrl`https://www.google.com/recaptcha/api.js?trustedtypes=true&onload=${callbackName}&render=${renderKey}`;
//    setScriptSrc(script, src);
//
//    await new Promise((resolve, reject) => {
//      script.onload = resolve;
//      script.onerror = reject;
//      document.head.appendChild(script);
//    });
//
//    await readyToRenderPromise;
//  }

  async evaluate(
    action: string,
  ): Promise<string> {

    // Make sure all the recaptcha scripts have been loaded and set.
   // await Promise.all(this.loadPromises);

    return this.evaluateV3(action)
  }

  private async evaluateV3(action:string): Promise<string> {
    console.log("IN EVALUAGE v3")
    let token = null;
    try {
    const recaptcha = await load(V3SiteKey)
    token = await recaptcha.execute(action)
    } catch (e: unknown) {
      const stack = e instanceof Error ? e.stack : '';
      console.log("stak??? ? ? ? ? ", stack)
    }
    console.log("AFTER AWAITS")
    if (!token) {
        console.log("NO TOKENENAKLSDFJAK")
        throw new Error('v3: No token found!')
    } else {
        console.log("HAS TOKEN", token)
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return token
    }
  }
//  private async evaluateV3(action: string): Promise<string> {
//    if (typeof grecaptcha !== 'undefined') {
//    const siteKey = V3SiteKey
//    try {
//      await new Promise((resolve) => {
//        grecaptcha.ready(resolve);
//      });
//    } catch (e: unknown) {
//      const stack = e instanceof Error ? e.stack : '';
//      throw new Error(
//        `v3: Recaptcha failed to initialize. Stack: ${stack}\n\n Error: ${e}`,
//      );
//    }
//
//    let token: string | void;
//    try {
//      token = await grecaptcha.execute(siteKey, {action});
//    } catch (e: unknown) {
//      const stack = e instanceof Error ? e.stack : '';
//      throw new Error(
//        `v3: Unable to generate token. Stack: ${stack}\n\n Error: ${e}`,
//      );
//    }
//    if (!token) {
//      throw new Error('v3: No token found!');
//    }
//    return token;
//    } else {
//        throw new Error('grecaptcha never loaded')
//    }
//  }

  private generateUniqueCallback(): RecaptchaPublicCallback {
    // This is an intentionally cast to 'any', as we're creating unique
    // callbacks on the window for each load.
       // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const untypedWindow = vscode.window as any;
    // Callback name must not begin with a numeric character or have dashes in
    // it.
    // NOTE THIS ACTUALLY LOOKS DIFFERENT IN RECAPTCHA.TS BUT IDK WHY UUID ISN'T
    // IMPORTING
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    const callbackName = `recaptchaCallback${getNonce().replace(/-/g, '')}`;
    const readyToRenderPromise = new Promise((resolve) => {
      untypedWindow[callbackName] = resolve;
    });
    return {readyToRenderPromise, callbackName};
  }
}
interface RecaptchaPublicCallback {
    readyToRenderPromise: Promise<unknown>;
    callbackName: string;
  }

  function getNonce():string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
