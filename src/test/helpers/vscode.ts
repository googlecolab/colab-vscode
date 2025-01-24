import { SinonStub } from "sinon";
import * as sinon from "sinon";
import vscode from "vscode";

const getExtensionStub: SinonStub<
  [extensionId: string],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vscode.Extension<any> | undefined
> = sinon.stub();

const vscodeStub: typeof vscode = {
  extensions: {
    getExtension: getExtensionStub,
  } as Pick<
    typeof vscode.extensions,
    "getExtension"
  > as typeof vscode.extensions,
} as Pick<typeof vscode, "extensions"> as typeof vscode;

export { getExtensionStub, vscodeStub };
