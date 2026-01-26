/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from 'vscode';
import { ColabClient } from '../colab/client';
import { log } from '../common/logging';
import { ColabAssignedServer } from '../jupyter/servers';

/**
 * Handles DriveFS authorization by triggering an OAuth consent flow and
 * propagating the credentials back to the Colab backend.
 *
 * (Random dummy code change)
 *
 * If the Colab server is already authorized, this function will skip the
 * consent flow and directly propagate the existing credentials.
 *
 * @param client - Colab API client to invoke the credentials propagation
 * @param server - Colab server information used for credentials propagation
 * @throws Error if authorization is cancelled or credentials propagation fails
 */
export async function handleDriveFsAuth(
  vs: typeof vscode,
  client: ColabClient,
  server: ColabAssignedServer,
): Promise<void> {
  // Dry run to check if authorization is needed.
  const dryRunResult = await client.propagateDriveCredentials(server.endpoint, {
    authType: 'dfs_ephemeral',
    dryRun: true,
  });
  log.trace('Drive credentials propagation dry run:', dryRunResult);

  if (dryRunResult.success) {
    // Already authorized; propagate credentials directly.
    await propagateCredentials(client, server.endpoint);
  } else if (dryRunResult.unauthorizedRedirectUri) {
    // Need to obtain user consent and then propagate credentials.
    const userConsentObtained = await obtainUserAuthConsent(
      vs,
      dryRunResult.unauthorizedRedirectUri,
      server.label,
    );
    if (!userConsentObtained) {
      throw new Error('User cancelled Google Drive authorization');
    }
    await propagateCredentials(client, server.endpoint);
  } else {
    // Not already authorized and no auth consent URL returned. This
    // technically shouldn't happen, but just in case.
    throw new Error(
      `Credentials propagation dry run returned unexpected results: ${JSON.stringify(dryRunResult)}`,
    );
  }
}

async function obtainUserAuthConsent(
  vs: typeof vscode,
  unauthorizedRedirectUri: string,
  serverLabel: string,
): Promise<boolean> {
  const yes = 'Connect to Google Drive';
  const consent = await vs.window.showInformationMessage(
    `Permit "${serverLabel}" to access your Google Drive files?`,
    {
      modal: true,
      detail:
        'This Colab server is requesting access to your Google Drive files. Granting access to Google Drive will permit code executed in the Colab server to modify files in your Google Drive. Make sure to review notebook code prior to allowing this access.',
    },
    yes,
  );
  if (consent === yes) {
    await vs.env.openExternal(vs.Uri.parse(unauthorizedRedirectUri));

    const ctn = 'Continue';
    const selection = await vs.window.showInformationMessage(
      'Please complete the authorization in your browser. Only once done, click "Continue".',
      { modal: true },
      ctn,
    );
    if (selection === ctn) {
      return true;
    }
  }
  return false;
}

async function propagateCredentials(
  client: ColabClient,
  endpoint: string,
): Promise<void> {
  const propagationResult = await client.propagateDriveCredentials(endpoint, {
    authType: 'dfs_ephemeral',
    dryRun: false,
  });
  log.trace('Drive credentials propagation:', propagationResult);

  if (!propagationResult.success) {
    throw new Error('Credentials propagation unsuccessful');
  }
}
