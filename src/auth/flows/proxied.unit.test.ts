/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from "chai";
import { OAuth2Client } from "google-auth-library";
import * as sinon from "sinon";
import { InputBox } from "vscode";
import { CONFIG } from "../../colab-config";
import { ExtensionUriHandler } from "../../system/uri";
import { TestCancellationTokenSource } from "../../test/helpers/cancellation";
import {
  buildInputBoxStub,
  InputBoxStub,
} from "../../test/helpers/quick-input";
import { matchUri, TestUri } from "../../test/helpers/uri";
import { newVsCodeStub, VsCodeStub } from "../../test/helpers/vscode";
import { FlowResult, OAuth2TriggerOptions } from "./flows";
import { ProxiedRedirectFlow } from "./proxied";

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
  let inputBoxStub: InputBoxStub & {
    nextShow: () => Promise<void>;
  };

  beforeEach(() => {
    inputBoxStub = buildInputBoxStub();
    vs = newVsCodeStub();
    vs.window.createInputBox.returns(
      inputBoxStub as Partial<InputBox> as InputBox,
    );
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
      oauth2Client,
      "vscode://google.colab",
    );
    vs.env.asExternalUri
      .withArgs(matchUri(/vscode:\/\/google\.colab\?nonce=nonce/))
      .resolves(vs.Uri.parse(EXTERNAL_CALLBACK_URI));
  });

  afterEach(() => {
    flow.dispose();
    sinon.restore();
  });

  it("ignores requests missing a nonce", () => {
    void flow.trigger(defaultTriggerOpts);
    const uri = TestUri.parse("vscode://google.colab");

    expect(() => uriHandler.handleUri(uri)).not.to.throw();
  });

  it("ignores requests missing a code", () => {
    void flow.trigger(defaultTriggerOpts);
    const uri = TestUri.parse(`${EXTERNAL_CALLBACK_URI}&code=`);

    expect(() => uriHandler.handleUri(uri)).not.to.throw();
  });

  it("throws an error when the code exchange times out", async () => {
    const clock = sinon.useFakeTimers({ toFake: ["setTimeout"] });

    const trigger = flow.trigger(defaultTriggerOpts);
    clock.tick(60_001);

    await expect(trigger).to.eventually.be.rejectedWith(/timeout/);
    clock.restore();
  });

  it("validates the input authentication code", async () => {
    void flow.trigger(defaultTriggerOpts);

    await inputBoxStub.nextShow();
    inputBoxStub.value = "";
    inputBoxStub.onDidChangeValue.yield(inputBoxStub.value);
    expect(inputBoxStub.validationMessage).equal(
      "Authorization code cannot be empty",
    );

    inputBoxStub.value = "s".repeat(10);
    inputBoxStub.onDidChangeValue.yield(inputBoxStub.value);
    expect(inputBoxStub.validationMessage).equal(undefined);
  });

  it("cancels auth when the user dismisses the input box", async () => {
    const trigger = flow.trigger(defaultTriggerOpts);

    await inputBoxStub.nextShow();
    inputBoxStub.onDidHide.yield();

    await expect(trigger).to.eventually.be.rejectedWith(/cancelled/);
  });

  it("triggers and resolves the authentication flow", async () => {
    const trigger = flow.trigger(defaultTriggerOpts);

    await inputBoxStub.nextShow();
    inputBoxStub.value = CODE;
    inputBoxStub.onDidChangeValue.yield(CODE);
    inputBoxStub.onDidAccept.yield();

    const expected: FlowResult = { code: CODE, redirectUri: REDIRECT_URI };
    await expect(trigger).to.eventually.deep.equal(expected);
  });
});
