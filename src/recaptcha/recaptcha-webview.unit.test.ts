import { expect } from "chai";
import * as sinon from "sinon";
import vscode from "vscode";
import { TestEventEmitter } from "../test/helpers/events";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { RecaptchaWebview } from "./recaptcha-webview";

const RECAPTCHA_TOKEN = "recaptcha-token";

describe("RecaptchaWebview", () => {
  let mockContext: Partial<vscode.ExtensionContext>; // Use Partial to allow mocking only necessary properties
  let webview: Partial<vscode.Webview>;
  let webviewPanel: Partial<vscode.WebviewPanel>;
  let vsCodeStub: VsCodeStub;
  let recaptchaWebview: RecaptchaWebview;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let onDidReceiveMessageEventEmitter: TestEventEmitter<any>;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    mockContext = {
      subscriptions: [],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onDidReceiveMessageEventEmitter = new TestEventEmitter<any>();
    webview = {
      html: "",
      onDidReceiveMessage: onDidReceiveMessageEventEmitter.event,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      postMessage: (_message: any) => {
        const testMessage = { responseId: "0", token: RECAPTCHA_TOKEN };
        onDidReceiveMessageEventEmitter.fire(testMessage);
        return new Promise((resolve) => {
          resolve;
        });
      },
      asWebviewUri: (uri: vscode.Uri) => uri,
      cspSource: "",
    };
    webviewPanel = {
      webview: webview as vscode.Webview,
      onDidDispose: sinon.stub(),
    };
    vsCodeStub.window.createWebviewPanel.returns(
      webviewPanel as vscode.WebviewPanel,
    );
    recaptchaWebview = new RecaptchaWebview(
      vsCodeStub.asVsCode(),
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
      "Colab Recaptcha",
    );
  });

  it("returns the message back", async () => {
    recaptchaWebview.show();
    const testToken =
      await recaptchaWebview.sendRequestAndWaitForResponse("requestRecaptcha");
    expect(testToken).to.equal(RECAPTCHA_TOKEN);
  });
});
