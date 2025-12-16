/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from 'vscode';
import { z } from 'zod';

/**
 * Displays a warning notification message in VS Code if `rawJupyterMessage` is
 * an execute request containing `drive.mount()`.
 */
export function warnOnDriveMount(
  vs: typeof vscode,
  rawJupyterMessage: string,
): void {
  if (!rawJupyterMessage) return;

  const parsedJupyterMessage = JSON.parse(rawJupyterMessage) as unknown;
  if (
    isExecuteRequest(parsedJupyterMessage) &&
    DRIVE_MOUNT_PATTERN.exec(parsedJupyterMessage.content.code)
  ) {
    notifyDriveMountUnsupported(vs);
  }
}

function isExecuteRequest(
  message: unknown,
): message is JupyterExecuteRequestMessage {
  return ExecuteRequestSchema.safeParse(message).success;
}

function notifyDriveMountUnsupported(vs: typeof vscode): void {
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
