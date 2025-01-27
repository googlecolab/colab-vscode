import { SinonStub } from "sinon";
import * as sinon from "sinon";
import vscode from "vscode";
import { TestCancellationTokenSource } from "./cancellation";
import { TestUri } from "./uri";

const getExtensionStub: SinonStub<
  [extensionId: string],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vscode.Extension<any> | undefined
> = sinon.stub();

const vscodeStub: typeof vscode = {
  Uri: TestUri,
  extensions: {
    getExtension: getExtensionStub,
  } as Partial<typeof vscode.extensions> as typeof vscode.extensions,
} as Pick<typeof vscode, "Uri" | "extensions"> as typeof vscode;

export { TestUri, TestCancellationTokenSource, getExtensionStub, vscodeStub };
