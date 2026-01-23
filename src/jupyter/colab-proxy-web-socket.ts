/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { v4 as uuid } from 'uuid';
import vscode, { Disposable, ConfigurationChangeEvent } from 'vscode';
import WebSocket from 'ws';
import { z } from 'zod';
import { handleDriveFsAuth } from '../auth/drive';
import { ColabClient } from '../colab/client';
import {
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
} from '../colab/headers';
import { log } from '../common/logging';
import { ColabAssignedServer } from './servers';

/**
 * Returns a class which extends {@link WebSocket}, adds Colab's custom headers,
 * and intercepts {@link WebSocket.send} to warn users when on `drive.mount`
 * execution.
 */
export function colabProxyWebSocket(
  vs: typeof vscode,
  client: ColabClient,
  server: ColabAssignedServer,
  BaseWebSocket: typeof WebSocket = WebSocket,
  handleDriveFsAuthFn: typeof handleDriveFsAuth = handleDriveFsAuth,
) {
  // These custom headers are required for Colab's proxy WebSocket to work.
  const colabHeaders: Record<string, string> = {};
  colabHeaders[COLAB_RUNTIME_PROXY_TOKEN_HEADER.key] =
    server.connectionInformation.token;
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

  return class ColabWebSocket extends BaseWebSocket implements Disposable {
    private readonly sessionId = uuid();
    private driveMountingEnabled: boolean;
    private disposed = false;
    private disposables: Disposable[] = [];

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

      this.driveMountingEnabled = vs.workspace
        .getConfiguration('colab')
        .get<boolean>('driveMounting', false);
      const configListener = vs.workspace.onDidChangeConfiguration(
        (e: ConfigurationChangeEvent) => {
          if (!e.affectsConfiguration('colab.driveMounting')) {
            return;
          }
          this.driveMountingEnabled = vs.workspace
            .getConfiguration('colab')
            .get<boolean>('driveMounting', false);
        },
      );
      this.disposables.push(configListener);

      this.addListener(
        'message',
        (data: WebSocket.RawData, isBinary: boolean) => {
          if (
            !isBinary &&
            typeof data === 'string' &&
            this.driveMountingEnabled
          ) {
            let message: unknown;
            try {
              message = JSON.parse(data) as unknown;
            } catch (e: unknown) {
              log.warn('Failed to parse received Jupyter message to JSON:', e);
              return;
            }

            if (isColabAuthEphemeralRequest(message)) {
              log.trace('Colab request message received:', message);
              handleDriveFsAuthFn(vs, client, server)
                .then(() => {
                  this.sendInputReply(message.metadata.colab_msg_id);
                })
                .catch((err: unknown) => {
                  log.error('Failed handling DriveFS auth propagation', err);
                  this.sendInputReply(message.metadata.colab_msg_id, err);
                });
            }
          }
        },
      );
    }

    dispose() {
      if (this.disposed) {
        return;
      }
      this.disposed = true;
      for (const d of this.disposables) {
        d.dispose();
      }
      this.disposables = [];
      this.removeAllListeners('message');
    }

    override send(
      data: BufferLike,
      options?: SendOptions | ((err?: Error) => void),
      cb?: (err?: Error) => void,
    ) {
      this.guardDisposed();

      if (typeof data === 'string' && !this.driveMountingEnabled) {
        this.warnOnDriveMount(data);
      }

      if (options === undefined || typeof options === 'function') {
        cb = options;
        options = {};
      }
      super.send(data, options, cb);
    }

    /**
     * Displays a warning notification message in VS Code if `rawJupyterMessage`
     * is an execute request containing `drive.mount()`.
     */
    private warnOnDriveMount(rawJupyterMessage: string): void {
      let parsedJupyterMessage: unknown;
      try {
        parsedJupyterMessage = JSON.parse(rawJupyterMessage) as unknown;
      } catch (e: unknown) {
        log.warn('Failed to parse sent Jupyter message to JSON:', e);
        return;
      }

      if (
        isExecuteRequest(parsedJupyterMessage) &&
        DRIVE_MOUNT_PATTERN.exec(parsedJupyterMessage.content.code)
      ) {
        this.notifyDriveMountUnsupported();
      }
    }

    private notifyDriveMountUnsupported(): void {
      vs.window
        .showWarningMessage(
          `drive.mount is not currently supported in the extension. We're working on it! See the [wiki](${DRIVE_MOUNT_WIKI_LINK}) for workarounds and track this [issue](${DRIVE_MOUNT_ISSUE_LINK}) for progress.`,
          DriveMountUnsupportedAction.VIEW_WORKAROUND,
          DriveMountUnsupportedAction.VIEW_ISSUE,
        )
        .then((selectedAction) => {
          switch (selectedAction) {
            case DriveMountUnsupportedAction.VIEW_WORKAROUND:
              vs.env.openExternal(vs.Uri.parse(DRIVE_MOUNT_WIKI_LINK));
              break;
            case DriveMountUnsupportedAction.VIEW_ISSUE:
              vs.env.openExternal(vs.Uri.parse(DRIVE_MOUNT_ISSUE_LINK));
              break;
          }
        });
    }

    private sendInputReply(requestMessageId: number, err?: unknown) {
      const replyMsgId = uuid();
      const replyMsgType = 'input_reply';
      const replyMessage: ColabInputReplyMessage = {
        msg_id: replyMsgId,
        msg_type: replyMsgType,
        header: {
          msg_id: replyMsgId,
          msg_type: replyMsgType,
          session: this.sessionId,
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
        if (err instanceof Error) {
          replyMessage.content.value.error = err.message;
        } else if (typeof err === 'string') {
          replyMessage.content.value.error = err;
        } else {
          replyMessage.content.value.error = 'unknown error';
        }
      }

      this.send(JSON.stringify(replyMessage));
      log.trace('Input reply message sent:', replyMessage);
    }

    private guardDisposed(): void {
      if (this.disposed) {
        throw new Error(
          'ColabWebSocket cannot be used after it has been disposed.',
        );
      }
    }
  };
}

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

