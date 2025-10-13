/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Jupyter } from "@vscode/jupyter-extension";
import { expect } from "chai";
import { SinonStub } from "sinon";
import sinon from "sinon";
import vscode from "vscode";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { getJupyterApi } from "./jupyter-extension";

enum ExtensionStatus {
  Active,
  Inactive,
}

describe("Jupyter Extension", () => {
  describe("getJupyterApi", () => {
    let vsCodeStub: VsCodeStub;
    let activateStub: SinonStub<[], Thenable<Jupyter>>;

    beforeEach(() => {
      vsCodeStub = newVsCodeStub();
      activateStub = sinon.stub();
    });

    afterEach(() => {
      sinon.restore();
    });

    function getJupyterExtension(
      status: ExtensionStatus = ExtensionStatus.Active,
    ): Partial<vscode.Extension<Jupyter>> {
      return {
        id: "ms-toolsai.jupyter",
        packageJSON: {
          publisher: "ms-toolsai",
          name: "jupyter",
          version: "2025.8.0",
        },
        isActive: status === ExtensionStatus.Active,
        activate: activateStub,
        exports: {
          kernels: {
            getKernel: sinon.stub(),
            onDidStart: sinon.stub(),
          },
          createJupyterServerCollection: sinon.stub(),
        },
      };
    }

    it("rejects if the Jupyter extension is not installed", async () => {
      vsCodeStub.extensions.getExtension.returns(undefined);

      await expect(getJupyterApi(vsCodeStub.asVsCode())).to.be.rejectedWith(
        "Jupyter Extension not installed",
      );
      sinon.assert.notCalled(activateStub);
    });

    it("rejects if the Jupyter extension version is too low", async () => {
      const ext = getJupyterExtension();
      vsCodeStub.extensions.getExtension.returns({
        ...ext,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        packageJSON: { ...ext.packageJSON, version: "2023.8.1002501831" },
      } as vscode.Extension<Jupyter>);

      await expect(getJupyterApi(vsCodeStub.asVsCode())).to.be.rejectedWith(
        /satisfy required version/,
      );
      sinon.assert.notCalled(activateStub);
    });

    it("activates the extension if it is not active", async () => {
      const ext = getJupyterExtension(ExtensionStatus.Inactive);
      vsCodeStub.extensions.getExtension.returns(
        ext as vscode.Extension<Jupyter>,
      );

      const result = await getJupyterApi(vsCodeStub.asVsCode());

      sinon.assert.calledOnce(activateStub);
      expect(result).to.equal(ext.exports);
    });

    it("returns the exports if the extension is already active", async () => {
      const ext = getJupyterExtension(ExtensionStatus.Active);
      vsCodeStub.extensions.getExtension.returns(
        ext as vscode.Extension<Jupyter>,
      );

      const result = await getJupyterApi(vsCodeStub.asVsCode());

      sinon.assert.notCalled(activateStub);
      expect(result).to.equal(ext.exports);
    });
  });
});
