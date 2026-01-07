/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { v4 as uuid } from 'uuid';
import vscode from 'vscode';
import WebSocket from 'ws';
import { z } from 'zod';
import { handleDriveFsAuth } from '../auth/drive';
import { ColabClient } from '../colab/client';
import {
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
} from '../colab/headers';
import { log } from '../common/logging';

/**
 * Returns a class which extends {@link WebSocket}, adds Colab's custom headers,
 * and intercepts {@link WebSocket.send} to warn users when on `drive.mount`
 * execution.
 */
export function colabProxyWebSocket(
  vs: typeof vscode,
  client: ColabClient,
  token: string,
  endpoint: string,
  BaseWebSocket: typeof WebSocket = WebSocket,
) {
  // These custom headers are required for Colab's proxy WebSocket to work.
  const colabHeaders: Record<string, string> = {};
  colabHeaders[COLAB_RUNTIME_PROXY_TOKEN_HEADER.key] = token;
  colabHeaders[COLAB_CLIENT_AGENT_HEADER.key] = COLAB_CLIENT_AGENT_HEADER.value;

  const addColabHeaders = (
    options?: WebSocket.ClientOptions,
  ): WebSocket.ClientOptions => {
    options ??= {};
    options.headers ??= {};
    const headers: Record<string, string> = {
      ...options.headers,
      ...colabHeaders,
    };
    return { ...options, headers };
  };

  return class ColabWebSocket extends BaseWebSocket {
    constructor(
      address: string | URL,
      protocols?: string | string[] | WebSocket.ClientOptions,
      options?: WebSocket.ClientOptions,
    ) {
      if (typeof protocols === 'object' && !Array.isArray(protocols)) {
        super(address, addColabHeaders(protocols));
      } else {
        super(address, protocols, addColabHeaders(options));
      }

      this.addListener(
        'message',
        (data: WebSocket.RawData, isBinary: boolean) => {
          if (!isBinary && typeof data === 'string') {
            const message = JSON.parse(data) as unknown;
            if (isColabAuthEphemeralRequest(message)) {
              log.debug('Colab request message received...');

              const replyMsgId = uuid();
              const replyMessage: ColabInputReplyMessage = {
                msg_id: replyMsgId,
                msg_type: 'input_reply',
                header: {
                  msg_id: replyMsgId,
                  msg_type: 'input_reply',
                  username: 'username',
                  session: message.header.session,
                  version: '5.0',
                },
                content: {
                  value: {
                    type: 'colab_reply',
                    colab_msg_id: message.metadata.colab_msg_id,
                  },
                },
                channel: 'stdin',
                metadata: {},
                parent_header: {},
              };
              handleDriveFsAuth(vs, client, endpoint)
                .then(() => {
                  this.send(JSON.stringify(replyMessage));
                  log.debug('Input reply message sent: ', replyMessage);
                })
                .catch((e: unknown) => {
                  replyMessage.content.value.error = e;
                  this.send(JSON.stringify(replyMessage));
                  log.error('Failed handling DriveFS auth propagation', e);
                });
            }
          }
        },
      );
    }
  };
}

function isColabAuthEphemeralRequest(
  message: unknown,
): message is ColabAuthEphemeralRequestMessage {
  return ColabAuthEphemeralRequestSchema.safeParse(message).success;
}

interface ColabAuthEphemeralRequestMessage {
  header: {
    msg_type: 'colab_request';
    session: string;
  };
  content: {
    request: { authType: 'dfs_ephemeral' };
  };
  metadata: {
    colab_request_type: 'request_auth';
    colab_msg_id: number;
  };
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

const ColabAuthEphemeralRequestSchema = z.object({
  header: z.object({
    msg_type: z.literal('colab_request'),
    session: z.string(),
  }),
  content: z.object({
    request: z.object({
      authType: z.literal('dfs_ephemeral'),
    }),
  }),
  metadata: z.object({
    colab_request_type: z.literal('request_auth'),
    colab_msg_id: z.number(),
  }),
});
