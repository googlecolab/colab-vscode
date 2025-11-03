/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import http from "http";
import { AddressInfo } from "net";
import { expect } from "chai";
import { OAuth2Client } from "google-auth-library";
import sinon from "sinon";
import { CONFIG } from "../../colab-config";
import { authUriMatch } from "../../test/helpers/authentication";
import { TestCancellationTokenSource } from "../../test/helpers/cancellation";
import { createHttpServerMock } from "../../test/helpers/http-server";
import { matchUri } from "../../test/helpers/uri";
import { newVsCodeStub, VsCodeStub } from "../../test/helpers/vscode";
import { OAuth2TriggerOptions } from "./flows";
import { LocalServerFlow } from "./loopback";

const DEFAULT_ADDRESS: AddressInfo = {
  address: "127.0.0.1",
  family: "IPv4",
  port: 1234,
};
const DEFAULT_HOST = `${DEFAULT_ADDRESS.address}:${DEFAULT_ADDRESS.port.toString()}`;
const NONCE = "nonce";
const CODE = "42";
const SCOPES = ["foo"];

describe("LocalServerFlow", () => {
  let vs: VsCodeStub;
  let oauth2Client: OAuth2Client;
  let fakeServer: sinon.SinonStubbedInstance<http.Server>;
  let createServerStub: sinon.SinonStub;
  let cancellationTokenSource: TestCancellationTokenSource;
  let defaultTriggerOpts: OAuth2TriggerOptions;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let resStub: sinon.SinonStubbedInstance<http.ServerResponse<any>>;

  let flow: LocalServerFlow;

  beforeEach(() => {
    vs = newVsCodeStub();
    oauth2Client = new OAuth2Client("testClientId", "testClientSecret");
    fakeServer = createHttpServerMock(DEFAULT_ADDRESS);
    createServerStub = sinon.stub(http, "createServer").returns(fakeServer);
    cancellationTokenSource = new TestCancellationTokenSource();
    defaultTriggerOpts = {
      cancel: cancellationTokenSource.token,
      nonce: NONCE,
      scopes: SCOPES,
      pkceChallenge: "1 + 1 = ?",
    };
    resStub = sinon.createStubInstance(http.ServerResponse);
    flow = new LocalServerFlow(
      vs.asVsCode(),
      "out/test/media",
      oauth2Client,
      "vscode://google.colab",
    );
  });

  afterEach(() => {
    flow.dispose();
    sinon.restore();
  });

  // Each call to `trigger` creates a new server. This test validates each of
  // them are disposed when the flow is.
  it("disposes the supporting loopback server when disposed", () => {
    const fakeServer2 = createHttpServerMock({
      ...DEFAULT_ADDRESS,
      port: DEFAULT_ADDRESS.port + 1,
    });
    createServerStub.onSecondCall().returns(fakeServer2);
    void flow.trigger(defaultTriggerOpts);
    void flow.trigger({ ...defaultTriggerOpts, nonce: "nonce2" });

    flow.dispose();

    sinon.assert.calledOnce(fakeServer.close);
    sinon.assert.calledOnce(fakeServer2.close);
  });

  it("returns method not allowed for non-GET requests", async () => {
    const clock = sinon.useFakeTimers({ toFake: ["setTimeout"] });
    const trigger = flow.trigger(defaultTriggerOpts);
    const req = {
      url: "/",
      method: "POST",
      headers: { host: DEFAULT_HOST },
    } as http.IncomingMessage;

    fakeServer.emit("request", req, resStub);
    clock.tick(60_001);
    await expect(trigger).to.eventually.be.rejectedWith(/timeout/);

    sinon.assert.calledWith(resStub.writeHead, 405, { Allow: "GET" });
    sinon.assert.calledOnce(resStub.end);
    clock.restore();
  });

  it("throws an error for malformed requests missing a URL", () => {
    const req = { method: "GET" } as http.IncomingMessage;
    fakeServer.emit("request", req, resStub);
    void flow.trigger(defaultTriggerOpts);

    expect(() => fakeServer.emit("request", req, resStub)).to.throw(/url/);
  });

  it("throws an error for malformed requests missing a host header", () => {
    const req = { method: "GET", url: "/" } as http.IncomingMessage;
    fakeServer.emit("request", req, resStub);
    void flow.trigger(defaultTriggerOpts);

    expect(() => fakeServer.emit("request", req, resStub)).to.throw(/host/);
  });

  const requestErrorTests = [
    { label: "state", url: "/", expectedError: /state/ },
    { label: "nonce", url: "/?state=", expectedError: /state/ },
    { label: "code", url: `/?state=nonce%3D${NONCE}`, expectedError: /code/ },
  ];
  for (const t of requestErrorTests) {
    it(`throws an error when ${t.label} is missing`, () => {
      const req = {
        method: "GET",
        url: t.url,
        headers: { host: DEFAULT_HOST },
      } as http.IncomingMessage;
      fakeServer.emit("request", req, resStub);
      void flow.trigger(defaultTriggerOpts);

      expect(() => fakeServer.emit("request", req, resStub)).to.throw(
        t.expectedError,
      );
    });
  }

  it("triggers and resolves the authentication flow", async () => {
    const trigger = flow.trigger(defaultTriggerOpts);
    const req = {
      method: "GET",
      url: `/?state=nonce%3D${NONCE}&code=${CODE}&scope=${SCOPES[0]}`,
      headers: { host: DEFAULT_HOST },
    } as http.IncomingMessage;
    const authSuccessPageOpened = new Promise<void>((resolve) => {
      vs.env.openExternal.callsFake(() => {
        resolve();
        return Promise.resolve(true);
      });
    });
    const authSuccessUri = "vscode://google.colab/auth-success";
    const externalAuthSuccessUri = `${authSuccessUri}?windowId=1`;
    const state = encodeURIComponent(externalAuthSuccessUri);
    const colabAuthSuccessUrl = `${CONFIG.ColabApiDomain}/vscode/auth-success?state=${state}`;
    const responseRedirected = new Promise<void>((resolve) => {
      resStub.writeHead
        .withArgs(302, sinon.match({ Location: colabAuthSuccessUrl }))
        .callsFake(() => {
          resolve();
          resStub.statusCode = 302;
          return resStub;
        });
    });
    vs.env.asExternalUri
      .withArgs(matchUri(authSuccessUri))
      .resolves(vs.Uri.parse(externalAuthSuccessUri));
    fakeServer.emit("request", req, resStub);

    const flowResult = await trigger;

    sinon.assert.calledOnceWithMatch(
      vs.env.openExternal,
      authUriMatch(`http://${DEFAULT_HOST}`, /nonce=nonce/, SCOPES),
    );
    await expect(authSuccessPageOpened).to.eventually.be.fulfilled;
    await expect(responseRedirected).to.eventually.be.fulfilled;
    expect(flowResult.code).to.equal(CODE);
    expect(flowResult.redirectUri).to.equal(`http://${DEFAULT_HOST}`);
    expect(resStub.statusCode).to.equal(302);
    sinon.assert.calledOnce(resStub.end);
  });

  // TODO: This SUT and test read from disk, we should add the following test as
  // an integration test to keep the UTs zippy ⚡.
  //
  // Commenting out for now to avoid unnecessary test bloat. It's also
  // non-critical user functionality.
  /*
  it("serves the favicon throughout the flow", async () => {
    void flow.trigger(defaultTriggerOpts);
    const faviconReq = {
      method: "GET",
      url: "/favicon.ico",
      headers: { host: DEFAULT_HOST },
    } as http.IncomingMessage;

    fakeServer.emit("request", faviconReq, resStub);

    const favicon = await fs.readFile(path.join("out/test/media/favicon.ico"));
    sinon.assert.calledOnceWithMatch(resStub.end, favicon);
  });
  */
});
