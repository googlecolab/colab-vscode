/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { MessageItem } from 'vscode';
import { Disposable } from 'vscode';
import { initializeTelemetry, telemetry } from '.';

const TELEMETRY_NOTICE_KEY = 'telemetryNoticeAcknowledged';
const NOTICE_MESSAGE =
  'Colab now collects identifiable usage data and error reports to improve your experience.';

const NOTICE_DETAIL = "Opt out by setting telemetry.telemetryLevel to 'off'.";
const ACKNOWLEDGE: MessageItem = {
  title: 'Acknowledge',
  isCloseAffordance: true,
};
const LEARN_MORE: MessageItem = { title: 'Learn More' };

/**
 * Initializes telemetry, showing a one-time notice if the user has not
 * previously acknowledged it. Telemetry is not initialized until the user
 * interacts with the notice dialog.
 *
 * @param vs - The vscode module.
 * @param globalState - The extension's global state memento.
 * @param extensionUri - The extension's root URI for locating the README.
 * @returns A {@link Disposable} that cleans up the telemetry client.
 */
export function initializeTelemetryWithNotice(
  vs: typeof vscode,
  globalState: vscode.Memento,
  extensionUri: vscode.Uri,
): Disposable {
  let telemetryDisposable: Disposable | undefined;
  let isDisposed = false;

  function initTelemetry(): void {
    telemetryDisposable = initializeTelemetry(vs);
    telemetry.logActivation();
    if (isDisposed) {
      telemetryDisposable.dispose();
    }
  }

  if (globalState.get<boolean>(TELEMETRY_NOTICE_KEY)) {
    initTelemetry();
  } else {
    void showNoticeAndInitialize(vs, globalState, extensionUri, initTelemetry);
  }

  return {
    dispose: () => {
      isDisposed = true;
      telemetryDisposable?.dispose();
    },
  };
}

async function showNoticeAndInitialize(
  vs: typeof vscode,
  globalState: vscode.Memento,
  extensionUri: vscode.Uri,
  initTelemetry: () => void,
): Promise<void> {
  const response = await vs.window.showInformationMessage(
    NOTICE_MESSAGE,
    { modal: true, detail: NOTICE_DETAIL },
    ACKNOWLEDGE,
    LEARN_MORE,
  );

  if (response === LEARN_MORE) {
    const readmeUri = vs.Uri.joinPath(extensionUri, 'README.md').with({
      fragment: 'data-and-telemetry',
    });
    void vs.commands.executeCommand('markdown.showPreview', readmeUri);
  }

  await globalState.update(TELEMETRY_NOTICE_KEY, true);
  initTelemetry();
}
