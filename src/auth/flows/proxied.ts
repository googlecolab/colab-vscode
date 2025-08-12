/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OAuth2Client } from "google-auth-library";
import vscode from "vscode";
import { CONFIG } from "../../colab-config";
import { PackageInfo } from "../../config/package-info";
import { ExtensionUriHandler } from "../../system/uri-handler";
import { CodeManager } from "../code-manager";
import {
  DEFAULT_AUTH_URL_OPTS,
  OAuth2Flow,
  OAuth2TriggerOptions,
  FlowResult,
} from "./flows";

const PROXIED_REDIRECT_URI = `${CONFIG.ColabApiDomain}/vscode/redirect`;

export class ProxiedRedirectFlow implements OAuth2Flow, vscode.Disposable {
  private readonly baseUri: string;
  private readonly codeManager = new CodeManager();

  constructor(
    private readonly vs: typeof vscode,
    private readonly packageInfo: PackageInfo,
    private readonly oAuth2Client: OAuth2Client,
    private readonly uriHandler: ExtensionUriHandler,
  ) {
    const scheme = this.vs.env.uriScheme;
    const pub = this.packageInfo.publisher;
    const name = this.packageInfo.name;
    this.baseUri = `${scheme}://${pub}.${name}`;
  }

  dispose() {
    this.codeManager.dispose();
  }

  async trigger(options: OAuth2TriggerOptions): Promise<FlowResult> {
    const listener = this.uriHandler.onReceivedUri((uri: vscode.Uri) => {
      const params = new URLSearchParams(uri.query);
      const nonce = params.get("nonce");
      const code = params.get("code");
      if (!nonce || !code) {
        // A request for `vscode://google.colab` without a code or nonce (while
        // the user's in the authentication flow) is possible and should be
        // ignored.
        return;
      }
      this.codeManager.resolveCode(nonce, code);
    });
    try {
      const code = this.codeManager.waitForCode(options.nonce, options.cancel);
      const vsCodeRedirectUri = this.vs.Uri.parse(
        `${this.baseUri}?nonce=${options.nonce}`,
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
      return { code: await code, redirectUri: PROXIED_REDIRECT_URI };
    } finally {
      listener.dispose();
    }
  }
}
