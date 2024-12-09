import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { getJupyterApi } from "../jupyter/jupyter_extension";

describe("getJupyterApi", () => {
  let getExtensionStub: sinon.SinonStub;

  beforeEach(() => {
    getExtensionStub = sinon.stub(vscode.extensions, "getExtension");
  });

  afterEach(() => {
    sinon.restore();
  });

  it("should throw an error if the Jupyter extension is not installed", async () => {
    getExtensionStub.returns(undefined);

    try {
      await getJupyterApi();
      throw new Error("Expected getJupyterApi to throw an error");
    } catch (error) {
      expect((error as Error).message).to.equal(
        "Jupyter Extension not installed",
      );
    }
  });

  it("should activate the extension if it is not active", async () => {
    const activateStub = sinon.stub().resolves();
    const ext = {
      isActive: false,
      activate: activateStub,
      exports: {},
    };
    getExtensionStub.returns(ext);

    const result = await getJupyterApi();

    sinon.assert.calledOnce(activateStub);
    expect(result).to.equal(ext.exports);
  });

  it("should return the exports if the extension is already active", async () => {
    const ext = {
      isActive: true,
      activate: sinon.stub(),
      exports: {},
    };
    getExtensionStub.returns(ext);

    const result = await getJupyterApi();

    sinon.assert.calledOnce(getExtensionStub);
    expect(result).to.equal(ext.exports);
  });
});
