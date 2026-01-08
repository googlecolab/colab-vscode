/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'assert';
import * as http from 'http';
import { v4 as uuid } from 'uuid';
import vscode from 'vscode';
import WebSocket from 'ws';
import { ColabClient } from '../colab/client';
import { log } from '../common/logging';
import { LoopbackHandler, LoopbackServer } from '../common/loopback-server';

export async function handleDriveFsAuth(
  vs: typeof vscode,
  ws: WebSocket,
  client: ColabClient,
  endpoint: string,
  requestMessageId: number,
) {
  const fileId = vs.window.activeNotebookEditor?.notebook.uri.path ?? '';
  log.debug(`Notebook file ID: ${fileId}`);
  log.debug(`Endpoint: ${endpoint}`);

  const dryRunResult = await client.propagateDriveCredentials(endpoint, {
    authType: 'dfs_ephemeral',
    fileId,
    dryRun: true,
  });

  if (dryRunResult.success) {
    propagateCredentialsAndSendReply(
      ws,
      client,
      endpoint,
      fileId,
      requestMessageId,
    );
    return;
  }

  if (dryRunResult.unauthorizedRedirectUri) {
    log.debug(
      `Unauthorized redirect URI: ${dryRunResult.unauthorizedRedirectUri}`,
    );

    const newOAuthUrl = new URL(dryRunResult.unauthorizedRedirectUri);
    const clientId = newOAuthUrl.searchParams.get('client_id');
    const redirectUri = newOAuthUrl.searchParams.get('redirect_uri');
    assert(clientId);
    assert(redirectUri);

    const server = new LoopbackServer(
      new DriveFsLoopbackHandler(
        ws,
        client,
        endpoint,
        redirectUri,
        fileId,
        requestMessageId,
      ),
    );
    const port = await server.start();
    const address = `http://127.0.0.1:${port.toString()}`;

    // For POC, this hack swaps out the client ID and redirect URI in the OAuth
    // consent URL, so I can get OAuth flow to loop back to VS Code in the end.
    newOAuthUrl.searchParams.set(
      'client_id',
      // eslint-disable-next-line @cspell/spellchecker
      '498676818669-8jg5qu96h3a66n7lem2lvsi2b8u0j4ob.apps.googleusercontent.com',
    );
    newOAuthUrl.searchParams.set('redirect_uri', address);

    await vs.env.openExternal(vs.Uri.parse(newOAuthUrl.toString()));
  } else {
    propagateCredentialsAndSendReply(
      ws,
      client,
      endpoint,
      fileId,
      requestMessageId,
    );
  }
}

class DriveFsLoopbackHandler implements LoopbackHandler {
  constructor(
    private readonly ws: WebSocket,
    private readonly client: ColabClient,
    private readonly endpoint: string,
    private readonly redirectUri: string,
    private readonly fileId: string,
    private readonly requestMessageId: number,
  ) {}

  handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // URL and Host are only missing on malformed requests.
    assert(req.url);
    assert(req.headers.host);
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' });
      res.end('Method Not Allowed');
      return;
    }

    const redirectUrl = new URL(this.redirectUri);
    redirectUrl.search = url.search;
    const newRedirectUri = redirectUrl.toString();
    log.debug(`New redirect URL: ${newRedirectUri}`);

    res.writeHead(302, { Location: newRedirectUri });
    res.end();

    propagateCredentialsAndSendReply(
      this.ws,
      this.client,
      this.endpoint,
      this.fileId,
      this.requestMessageId,
    );
  }
}

function propagateCredentialsAndSendReply(
  ws: WebSocket,
  client: ColabClient,
  endpoint: string,
  fileId: string,
  requestMessageId: number,
) {
  const replyMsgId = uuid();
  const replyMessage: ColabInputReplyMessage = {
    msg_id: replyMsgId,
    msg_type: 'input_reply',
    header: {
      msg_id: replyMsgId,
      msg_type: 'input_reply',
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

  client
    .propagateDriveCredentials(endpoint, {
      authType: 'dfs_ephemeral',
      fileId,
      dryRun: false,
    })
    .then(({ success }) => {
      log.debug(`Credentials propagation success: ${String(success)}`);
      if (!success) {
        replyMessage.content.value.error = new Error(
          'Credentials propagation unsuccessful',
        );
      }
      ws.send(JSON.stringify(replyMessage));
      log.debug('Input reply message sent: ', replyMessage);
    })
    .catch((e: unknown) => {
      replyMessage.content.value.error = e;
      ws.send(JSON.stringify(replyMessage));
      log.error('Failed handling DriveFS auth propagation', e);
    });
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
      error?: unknown;
    };
  };
  channel: 'stdin';
  metadata: object;
  parent_header: object;
}
