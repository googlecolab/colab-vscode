/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import sinon from "sinon";
import { Uri } from "vscode";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { warnOnDriveMount } from "./drive-mount-warning";

describe("warnOnDriveMount", () => {
  let vsCodeStub: VsCodeStub;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
  });

  describe("when drive.mount() is detected in Jupyter Kernel message", () => {
    const rawDriveMountMessage = JSON.stringify({
      header: { msg_type: "execute_request" },
      content: { code: "drive.mount('/content/drive')" },
    });

    it("shows warning notification", async () => {
      await warnOnDriveMount(vsCodeStub.asVsCode(), rawDriveMountMessage);

      sinon.assert.calledOnceWithMatch(
        vsCodeStub.window.showWarningMessage as sinon.SinonStub,
        /drive.mount\(\) is not supported/,
      );
    });

    it("presents an action to view workaround", async () => {
      (vsCodeStub.window.showWarningMessage as sinon.SinonStub).resolves(
        "View Workaround",
      );

      await warnOnDriveMount(vsCodeStub.asVsCode(), rawDriveMountMessage);

      sinon.assert.calledOnceWithMatch(
        vsCodeStub.env.openExternal,
        sinon.match(function (url: Uri) {
          return (
            url.toString() ===
            "https://github.com/googlecolab/colab-vscode/wiki/Known-Issues-and-Workarounds#drivemount"
          );
        }),
      );
    });

    it("presents an action to view issue", async () => {
      (vsCodeStub.window.showWarningMessage as sinon.SinonStub).resolves(
        "View Issue",
      );

      await warnOnDriveMount(vsCodeStub.asVsCode(), rawDriveMountMessage);

      sinon.assert.calledOnceWithMatch(
        vsCodeStub.env.openExternal,
        sinon.match(function (url: Uri) {
          return (
            url.toString() ===
            "https://github.com/googlecolab/colab-vscode/issues/223"
          );
        }),
      );
    });
  });

  it("does nothing if Jupyter Kernel message is not an execute_request", async () => {
    const rawJupyterMessage = JSON.stringify({
      header: { msg_type: "kernel_info_request" },
    });

    await warnOnDriveMount(vsCodeStub.asVsCode(), rawJupyterMessage);

    sinon.assert.notCalled(
      vsCodeStub.window.showWarningMessage as sinon.SinonStub,
    );
  });

  it("does nothing if not executing drive.mount()", async () => {
    const rawJupyterMessage = JSON.stringify({
      header: { msg_type: "execute_request" },
      content: { code: "print('Hello World!')" },
    });

    await warnOnDriveMount(vsCodeStub.asVsCode(), rawJupyterMessage);

    sinon.assert.notCalled(
      vsCodeStub.window.showWarningMessage as sinon.SinonStub,
    );
  });
});
