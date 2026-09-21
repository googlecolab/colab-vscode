/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from 'vscode';
import { ColabClient } from '../colab/client/v1';
import { AuthType } from '../colab/client/v1/api';
import { UserCancelledError } from '../common/cancellation';
import { log } from '../common/logging';
import { ColabAssignedServer } from '../jupyter/servers';
import { telemetry } from '../telemetry';

/**
 * Handles ephemeral authorization by triggering an OAuth consent flow and
 * propagating the credentials back to the Colab backend.
 *
 * If the Colab server is already authorized, this function will skip the
 * consent flow and directly propagate the existing credentials.
 *
 * @param vs - The VS Code API instance.
 * @param apiClient - Colab API client to invoke the credentials propagation
 * @param server - Colab server information used for credentials propagation
 * @param authType - The type of authentication flow.
 * @throws A {@link UserCancelledError} if the user declined authorization, or
 * an Error if credentials propagation fails.
 */
export async function handleEphemeralAuth(
  vs: typeof vscode,
  apiClient: ColabClient,
  server: ColabAssignedServer,
  authType: AuthType,
): Promise<void> {
  telemetry.logHandleEphemeralAuth(authType);

  // Dry run to check if authorization is needed.
  const redirectUri = await apiClient.propagateCredentials(server.endpoint, {
    authType,
    dryRun: true,
  });
  log.trace(`[${authType}] Credentials propagation dry run:`, redirectUri);

  if (redirectUri) {
    // Need to obtain user consent and then propagate credentials.
    const userConsentObtained = await obtainUserAuthConsent(
      vs,
      authType,
      redirectUri,
      server.label,
    );
    if (!userConsentObtained) {
      throw new UserCancelledError(`User cancelled ${authType} authorization`);
    }
  }

  await propagateCredentials(apiClient, server.endpoint, authType);
}

async function obtainUserAuthConsent(
  vs: typeof vscode,
  authType: AuthType,
  unauthorizedRedirectUri: string,
  serverLabel: string,
): Promise<boolean> {
  let message: string;
  let detail: string;
  let yesText: string;
  switch (authType) {
    case AuthType.DFS_EPHEMERAL:
      message = `Permit "${serverLabel}" to access your Google Drive files?`;
      detail =
        'This Colab server is requesting access to your Google Drive files. Granting access to Google Drive will permit code executed in the Colab server to modify files in your Google Drive. Make sure to review notebook code prior to allowing this access.';
      yesText = 'Connect to Google Drive';
      break;

    case AuthType.AUTH_USER_EPHEMERAL:
      message = `Allow "${serverLabel}" to access your Google credentials?`;
      detail =
        'This will allow code executed in the Colab server to access your Google Drive and Google Cloud data. Review the code in this notebook prior to allowing access.';
      yesText = 'Allow';
      break;

    default:
      throw new Error(`Unsupported auth type: ${String(authType)}`);
  }

  const consent = await vs.window.showInformationMessage(
    message,
    { detail, modal: true },
    yesText,
  );
  if (consent === yesText) {
    await vs.env.openExternal(vs.Uri.parse(unauthorizedRedirectUri));

    const continueText = 'Continue';
    const selection = await vs.window.showInformationMessage(
      'Please complete the authorization in your browser. Only once done, click "Continue".',
      { modal: true },
      continueText,
    );
    if (selection === continueText) {
      return true;
    }
  }
  return false;
}

async function propagateCredentials(
  apiClient: ColabClient,
  endpoint: string,
  authType: AuthType,
): Promise<void> {
  const redirectUri = await apiClient.propagateCredentials(endpoint, {
    authType,
    dryRun: false,
  });
  log.trace(`[${authType}] credentials propagation:`, redirectUri);

  if (redirectUri) {
    // User consent was obtained, but the server still reports the credentials
    // as unauthorized.
    throw new Error(
      `[${authType}] Credentials propagation unsuccessful: the server still reports the credentials as unauthorized`,
    );
  }
}
