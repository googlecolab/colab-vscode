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

export async function handleDriveFsAuth(
  vs: typeof vscode,
  socket: WebSocket,
  client: ColabClient,
  endpoint: string,
  requestMessageId: number,
) {
  const fileId = vs.window.activeNotebookEditor?.notebook.uri.path ?? '';
  const dryRunResult = await client.propagateDriveCredentials(endpoint, {
    authType: 'dfs_ephemeral',
    fileId,
    dryRun: true,
  });

  if (dryRunResult.success) {
    await propagateCredentialsAndSendReply(
      socket,
      client,
      endpoint,
      fileId,
      requestMessageId,
    );
    return;
  }

  if (dryRunResult.unauthorizedRedirectUri) {
    const yes = 'Connect to Google Drive';
    const consent = await vs.window.showInformationMessage(
      'Permit this notebook to access your Google Drive files?',
      {
        modal: true,
        detail:
          'This notebook is requesting access to your Google Drive files. Granting access to Google Drive will permit code executed in the notebook to modify files in your Google Drive. Make sure to review notebook code prior to allowing this access.',
      },
      yes,
    );
    if (consent === yes) {
      await vs.env.openExternal(
        vs.Uri.parse(dryRunResult.unauthorizedRedirectUri),
      );

      const ctn = 'Continue';
      const selection = await vs.window.showInformationMessage(
        'Please complete the authorization in your browser. If done, click "Continue".',
        { modal: true },
        ctn,
      );
      if (selection === ctn) {
        await propagateCredentialsAndSendReply(
          socket,
          client,
          endpoint,
          fileId,
          requestMessageId,
        );
        return;
      }
    }

    sendDriveFsAuthReply(
      socket,
      requestMessageId,
      'User cancelled Google Drive authorization',
    );
  }
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
      username: 'username',
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
}

async function propagateCredentialsAndSendReply(
  socket: WebSocket,
  client: ColabClient,
  endpoint: string,
  fileId: string,
  requestMessageId: number,
): Promise<void> {
  try {
    const { success } = await client.propagateDriveCredentials(endpoint, {
      authType: 'dfs_ephemeral',
      fileId,
      dryRun: false,
    });

    if (success) {
      sendDriveFsAuthReply(socket, requestMessageId);
    } else {
      sendDriveFsAuthReply(
        socket,
        requestMessageId,
        'Credentials propagation unsuccessful',
      );
    }
  } catch (e: unknown) {
    log.error('Failed handling DriveFS auth propagation', e);
    sendDriveFsAuthReply(
      socket,
      requestMessageId,
      e instanceof Error ? e.message : String(e),
    );
  }
}

interface ColabInputReplyMessage {
  msg_id: string;
  msg_type: 'input_reply';
  header: {
    msg_id: string;
    msg_type: 'input_reply';
    username: string;
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
