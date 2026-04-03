/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon from 'sinon';
import vscode, { MessageItem } from 'vscode';
import { COLAB_EXT_IDENTIFIER } from '../config/constants';
import { JUPYTER_EXT_IDENTIFIER } from '../jupyter/jupyter-extension';
import { Deferred } from '../test/helpers/async';
import { newVsCodeStub, VsCodeStub } from '../test/helpers/vscode';
import { ClearcutClient } from './client';
import { initializeTelemetryWithNotice } from './notice';

const EXTENSION_URI_STRING = 'file:///extensions/google.colab-1.2.3';

describe('initializeTelemetryWithNotice', () => {
  let vs: VsCodeStub;
  let disposable: vscode.Disposable | undefined;
  let dialog: Deferred<MessageItem | undefined>;

  beforeEach(() => {
    vs = newVsCodeStub();
    dialog = new Deferred<MessageItem | undefined>();
    (vs.window.showInformationMessage as sinon.SinonStub).returns(
      dialog.promise,
    );
    const packageJSON = { name: '', publisher: '' };
    vs.extensions.getExtension
      .withArgs(COLAB_EXT_IDENTIFIER)
      .returns({
        packageJSON: { ...packageJSON, version: '1.2.3' },
      } as vscode.Extension<unknown>)
      .withArgs(JUPYTER_EXT_IDENTIFIER)
      .returns({
        packageJSON: { ...packageJSON, version: '2025.0.0' },
      } as vscode.Extension<unknown>);
  });

  afterEach(() => {
    sinon.restore();
    disposable?.dispose();
  });

  /**
   * Extracts the {@link MessageItem} button with the given title from the
   * arguments passed to `showInformationMessage`.
   *
   * @param title - The title of the button to find.
   * @returns The matching {@link MessageItem}.
   */
  function getButton(title: 'Acknowledge' | 'Learn More'): MessageItem {
    const args = vs.window.showInformationMessage.firstCall.args;
    const items = args.slice(2) as MessageItem[];
    const item = items.find((i) => i.title === title);
    if (!item) {
      throw new Error(`expected button "${title}" in dialog args`);
    }
    return item;
  }

  it('does not show the modal when already acknowledged', async () => {
    await vs.globalState.update('telemetryNoticeAcknowledged', true);
    const logStub = sinon.stub(ClearcutClient.prototype, 'log');

    disposable = initializeTelemetryWithNotice(
      vs.asVsCode(),
      vs.globalState as vscode.Memento,
      vs.Uri.parse(EXTENSION_URI_STRING),
    );

    sinon.assert.notCalled(vs.window.showInformationMessage);
    sinon.assert.calledOnce(logStub);
  });

  it('shows a modal with correct message and buttons', () => {
    disposable = initializeTelemetryWithNotice(
      vs.asVsCode(),
      vs.globalState as vscode.Memento,
      vs.Uri.parse(EXTENSION_URI_STRING),
    );

    sinon.assert.calledOnce(vs.window.showInformationMessage);
    const args = vs.window.showInformationMessage.firstCall.args;
    expect(args[0]).to.include('improve your experience');
    expect(args[1]).to.have.property('modal', true);
    expect(args[1])
      .to.have.property('detail')
      .that.includes('telemetry.telemetryLevel');
    const acknowledge = getButton('Acknowledge');
    const learnMore = getButton('Learn More');
    expect(acknowledge).to.have.property('isCloseAffordance', true);
    expect(learnMore).not.to.have.property('isCloseAffordance');
  });

  it('persists acknowledgment on "Acknowledge"', async () => {
    const logStub = sinon.stub(ClearcutClient.prototype, 'log');

    disposable = initializeTelemetryWithNotice(
      vs.asVsCode(),
      vs.globalState as vscode.Memento,
      vs.Uri.parse(EXTENSION_URI_STRING),
    );

    dialog.resolve(getButton('Acknowledge'));
    await dialog.promise;
    await Promise.resolve();

    expect(vs.globalState.get('telemetryNoticeAcknowledged')).to.equal(true);
    sinon.assert.calledOnce(logStub);
  });

  it('opens the README and initializes telemetry on "Learn More"', async () => {
    vs.commands.executeCommand.resolves();
    sinon.stub(ClearcutClient.prototype, 'log');

    disposable = initializeTelemetryWithNotice(
      vs.asVsCode(),
      vs.globalState as vscode.Memento,
      vs.Uri.parse(EXTENSION_URI_STRING),
    );

    dialog.resolve(getButton('Learn More'));
    await dialog.promise;
    await Promise.resolve();

    sinon.assert.calledOnceWithMatch(
      vs.commands.executeCommand,
      'markdown.showPreview',
      sinon.match({
        path: sinon.match('README.md'),
        fragment: 'data-and-telemetry',
      }),
    );
    expect(vs.globalState.get('telemetryNoticeAcknowledged')).to.equal(true);
  });

  it('persists acknowledgment on dismiss', async () => {
    const logStub = sinon.stub(ClearcutClient.prototype, 'log');

    disposable = initializeTelemetryWithNotice(
      vs.asVsCode(),
      vs.globalState as vscode.Memento,
      vs.Uri.parse(EXTENSION_URI_STRING),
    );

    dialog.resolve(undefined);
    await dialog.promise;
    await Promise.resolve();

    expect(vs.globalState.get('telemetryNoticeAcknowledged')).to.equal(true);
    sinon.assert.called(logStub);
  });

  describe('lifecycle', () => {
    it('disposes cleanly when telemetry was initialized', async () => {
      await vs.globalState.update('telemetryNoticeAcknowledged', true);
      const disposeSpy = sinon.spy(ClearcutClient.prototype, 'dispose');

      const d = initializeTelemetryWithNotice(
        vs.asVsCode(),
        vs.globalState as vscode.Memento,
        vs.Uri.parse(EXTENSION_URI_STRING),
      );
      d.dispose();

      sinon.assert.calledOnce(disposeSpy);
    });

    it('disposes cleanly when telemetry has not yet been initialized', () => {
      const disposeSpy = sinon.spy(ClearcutClient.prototype, 'dispose');

      const d = initializeTelemetryWithNotice(
        vs.asVsCode(),
        vs.globalState as vscode.Memento,
        vs.Uri.parse(EXTENSION_URI_STRING),
      );
      d.dispose();

      // Client was never created, so dispose should not have been called.
      sinon.assert.notCalled(disposeSpy);
    });

    it('disposes deferred client after modal resolves', async () => {
      const disposeSpy = sinon.spy(ClearcutClient.prototype, 'dispose');

      const d = initializeTelemetryWithNotice(
        vs.asVsCode(),
        vs.globalState as vscode.Memento,
        vs.Uri.parse(EXTENSION_URI_STRING),
      );

      dialog.resolve(getButton('Acknowledge'));
      await dialog.promise;
      await Promise.resolve();
      d.dispose();

      sinon.assert.calledOnce(disposeSpy);
    });
  });
});
