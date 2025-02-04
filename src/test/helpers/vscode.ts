import { SinonStub } from "sinon";
import * as sinon from "sinon";
import { Disposable } from "vscode";
import vscode from "vscode";
import { TestCancellationTokenSource } from "./cancellation";
import { TestEventEmitter } from "./events";
import { TestUri } from "./uri";

class DisposableStub implements vscode.Disposable {
  dispose = sinon.stub();
  static from = sinon.stub();
}

const openExternalStub: SinonStub<
  [target: vscode.Uri],
  Thenable<boolean>
> = sinon.stub();

const asExternalUriStub: SinonStub<
  [target: vscode.Uri],
  Thenable<vscode.Uri>
> = sinon.stub();

const showInformationMessageStub: SinonStub<
  [
    message: string,
    options: vscode.MessageOptions,
    ...items: vscode.MessageItem[],
  ],
  Thenable<vscode.MessageItem | undefined>
> = sinon.stub();

const withProgressStub: SinonStub<
  [
    options: vscode.ProgressOptions,
    task: (
      progress: vscode.Progress<{
        message?: string;
        increment?: number;
      }>,
      token: vscode.CancellationToken,
    ) => Thenable<string>,
  ],
  Thenable<string>
> = sinon.stub();

const showErrorMessageStub: SinonStub<
  [
    message: string,
    options: vscode.MessageOptions,
    ...items: vscode.MessageItem[],
  ],
  Thenable<vscode.MessageItem | undefined>
> = sinon.stub();

enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}

const getExtensionStub: SinonStub<
  [extensionId: string],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vscode.Extension<any> | undefined
> = sinon.stub();

const registerAuthenticationProviderStub: SinonStub<
  [
    id: string,
    label: string,
    provider: vscode.AuthenticationProvider,
    options?: vscode.AuthenticationProviderOptions | undefined,
  ],
  Disposable
> = sinon.stub();

const vscodeStub: typeof vscode = {
  Uri: TestUri,
  EventEmitter: TestEventEmitter,
  Disposable: DisposableStub,
  env: {
    uriScheme: "vscode",
    openExternal: openExternalStub,
    asExternalUri: asExternalUriStub,
  } as Partial<typeof vscode.env> as typeof vscode.env,
  window: {
    withProgress: withProgressStub,
    showInformationMessage: showInformationMessageStub,
    showErrorMessage: showErrorMessageStub,
  } as Partial<typeof vscode.window> as typeof vscode.window,
  ProgressLocation: ProgressLocation,
  extensions: {
    getExtension: getExtensionStub,
  } as Partial<typeof vscode.extensions> as typeof vscode.extensions,
  authentication: {
    registerAuthenticationProvider: registerAuthenticationProviderStub,
  } as Partial<typeof vscode.authentication> as typeof vscode.authentication,
} as Pick<
  typeof vscode,
  | "Uri"
  | "EventEmitter"
  | "Disposable"
  | "env"
  | "window"
  | "ProgressLocation"
  | "extensions"
  | "authentication"
> as typeof vscode;

export {
  TestUri,
  TestEventEmitter,
  TestCancellationTokenSource,
  DisposableStub,
  openExternalStub,
  asExternalUriStub,
  withProgressStub,
  showInformationMessageStub,
  showErrorMessageStub,
  ProgressLocation,
  getExtensionStub,
  registerAuthenticationProviderStub,
  vscodeStub,
};
