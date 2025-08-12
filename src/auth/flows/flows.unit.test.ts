/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from "chai";
import { OAuth2Client } from "google-auth-library";
import sinon from "sinon";
import vscode from "vscode";
import { PackageInfo } from "../../config/package-info";
import { ExtensionUriHandler } from "../../system/uri-handler";
import { newVsCodeStub, VsCodeStub } from "../../test/helpers/vscode";
import { getOAuth2Flows, OAuth2Flow } from "./flows";

const PACKAGE_INFO: PackageInfo = {
  publisher: "google",
  name: "colab",
};

describe("getOAuth2Flows", () => {
  let vs: VsCodeStub;

  beforeEach(() => {
    vs = newVsCodeStub();
  });

  afterEach(() => {
    sinon.restore();
  });

  function getOAuth2FlowsFor(uiKind: vscode.UIKind): OAuth2Flow[] {
    vs.env.uiKind = uiKind;
    return getOAuth2Flows(
      vs.asVsCode(),
      PACKAGE_INFO,
      new ExtensionUriHandler(vs.asVsCode()),
      sinon.createStubInstance(OAuth2Client),
    );
  }

  it("returns the local server and proxied redirect flows when running on desktop", () => {
    const flows = getOAuth2FlowsFor(vs.UIKind.Desktop);

    expect(flows).to.have.lengthOf(2);
    expect(flows[0].constructor.name).to.equal("LocalServerFlow");
    expect(flows[1].constructor.name).to.equal("ProxiedRedirectFlow");
  });

  it("returns the proxied redirect flow when running on web", () => {
    const flows = getOAuth2FlowsFor(vs.UIKind.Web);

    expect(flows).to.have.lengthOf(1);
    expect(flows[0].constructor.name).to.equal("ProxiedRedirectFlow");
  });
});
