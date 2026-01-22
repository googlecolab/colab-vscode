/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { v4 as uuid } from 'uuid';
import vscode from 'vscode';
import WebSocket from 'ws';
import { ColabClient } from '../colab/client';
import { log } from '../common/logging';
import { ColabAssignedServer } from '../jupyter/servers';

/**
 * Colab's `input_reply` message format for replying to Drive auth requests.
 */
export interface ColabInputReplyMessage {
  msg_id: string;
  msg_type: 'input_reply';
  header: {
    msg_id: string;
    msg_type: 'input_reply';
    session: string;
    version: string;
  };
  content: {
    value: {
      type: 'colab_reply';
      colab_msg_id: number;
      error?: string;
    };
  };
  channel: 'stdin';
  metadata: object;
  parent_header: object;
}

/**
 * Handles DriveFS authorization by triggering an OAuth consent flow,
 * propagating the credentials back to the Colab backend, and sending a reply
 * message to the Colab kernel via the provided WebSocket handle.
 *
 * If the Colab server is already authorized, this function will skip the
 * consent flow and directly propagate the existing credentials.
 *
 * @param socket - Active WebSocket handle to send the reply message to Colab
 *   kernel
 * @param client - Colab API client to invoke the credentials propagation
 * @param server - Colab server information used for credentials propagation
 * @param requestMessageId - The Colab auth request message ID to correlate the
 *   reply message to
 */
export async function handleDriveFsAuth(
  vs: typeof vscode,
  socket: WebSocket,
  client: ColabClient,
  server: ColabAssignedServer,
  requestMessageId: number,
): Promise<void> {
  try {
    // Dry run to check if authorization is needed.
    const dryRunResult = await client.propagateDriveCredentials(
      server.endpoint,
      {
        authType: 'dfs_ephemeral',
        dryRun: true,
      },
    );
    log.trace('Drive credentials propagation dry run:', dryRunResult);

    if (dryRunResult.success) {
      // Already authorized; propagate credentials directly.
      await propagateCredentialsAndSendReply(
        socket,
        client,
        server.endpoint,
        requestMessageId,
      );
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
      await propagateCredentialsAndSendReply(
        socket,
        client,
        server.endpoint,
        requestMessageId,
      );
    } else {
      // Not already authorized and no auth consent URL returned. This
      // technically shouldn't happen, but just in case.
      throw new Error(
        `Credentials propagation dry run returned unexpected results: ${JSON.stringify(dryRunResult)}`,
      );
    }
  } catch (e: unknown) {
    log.error('Failed handling DriveFS auth propagation', e);
    sendDriveFsAuthReply(
      socket,
      requestMessageId,
      /* err= */ e instanceof Error
        ? e.message
        : typeof e === 'string'
          ? e
          : 'unknown error',
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

async function propagateCredentialsAndSendReply(
  socket: WebSocket,
  client: ColabClient,
  endpoint: string,
  requestMessageId: number,
): Promise<void> {
  const propagationResult = await client.propagateDriveCredentials(endpoint, {
    authType: 'dfs_ephemeral',
    dryRun: false,
  });
  log.trace('Drive credentials propagation:', propagationResult);

  if (!propagationResult.success) {
    throw new Error('Credentials propagation unsuccessful');
  }
  sendDriveFsAuthReply(socket, requestMessageId);
}

function sendDriveFsAuthReply(
  socket: WebSocket,
  requestMessageId: number,
  err?: string,
) {
  const replyMsgId = uuid();
  const replyMsgType = 'input_reply';
  const replyMessage: ColabInputReplyMessage = {
    msg_id: replyMsgId,
    msg_type: replyMsgType,
    header: {
      msg_id: replyMsgId,
      msg_type: replyMsgType,
      session: uuid(),
      version: '5.0',
    },
    content: {
      value: {
        type: 'colab_reply',
        colab_msg_id: requestMessageId,
      },
    },
    channel: 'stdin',
    // The following fields are required but can be empty.
    metadata: {},
    parent_header: {},
  };

  if (err) {
    replyMessage.content.value.error = err;
  }

  socket.send(JSON.stringify(replyMessage));
  log.trace('Input reply message sent:', replyMessage);
}
