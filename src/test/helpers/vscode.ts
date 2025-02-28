import * as sinon from "sinon";
import vscode from "vscode";
import { TestCancellationTokenSource } from "./cancellation";
import { TestEventEmitter } from "./events";
import { TestUri } from "./uri";

enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}

export interface VsCodeStub {
  /**
   * Returns a stub of the vscode module typed as vscode.
   */
  asVsCode: () => typeof vscode;
  Uri: typeof TestUri;
  CancellationTokenSource: typeof TestCancellationTokenSource;
  EventEmitter: typeof TestEventEmitter;
  env: {
    uriScheme: "vscode";
    openExternal: sinon.SinonStubbedMember<typeof vscode.env.openExternal>;
    asExternalUri: sinon.SinonStubbedMember<typeof vscode.env.asExternalUri>;
  };
  window: {
    withProgress: sinon.SinonStubbedMember<typeof vscode.window.withProgress>;
    showInformationMessage: sinon.SinonStubbedMember<
      typeof vscode.window.showInformationMessage
    >;
    showErrorMessage: sinon.SinonStubbedMember<
      typeof vscode.window.showErrorMessage
    >;
  };
  ProgressLocation: typeof ProgressLocation;
  extensions: {
    getExtension: sinon.SinonStubbedMember<
      typeof vscode.extensions.getExtension
    >;
  };
  authentication: {
    registerAuthenticationProvider: sinon.SinonStubbedMember<
      typeof vscode.authentication.registerAuthenticationProvider
    >;
  };
}

/**
 * Creates a new instance of a VsCodeStub.
 *
 * In most cases, tests should avoid re-using instances of this so the stubs
 * don't interfere with each other.
 */
export function newVsCodeStub(): VsCodeStub {
  return {
    asVsCode: function (): typeof vscode {
      return {
        ...this,
        env: { ...this.env } as Partial<typeof vscode.env> as typeof vscode.env,
        window: { ...this.window } as Partial<
          typeof vscode.window
        > as typeof vscode.window,
        extensions: { ...this.extensions } as Partial<
          typeof vscode.extensions
        > as typeof vscode.extensions,
        authentication: { ...this.authentication } as Partial<
          typeof vscode.authentication
        > as typeof vscode.authentication,
      } as Pick<
        typeof vscode,
        | "Uri"
        | "CancellationTokenSource"
        | "EventEmitter"
        | "env"
        | "window"
        | "ProgressLocation"
        | "extensions"
        | "authentication"
      > as typeof vscode;
    },
    Uri: TestUri,
    CancellationTokenSource: TestCancellationTokenSource,
    EventEmitter: TestEventEmitter,
    env: {
      uriScheme: "vscode",
      openExternal: sinon.stub(),
      asExternalUri: sinon.stub(),
    },
    window: {
      withProgress: sinon.stub(),
      showInformationMessage: sinon.stub(),
      showErrorMessage: sinon.stub(),
    },
    ProgressLocation: ProgressLocation,
    extensions: {
      getExtension: sinon.stub(),
    },
    authentication: {
      registerAuthenticationProvider: sinon.stub(),
    },
  };
}