type SuperSend = WebSocket['send'];
type BufferLike = Parameters<SuperSend>[0];
type SendOptions = Parameters<SuperSend>[1];

function isExecuteRequest(
  message: unknown,
): message is JupyterExecuteRequestMessage {
  return ExecuteRequestSchema.safeParse(message).success;
}

function isColabAuthEphemeralRequest(
  message: unknown,
): message is ColabAuthEphemeralRequestMessage {
  return ColabAuthEphemeralRequestSchema.safeParse(message).success;
}

interface JupyterExecuteRequestMessage {
  header: { msg_type: 'execute_request' };
  content: { code: string };
}

interface ColabAuthEphemeralRequestMessage {
  header: { msg_type: 'colab_request' };
  content: {
    request: { authType: 'dfs_ephemeral' };
  };
  metadata: {
    colab_request_type: 'request_auth';
    colab_msg_id: number;
  };
}

const ExecuteRequestSchema = z.object({
  header: z.object({
    msg_type: z.literal('execute_request'),
  }),
  content: z.object({
    code: z.string(),
  }),
});

const ColabAuthEphemeralRequestSchema = z.object({
  header: z.object({
    msg_type: z.literal('colab_request'),
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

const DRIVE_MOUNT_PATTERN = /drive\.mount\(.+\)/;
const DRIVE_MOUNT_ISSUE_LINK =
  'https://github.com/googlecolab/colab-vscode/issues/256';
const DRIVE_MOUNT_WIKI_LINK =
  'https://github.com/googlecolab/colab-vscode/wiki/Known-Issues-and-Workarounds#drivemount';

enum DriveMountUnsupportedAction {
  VIEW_ISSUE = 'GitHub Issue',
  VIEW_WORKAROUND = 'Workaround',
}
