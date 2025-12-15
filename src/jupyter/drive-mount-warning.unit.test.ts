/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon from 'sinon';
import { Uri } from 'vscode';
import { newVsCodeStub, VsCodeStub } from '../test/helpers/vscode';
import { warnOnDriveMount } from './drive-mount-warning';

describe('warnOnDriveMount', () => {
  let vsCodeStub: VsCodeStub;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
  });

  describe('when drive.mount() is detected in Jupyter Kernel message', () => {
    const rawDriveMountMessage = JSON.stringify({
      header: { msg_type: 'execute_request' },
      content: { code: 'drive.mount("/content/drive")' },
    });

    it('shows warning notification', async () => {
      const warningShown = new Promise<void>((resolve) => {
        (vsCodeStub.window.showWarningMessage as sinon.SinonStub).callsFake(
          (message: string) => {
            expect(message).to.match(/drive.mount is not currently supported/);
            resolve();
            return Promise.resolve(undefined);
          },
        );
      });

      warnOnDriveMount(vsCodeStub.asVsCode(), rawDriveMountMessage);

      await expect(warningShown).to.eventually.be.fulfilled;
    });

    it('presents an action to view workaround', async () => {
      const warningShown = new Promise<void>((resolve) => {
        (vsCodeStub.window.showWarningMessage as sinon.SinonStub).callsFake(
          () => {
            resolve();
            return Promise.resolve('Workaround');
          },
        );
      });

      warnOnDriveMount(vsCodeStub.asVsCode(), rawDriveMountMessage);

      await expect(warningShown).to.eventually.be.fulfilled;
      sinon.assert.calledOnceWithMatch(
        vsCodeStub.env.openExternal,
        sinon.match(function (url: Uri) {
          return (
            url.toString() ===
            'https://github.com/googlecolab/colab-vscode/wiki/Known-Issues-and-Workarounds#drivemount'
          );
        }),
      );
    });

    it('presents an action to view issue', async () => {
      const warningShown = new Promise<void>((resolve) => {
        (vsCodeStub.window.showWarningMessage as sinon.SinonStub).callsFake(
          () => {
            resolve();
            return Promise.resolve('GitHub Issue');
          },
        );
      });

      warnOnDriveMount(vsCodeStub.asVsCode(), rawDriveMountMessage);

      await expect(warningShown).to.eventually.be.fulfilled;
      sinon.assert.calledOnceWithMatch(
        vsCodeStub.env.openExternal,
        sinon.match(function (url: Uri) {
          return (
            url.toString() ===
            'https://github.com/googlecolab/colab-vscode/issues/256'
          );
        }),
      );
    });
  });

  it('does nothing if Jupyter Kernel message is not an execute_request', async () => {
    const rawJupyterMessage = JSON.stringify({
      header: { msg_type: 'kernel_info_request' },
    });

    warnOnDriveMount(vsCodeStub.asVsCode(), rawJupyterMessage);
    await flush();

    sinon.assert.notCalled(
      vsCodeStub.window.showWarningMessage as sinon.SinonStub,
    );
  });

  it('does nothing if not executing drive.mount()', async () => {
    const rawJupyterMessage = JSON.stringify({
      header: { msg_type: 'execute_request' },
      content: { code: 'print("Hello World!")' },
    });

    warnOnDriveMount(vsCodeStub.asVsCode(), rawJupyterMessage);
    await flush();

    sinon.assert.notCalled(
      vsCodeStub.window.showWarningMessage as sinon.SinonStub,
    );
  });

  it('does nothing if message is empty', async () => {
    warnOnDriveMount(vsCodeStub.asVsCode(), '');
    await flush();

    sinon.assert.notCalled(
      vsCodeStub.window.showWarningMessage as sinon.SinonStub,
    );
  });

  it('does nothing if message is not a Jupyter message format', async () => {
    const rawNonJupyterMessage = JSON.stringify({
      random_field: 'random_value',
    });

    warnOnDriveMount(vsCodeStub.asVsCode(), rawNonJupyterMessage);
    await flush();

    sinon.assert.notCalled(
      vsCodeStub.window.showWarningMessage as sinon.SinonStub,
    );
  });
});

async function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
