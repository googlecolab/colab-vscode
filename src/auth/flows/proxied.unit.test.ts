import { expect } from "chai";
import { OAuth2Client } from "google-auth-library";
import * as sinon from "sinon";
import vscode from "vscode";
import { CONFIG } from "../../colab-config";
import { PackageInfo } from "../../config/package-info";
import { ExtensionUriHandler } from "../../system/uri-handler";
import { authUriMatch } from "../../test/helpers/authentication";
import { TestCancellationTokenSource } from "../../test/helpers/cancellation";
import { TestUri } from "../../test/helpers/uri";
import { newVsCodeStub, VsCodeStub } from "../../test/helpers/vscode";
import { FlowResult, OAuth2TriggerOptions } from "./flows";
import { ProxiedRedirectFlow } from "./proxied";

const PACKAGE_INFO: PackageInfo = {
  publisher: "google",
  name: "colab",
};
const NONCE = "nonce";
const CODE = "42";
const EXTERNAL_CALLBACK_URI = `vscode://google.colab?nonce=${NONCE}&windowId=1`;
const REDIRECT_URI = `${CONFIG.ColabApiDomain}/vscode/redirect`;
const SCOPES = ["foo"];

describe("ProxiedRedirectFlow", () => {
  let vs: VsCodeStub;
  let oauth2Client: OAuth2Client;
  let uriHandler: ExtensionUriHandler;
  let cancellationTokenSource: TestCancellationTokenSource;
  let defaultTriggerOpts: OAuth2TriggerOptions;
  let flow: ProxiedRedirectFlow;

  beforeEach(() => {
    vs = newVsCodeStub();
    oauth2Client = new OAuth2Client("testClientId", "testClientSecret");
    uriHandler = new ExtensionUriHandler(vs.asVsCode());
    cancellationTokenSource = new TestCancellationTokenSource();
    defaultTriggerOpts = {
      cancel: cancellationTokenSource.token,
      nonce: NONCE,
      scopes: SCOPES,
      pkceChallenge: "1 + 1 = ?",
    };
    flow = new ProxiedRedirectFlow(
      vs.asVsCode(),
      PACKAGE_INFO,
      oauth2Client,
      uriHandler,
    );
    vs.env.asExternalUri
      .withArgs(matchUri(/vscode:\/\/google\.colab\?nonce=nonce/))
      .resolves(vs.Uri.parse(EXTERNAL_CALLBACK_URI));
  });

  afterEach(() => {
    sinon.restore();
  });

  it("disposes the URI handler when disposed", () => {
    const eventStub = sinon.stub(uriHandler, "onReceivedUri");
    const disposeStub = sinon.stub<[]>();
    eventStub.returns({ dispose: disposeStub });
    flow = new ProxiedRedirectFlow(
      vs.asVsCode(),
      PACKAGE_INFO,
      oauth2Client,
      uriHandler,
    );

    flow.dispose();

    sinon.assert.calledOnce(disposeStub);
  });

  it("throws an error when the received URI is missing a nonce", () => {
    void flow.trigger(defaultTriggerOpts);
    const uri = TestUri.parse("vscode://google.colab");

    expect(() => uriHandler.handleUri(uri)).to.throw(/nonce/);
  });

  it("throws an error when the received URI is missing a code", () => {
    void flow.trigger(defaultTriggerOpts);
    const uri = TestUri.parse(`${EXTERNAL_CALLBACK_URI}&code=`);

    expect(() => uriHandler.handleUri(uri)).to.throw(/code/);
  });

  it("throws an error when the code exchange times out", async () => {
    const clock = sinon.useFakeTimers({ toFake: ["setTimeout"] });

    const trigger = flow.trigger(defaultTriggerOpts);
    clock.tick(60_001);

    await expect(trigger).to.eventually.be.rejectedWith(/timeout/);
    clock.restore();
  });

  it("triggers and resolves the authentication flow", async () => {
    const trigger = flow.trigger(defaultTriggerOpts);
    const uri = TestUri.parse(`${EXTERNAL_CALLBACK_URI}&code=${CODE}`);
    uriHandler.handleUri(uri);

    const expected: FlowResult = { code: CODE, redirectUri: REDIRECT_URI };
    await expect(trigger).to.eventually.deep.equal(expected);
    sinon.assert.calledOnceWithMatch(
      vs.env.openExternal,
      authUriMatch(REDIRECT_URI, /vscode:\/\/google\.colab/, SCOPES),
    );
  });
});

function matchUri(regExp: RegExp) {
  return sinon.match((uri: vscode.Uri) => regExp.test(uri.toString()));
}
