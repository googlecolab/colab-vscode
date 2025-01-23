import { Jupyter } from "@vscode/jupyter-extension";
import { expect } from "chai";
import { SinonStub } from "sinon";
import sinon from "sinon";
import vscode from "vscode";
import { getExtensionStub, vscodeStub } from "../test/helpers/vscode";
import { getJupyterApi } from "./jupyter-extension";

enum ExtensionStatus {
  Active,
  Inactive,
}

describe("Jupyter Extension", () => {
  describe("getJupyterApi", () => {
    let activateStub: SinonStub<[], Thenable<Jupyter>>;

    beforeEach(() => {
      activateStub = sinon.stub();
    });

    function getJupyterExtension(
      status: ExtensionStatus,
    ): Partial<vscode.Extension<Jupyter>> {
      return {
        isActive: status === ExtensionStatus.Active ? true : false,
        activate: activateStub,
        exports: {
          kernels: {
            getKernel: sinon.stub(),
          },
          createJupyterServerCollection: sinon.stub(),
        },
      };
    }

    it("should throw an error if the Jupyter extension is not installed", async () => {
      getExtensionStub.returns(undefined);

      await expect(
        getJupyterApi(vscodeStub as typeof vscode),
      ).to.be.rejectedWith("Jupyter Extension not installed");
      sinon.assert.notCalled(activateStub);
    });

    it("should activate the extension if it is not active", async () => {
      const ext = getJupyterExtension(ExtensionStatus.Inactive);
      getExtensionStub.returns(ext as vscode.Extension<Jupyter>);

      const result = await getJupyterApi(vscodeStub as typeof vscode);

      sinon.assert.calledOnce(activateStub);
      expect(result).to.equal(ext.exports);
    });

    it("should return the exports if the extension is already active", async () => {
      const ext = getJupyterExtension(ExtensionStatus.Active);
      getExtensionStub.returns(ext as vscode.Extension<Jupyter>);

      const result = await getJupyterApi(vscodeStub as typeof vscode);

      sinon.assert.notCalled(activateStub);
      expect(result).to.equal(ext.exports);
    });
  });
});
