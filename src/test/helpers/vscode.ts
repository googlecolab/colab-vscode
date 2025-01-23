import { SinonStub } from "sinon";
import * as sinon from "sinon";
import vscode from "vscode";

const getExtensionStub: SinonStub<
  [extensionId: string],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vscode.Extension<any> | undefined
> = sinon.stub();

const vscodeStub: Pick<typeof vscode, "extensions"> = {
  extensions: {
    getExtension: getExtensionStub,
  } as Partial<typeof vscode.extensions> as typeof vscode.extensions,
};

export { getExtensionStub, vscodeStub };
