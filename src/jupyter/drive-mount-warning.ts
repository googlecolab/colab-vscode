/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from 'vscode';

/**
 * Displays a warning notification message in VS Code if `rawJupyterMessage` is
 * an execute request containing `drive.mount()`.
 */
export function warnOnDriveMount(
  vs: typeof vscode,
  rawJupyterMessage: string,
): void {
  const parsedJupyterMessage = JSON.parse(rawJupyterMessage) as {
    header: { msg_type: string };
    content: { code: string };
  };
  if (
    parsedJupyterMessage.header.msg_type === 'execute_request' &&
    DRIVE_MOUNT_PATTERN.exec(parsedJupyterMessage.content.code)
  ) {
    notifyDriveMountUnsupported(vs);
  }
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

const DRIVE_MOUNT_PATTERN = /drive\.mount\(.+\)/;
const DRIVE_MOUNT_ISSUE_LINK =
  'https://github.com/googlecolab/colab-vscode/issues/256';
const DRIVE_MOUNT_WIKI_LINK =
  'https://github.com/googlecolab/colab-vscode/wiki/Known-Issues-and-Workarounds#drivemount';

enum DriveMountUnsupportedAction {
  VIEW_ISSUE = 'GitHub Issue',
  VIEW_WORKAROUND = 'Workaround',
}
