import { expect } from "chai";
import { OAuth2Client } from "google-auth-library";
import {
  CodeChallengeMethod,
  GetTokenResponse,
} from "google-auth-library/build/src/auth/oauth2client";
import * as nodeFetch from "node-fetch";
import { SinonStub, SinonStubbedInstance } from "sinon";
import * as sinon from "sinon";
import vscode, { Disposable } from "vscode";
import { PROVIDER_ID } from "../config/constants";
import { PackageInfo } from "../config/package_info";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { GoogleAuthProvider } from "./provider";
import { CodeProvider } from "./redirect";
import { AuthStorage } from "./storage";

const PACKAGE_INFO: PackageInfo = {
  publisher: PROVIDER_ID,
  name: "colab",
};
const REQUIRED_SCOPES = ["profile", "email"];
const CLIENT_ID = "testClientId";
const DEFAULT_SESSION: vscode.AuthenticationSession = {
  id: "1",
  accessToken: "123",
  account: {
    label: "Foo Bar",
    id: "foo@example.com",
  },
  scopes: ["email", "profile"],
};

describe("GoogleAuthProvider", () => {
  const oAuth2Client = new OAuth2Client(
    CLIENT_ID,
    "testClientSecret",
    "https://localhost:8888/vscode/redirect",
  );
  let vsCodeStub: VsCodeStub;
  let fetchStub: SinonStub<
    [url: nodeFetch.RequestInfo, init?: nodeFetch.RequestInit | undefined],
    Promise<nodeFetch.Response>
  >;
  let storageStub: SinonStubbedInstance<AuthStorage>;
  let redirectUriHandlerStub: SinonStubbedInstance<CodeProvider>;
  let registrationDisposable: sinon.SinonStubbedInstance<Disposable>;
  let onDidChangeSessionsStub: sinon.SinonStub<
    [vscode.AuthenticationProviderAuthenticationSessionsChangeEvent]
  >;
  let authProvider: GoogleAuthProvider;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    fetchStub = sinon.stub(nodeFetch, "default");
    storageStub = sinon.createStubInstance(AuthStorage);
    redirectUriHandlerStub = {
      waitForCode: sinon.stub(),
    };
    registrationDisposable = {
      dispose: sinon.stub(),
    };
    vsCodeStub.authentication.registerAuthenticationProvider.returns(
      registrationDisposable,
    );
    onDidChangeSessionsStub = sinon.stub();

    authProvider = new GoogleAuthProvider(
      vsCodeStub.asVsCode(),
      PACKAGE_INFO,
      storageStub,
      oAuth2Client,
      redirectUriHandlerStub,
    );
    authProvider.onDidChangeSessions(onDidChangeSessionsStub);
  });

  afterEach(() => {
    fetchStub.restore();
    sinon.restore();
  });

  describe("lifecycle", () => {
    it('registers the "Google" authentication provider', () => {
      sinon.assert.calledOnceWithExactly(
        vsCodeStub.authentication.registerAuthenticationProvider,
        PROVIDER_ID,
        "Google",
        authProvider,
        { supportsMultipleAccounts: false },
      );
    });

    it('disposes the "Google" authentication provider', () => {
      authProvider.dispose();

      sinon.assert.calledOnce(registrationDisposable.dispose);
    });
  });

  describe("getSessions", () => {
    it("returns an empty array when no session is stored", async () => {
      storageStub.getSession.resolves(undefined);

      const sessions = authProvider.getSessions(undefined, {});

      await expect(sessions).to.eventually.deep.equal([]);
      sinon.assert.calledOnce(storageStub.getSession);
    });

    it("returns a session when one is stored", async () => {
      storageStub.getSession.resolves(DEFAULT_SESSION);

      const sessions = authProvider.getSessions(undefined, {});

      await expect(sessions).to.eventually.deep.equal([DEFAULT_SESSION]);
      sinon.assert.calledOnce(storageStub.getSession);
    });
  });

  describe("createSession", () => {
    it("warns when login fails", async () => {
      const cancellationStub: SinonStubbedInstance<vscode.CancellationToken> = {
        isCancellationRequested: false,
        onCancellationRequested: sinon.stub(),
      };
      vsCodeStub.window.withProgress
        .withArgs(
          sinon.match({
            location: vsCodeStub.ProgressLocation.Notification,
            title: sinon.match(/Signing in/),
            cancellable: true,
          }),
          sinon.match.any,
        )
        .callsFake((_, task) =>
          task({ report: sinon.stub() }, cancellationStub),
        );
      redirectUriHandlerStub.waitForCode.throws(new Error("Barf"));

      await expect(authProvider.createSession(REQUIRED_SCOPES)).to.be.rejected;

      sinon.assert.calledOnceWithMatch(
        vsCodeStub.window.showErrorMessage,
        sinon.match(/Sign in failed.+/),
      );
    });

    it("succeeds", async () => {
      const cancellationStub: SinonStubbedInstance<vscode.CancellationToken> = {
        isCancellationRequested: false,
        onCancellationRequested: sinon.stub(),
      };
      vsCodeStub.window.withProgress
        .withArgs(
          sinon.match({
            location: vsCodeStub.ProgressLocation.Notification,
            title: sinon.match(/Signing in/),
            cancellable: true,
          }),
          sinon.match.any,
        )
        .callsFake((_, task) =>
          task({ report: sinon.stub() }, cancellationStub),
        );
      let nonce = "";
      redirectUriHandlerStub.waitForCode
        .withArgs(
          sinon.match(
            /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/,
          ),
          cancellationStub,
        )
        .callsFake((n, _token) => {
          nonce = n;
          return Promise.resolve("42");
        });
      sinon
        .stub(oAuth2Client, "getToken")
        .withArgs({ code: "42", codeVerifier: sinon.match.string })
        .resolves({
          res: { status: 200 },
          tokens: { access_token: DEFAULT_SESSION.accessToken },
        } as GetTokenResponse);
      vsCodeStub.env.asExternalUri
        .withArgs(
          sinon.match((uri: vscode.Uri) => {
            return new RegExp(`vscode://google\\.colab\\?nonce=${nonce}`).test(
              uri.toString(),
            );
          }),
        )
        .callsFake((_uri) =>
          Promise.resolve(
            vsCodeStub.Uri.parse(
              `vscode://google.colab?nonce%3D${nonce}%26windowId%3D1`,
            ),
          ),
        );
      vsCodeStub.env.openExternal
        .withArgs(
          sinon.match((uri: vscode.Uri) =>
            uri
              .toString()
              .startsWith("https://accounts.google.com/o/oauth2/v2/auth?"),
          ),
        )
        .resolves(true);
      const userInfoResponse = new nodeFetch.Response(
        JSON.stringify({
          id: "1337",
          email: "foo@example.com",
          verified_email: true,
          name: "Foo Bar",
          given_name: "Foo",
          family_name: "Bar",
          picture: "https://example.com/foo.jpg",
          hd: "google.com",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
      fetchStub
        .withArgs("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${DEFAULT_SESSION.accessToken}` },
        })
        .resolves(userInfoResponse);

      const session = await authProvider.createSession(REQUIRED_SCOPES);

      expect({ ...session, id: undefined }).to.deep.equal({
        ...DEFAULT_SESSION,
        id: undefined,
      });
      sinon.assert.calledOnce(vsCodeStub.env.openExternal);
      const [query] = vsCodeStub.env.openExternal.firstCall.args.map(
        (arg) => new URLSearchParams(arg.query),
      );
      expect([...query.entries()]).to.deep.include.members([
        ["response_type", "code"],
        ["scope", "email profile"],
        ["prompt", "login"],
        ["code_challenge_method", CodeChallengeMethod.S256],
        ["client_id", CLIENT_ID],
        ["redirect_uri", "https://localhost:8888/vscode/redirect"],
      ]);
      expect(query.get("state")).to.match(
        /^vscode:\/\/google\.colab\?nonce%3D[a-f0-9-]+%26windowId%3D1$/,
      );
      expect(query.get("code_challenge")).to.match(/^[A-Za-z0-9_-]+$/);
      sinon.assert.calledOnceWithMatch(
        vsCodeStub.window.showInformationMessage,
        sinon.match(/Signed in/),
      );
    });
  });

  describe("removeSession", () => {
    it("does nothing when session is not removed", async () => {
      storageStub.removeSession
        .withArgs(DEFAULT_SESSION.id)
        .resolves(undefined);

      await authProvider.removeSession(DEFAULT_SESSION.id);

      sinon.assert.notCalled(onDidChangeSessionsStub);
    });

    describe("when session is removed", () => {
      beforeEach(async () => {
        storageStub.removeSession
          .withArgs(DEFAULT_SESSION.id)
          .resolves(DEFAULT_SESSION);

        await authProvider.removeSession(DEFAULT_SESSION.id);
      });

      it("removes the session", () => {
        sinon.assert.calledOnce(storageStub.removeSession);
      });

      it("notifies of the removal", () => {
        sinon.assert.calledOnceWithExactly(onDidChangeSessionsStub, {
          added: [],
          removed: [DEFAULT_SESSION],
          changed: [],
        });
      });
    });
  });
});
