import fs from "fs/promises";
import http from "http";
import { AddressInfo } from "net";
import path from "path";
import { expect } from "chai";
import { OAuth2Client } from "google-auth-library";
import sinon from "sinon";
import { LoopbackServer } from "../../common/loopback-server";
import { authUriMatch } from "../../test/helpers/authentication";
import { TestCancellationTokenSource } from "../../test/helpers/cancellation";
import { installHttpServerStub } from "../../test/helpers/http-server";
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
  let cancellationTokenSource: TestCancellationTokenSource;
  let defaultTriggerOpts: OAuth2TriggerOptions;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let resStub: sinon.SinonStubbedInstance<http.ServerResponse<any>>;

  let flow: LocalServerFlow;

  beforeEach(() => {
    vs = newVsCodeStub();
    oauth2Client = new OAuth2Client("testClientId", "testClientSecret");
    fakeServer = installHttpServerStub(DEFAULT_ADDRESS);
    cancellationTokenSource = new TestCancellationTokenSource();
    defaultTriggerOpts = {
      cancel: cancellationTokenSource.token,
      nonce: NONCE,
      scopes: SCOPES,
      pkceChallenge: "1 + 1 = ?",
    };
    resStub = sinon.createStubInstance(http.ServerResponse);
    flow = new LocalServerFlow(vs.asVsCode(), "out/test/media", oauth2Client);
  });

  afterEach(() => {
    sinon.restore();
  });

  it("throws an error for malformed requests missing a URL", () => {
    const req = {} as http.IncomingMessage;
    fakeServer.emit("request", req, resStub);
    void flow.trigger(defaultTriggerOpts);

    expect(() => fakeServer.emit("request", req, resStub)).to.throw(/url/);
  });

  it("throws an error for malformed requests missing a host header", () => {
    const req = { url: "/" } as http.IncomingMessage;
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
      url: `/?state=nonce%3D${NONCE}&code=${CODE}&scope=${SCOPES[0]}`,
      headers: { host: DEFAULT_HOST },
    } as http.IncomingMessage;
    fakeServer.emit("request", req, resStub);

    const flowResult = await trigger;

    sinon.assert.calledOnceWithMatch(
      vs.env.openExternal,
      authUriMatch(`http://${DEFAULT_HOST}`, /nonce=nonce/, SCOPES),
    );
    expect(flowResult.code).to.equal(CODE);
    expect(flowResult.redirectUri).to.equal(`http://${DEFAULT_HOST}`);
    expect(flowResult.disposable).to.be.instanceOf(LoopbackServer);
    expect(resStub.statusCode).to.equal(200);
    sinon.assert.calledOnce(resStub.end);
  });

  it("serves the favicon throughout the flow", async () => {
    void flow.trigger(defaultTriggerOpts);

    const faviconReq = {
      url: "/favicon.ico",
      headers: { host: DEFAULT_HOST },
    } as http.IncomingMessage;
    fakeServer.emit("request", faviconReq, resStub);

    const favicon = await fs.readFile(path.join("out/test/media/favicon.ico"));

    sinon.assert.calledOnceWithMatch(resStub.end, favicon);
  });
});
