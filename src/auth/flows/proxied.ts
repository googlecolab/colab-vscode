/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OAuth2Client } from "google-auth-library";
import vscode from "vscode";
import { CONFIG } from "../../colab-config";
import {
  MultiStepInput,
  InputFlowAction,
} from "../../common/multi-step-quickpick";
import { CodeManager } from "../code-manager";
import {
  DEFAULT_AUTH_URL_OPTS,
  OAuth2Flow,
  OAuth2TriggerOptions,
  FlowResult,
} from "./flows";

const PROXIED_REDIRECT_URI = `${CONFIG.ColabApiDomain}/vscode/redirect`;

export class ProxiedRedirectFlow implements OAuth2Flow, vscode.Disposable {
  private readonly codeManager = new CodeManager();

  constructor(
    private readonly vs: typeof vscode,
    private readonly oAuth2Client: OAuth2Client,
    private readonly extensionUri: string,
  ) {}

  dispose() {
    this.codeManager.dispose();
  }

  async trigger(options: OAuth2TriggerOptions): Promise<FlowResult> {
    const cancelTokenSource = new this.vs.CancellationTokenSource();
    options.cancel.onCancellationRequested(() => {
      cancelTokenSource.cancel();
    });
    try {
      const code = this.codeManager.waitForCode(
        options.nonce,
        cancelTokenSource.token,
      );
      const vsCodeRedirectUri = this.vs.Uri.parse(
        `${this.extensionUri}?nonce=${options.nonce}`,
      );
      const externalProxiedRedirectUri =
        await this.vs.env.asExternalUri(vsCodeRedirectUri);
      const authUrl = this.oAuth2Client.generateAuthUrl({
        ...DEFAULT_AUTH_URL_OPTS,
        redirect_uri: PROXIED_REDIRECT_URI,
        state: externalProxiedRedirectUri.toString(),
        scope: options.scopes,
        code_challenge: options.pkceChallenge,
      });

      await this.vs.env.openExternal(this.vs.Uri.parse(authUrl));
      this.promptForAuthorizationCode(options.nonce, cancelTokenSource);
      return { code: await code, redirectUri: PROXIED_REDIRECT_URI };
    } finally {
      cancelTokenSource.dispose();
    }
  }

  private promptForAuthorizationCode(
    nonce: string,
    cancelTokenSource: vscode.CancellationTokenSource,
  ) {
    void MultiStepInput.run(this.vs, async (input) => {
      try {
        const pastedCode = await input.showInputBox({
          buttons: undefined,
          ignoreFocusOut: true,
          password: true,
          prompt: "Enter your authorization code",
          title: "Sign in to Google",
          validate: (value: string) => {
            return value.length === 0
              ? "Authorization code cannot be empty"
              : undefined;
          },
          value: "",
        });
        this.codeManager.resolveCode(nonce, pastedCode);
        return undefined;
      } catch (e) {
        if (e === InputFlowAction.cancel) {
          cancelTokenSource.cancel();
          return;
        }
        throw e;
      }
    });
  }
}
