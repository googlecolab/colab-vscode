/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import { CodeChallengeMethod, GenerateAuthUrlOpts } from 'google-auth-library';
import { OAuth2Client } from 'google-auth-library';
import vscode from 'vscode';
import { PackageInfo } from '../../config/package-info';
import { buildExtensionUri } from '../../system/uri';
import { LocalServerFlow } from './loopback';
import { ProxiedRedirectFlow } from './proxied';

/**
 * Options for triggering an OAuth2 flow.
 */
export interface OAuth2TriggerOptions {
  /** Fired when the flow should be cancelled. */
  readonly cancel: vscode.CancellationToken;
  /** A unique nonce to correlate the request and response. */
  readonly nonce: string;
  /** The scopes the flow should authorize for. */
  readonly scopes: string[];
  /** The PKCE challenge string which if specific should be included with the auth request. */
  readonly pkceChallenge?: string;
  /** Whether to include granted scopes in the new request. */
  readonly includeGrantedScopes?: boolean;
  /** The login hint to pre-fill the email (for incremental authorization). */
  readonly loginHint?: string;
  /**
   * Influences how the user is presented with the consent dialog.
   *
   * If the value is "consent" - the consent dialog is forced to be displayed
   * every time, even if the user has previously granted access.
   * If the value is not specified - the consent dialog defaults to its default
   * e.g., it only shows for the scopes the user did not already consent to.
   *
   * This should always be "consent" unless `includeGrantedScopes` is `true`
   * to allow for incremental auth.
   */
  readonly prompt?: 'consent';
}

/**
 * The result of an OAuth2 flow.
 */
export interface FlowResult {
  /** The authorization code obtained from the OAuth2 flow. */
  code: string;
  /** The redirect URI that should be used following token retrieval. */
  redirectUri?: string;
}

/**
 * An OAuth2 flow that can be triggered to obtain an authorization code.
 */
export interface OAuth2Flow {
  /** Triggers the OAuth2 flow. */
  trigger(options: OAuth2TriggerOptions): Promise<FlowResult>;
  /** Disposes of the flow and cleans up owned resources. */
  dispose?(): void;
}

export const DEFAULT_AUTH_URL_OPTS: GenerateAuthUrlOpts = {
  access_type: 'offline',
  response_type: 'code',
  code_challenge_method: CodeChallengeMethod.S256,
};

/**
 * Returns the supported OAuth2 flows based on the environment in which the
 * extension is running.
 *
 * @param vs - The VS Code API instance.
 * @param packageInfo - Information about the extension package.
 * @param oAuth2Client - The OAuth2 client instance.
 * @returns The supported OAuth2 flows.
 */
export function getOAuth2Flows(
  vs: typeof vscode,
  packageInfo: PackageInfo,
  oAuth2Client: OAuth2Client,
): OAuth2Flow[] {
  const extensionUri = buildExtensionUri(vs, packageInfo);
  const flows: OAuth2Flow[] = [];
  if (vs.env.uiKind === vs.UIKind.Desktop) {
    flows.push(
      new LocalServerFlow(
        vs,
        path.join(__dirname, 'auth/media'),
        oAuth2Client,
        extensionUri,
      ),
    );
  }
  flows.push(new ProxiedRedirectFlow(vs, oAuth2Client, extensionUri));
  return flows;
}
