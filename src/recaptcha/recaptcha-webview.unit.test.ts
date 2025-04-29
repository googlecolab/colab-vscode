/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from "chai";
import * as sinon from "sinon";
import vscode from "vscode";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { RecaptchaWebview } from "./recaptcha-webview";

describe("RecaptchaWebview", () => {
  //let postMessageStub: sinon.SinonStub;
  let mockContext: Partial<vscode.ExtensionContext>; // Use Partial to allow mocking only necessary properties
  let webview: Partial<vscode.Webview>;
  let webviewPanel: Partial<vscode.WebviewPanel>;
  let vsCodeStub: VsCodeStub;
  let recaptchaWebview: RecaptchaWebview;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    mockContext = {
      subscriptions: [],
    };
    webview = {
      html: "",
      postMessage: sinon.stub(),
      onDidReceiveMessage: { event: () => ({ dispose: () => {} }) } as any,
      asWebviewUri: (uri: vscode.Uri) => uri,
      cspSource: "",
    };
    webviewPanel = {
      webview: webview as vscode.Webview,
    };
    vsCodeStub.window.createWebviewPanel.returns(
      webviewPanel as vscode.WebviewPanel,
    );
    recaptchaWebview = new RecaptchaWebview(
      mockContext as vscode.ExtensionContext,
    );
  });

  afterEach(() => {
    sinon.restore();
  });

  it("should create a webview panel with the correct title and view type", () => {
    recaptchaWebview.show();
    sinon.assert.calledOnce(vsCodeStub.window.createWebviewPanel);
    expect(vsCodeStub.window.createWebviewPanel.firstCall.args[1]).to.equal(
      "myWebview",
    ); // Replace with your actual view type
  });
});
