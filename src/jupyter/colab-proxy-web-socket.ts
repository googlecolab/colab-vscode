/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'crypto';
import vscode from 'vscode';
import WebSocket from 'ws';
import { z } from 'zod';
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
  token: string,
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
    }

    override send(
      data: BufferLike,
      options: SendOptions | ((err?: Error) => void) | undefined,
      cb?: (err?: Error) => void,
    ) {
      if (typeof data === 'string') {
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
      if (!rawJupyterMessage) return;

      let parsedJupyterMessage: unknown;
      try {
        parsedJupyterMessage = JSON.parse(rawJupyterMessage) as unknown;
      } catch (e) {
        log.warn('Failed to parse Jupyter message to JSON:', e);
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    override on(event: string, listener: (...args: any[]) => void): this {
      if (event === 'message') {
        const wrappedListener = (data: WebSocket.Data, isBinary: boolean) => {
          if (typeof data === 'string') {
            try {
              const message: unknown = JSON.parse(data);
              if (
                isInputRequest(message) &&
                this.handleAuthRequest(message)
              ) {
                // If handled, do not call original listener.
                return;
              }
            } catch (_) {
              // Ignore parse errors, just pass through.
            }
          }
          listener(data, isBinary);
        };
        super.on(event, wrappedListener);
        return this;
      }
      super.on(event, listener);
      return this;
    }

    private handleAuthRequest(message: JupyterInputRequestMessage): boolean {
      const match = COLAB_AUTH_PATTERN.exec(message.content.prompt);
      if (!match) {
        return false;
      }

      const url = match[1];
      void this.promptForAuthCode(url, message);
      return true;
    }

    private async promptForAuthCode(
      url: string,
      originalMessage: JupyterInputRequestMessage,
    ): Promise<void> {
      const action = await vs.window.showInformationMessage(
        'Colab is requesting authentication. Open the link to authenticate, copy the verification code, and paste it here.',
        'Open URL',
      );

      if (action === 'Open URL') {
        await vs.env.openExternal(vs.Uri.parse(url));
      }

      const code = await vs.window.showInputBox({
        title: 'Colab Authentication',
        prompt: 'Enter the verification code from the browser',
        ignoreFocusOut: true,
        placeHolder: 'Paste code here',
      });

      if (code) {
        this.sendInputReply(code, originalMessage);
      }
    }

    private sendInputReply(
      value: string,
      originalMessage: JupyterInputRequestMessage,
    ): void {
      const reply: JupyterInputReplyMessage = {
        header: {
          msg_type: 'input_reply',
          session: originalMessage.header.session,
          msg_id: randomUUID(),
          date: new Date().toISOString(),
          version: '5.3',
        },
        content: {
          value,
          status: 'ok',
        },
        parent_header: originalMessage.header,
        metadata: originalMessage.metadata,
        channel: originalMessage.channel,
      };
      this.send(JSON.stringify(reply), undefined);
    }
  };
}

type SuperSend = WebSocket['send'];
type BufferLike = Parameters<SuperSend>[0];
type SendOptions = Parameters<SuperSend>[1];

function isExecuteRequest(
  message: unknown,
): message is JupyterExecuteRequestMessage {
  return ExecuteRequestSchema.safeParse(message).success;
}

interface JupyterExecuteRequestMessage {
  header: { msg_type: 'execute_request' };
  content: { code: string };
}

const ExecuteRequestSchema = z.object({
  header: z.object({
    msg_type: z.literal('execute_request'),
  }),
  content: z.object({
    code: z.string(),
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

function isInputRequest(
  message: unknown,
): message is JupyterInputRequestMessage {
  return InputRequestSchema.safeParse(message).success;
}

interface JupyterInputRequestMessage {
  header: { msg_type: 'input_request'; session: string; msg_id: string };
  content: { prompt: string; password: boolean };
  parent_header: unknown;
  metadata: unknown;
  channel: string;
}

const InputRequestSchema = z.object({
  header: z.object({
    msg_type: z.literal('input_request'),
    session: z.string(),
    msg_id: z.string(),
  }),
  content: z.object({
    prompt: z.string(),
    password: z.boolean(),
  }),
  parent_header: z.unknown(),
  metadata: z.unknown(),
  channel: z.string(),
});

interface JupyterInputReplyMessage {
  header: {
    msg_type: 'input_reply';
    session: string;
    msg_id: string;
    date: string;
    version: string;
  };
  content: { value: string; status: 'ok' };
  parent_header: unknown;
  metadata: unknown;
  channel: string;
}

const COLAB_AUTH_PATTERN =
  /Go to the following link in your browser:\s+(https:\/\/[^\s]+)\s+Enter verification code:/;
