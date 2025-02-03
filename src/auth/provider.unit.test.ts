import { assert, expect } from "chai";
import { OAuth2Client } from "google-auth-library";
import {
  CodeChallengeMethod,
  GetTokenResponse,
} from "google-auth-library/build/src/auth/oauth2client";
import * as nodeFetch from "node-fetch";
import { SinonStub, SinonStubbedInstance } from "sinon";
import * as sinon from "sinon";
import vscode from "vscode";
import {
  asExternalUriStub,
  DisposableStub,
  openExternalStub,
  ProgressLocation,
  registerAuthenticationProviderStub,
  showErrorMessageStub,
  TestUri,
  vscodeStub,
  withProgressStub,
} from "../test/helpers/vscode";
import { GoogleAuthProvider } from "./provider";
import { CodeProvider } from "./redirect";

const REQUIRED_SCOPES = ["profile", "email"];
const CLIENT_ID = "testClientId";
const SESSIONS_KEY = "google.sessions";
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
  let fetchStub: SinonStub<
    [url: nodeFetch.RequestInfo, init?: nodeFetch.RequestInit | undefined],
    Promise<nodeFetch.Response>
  >;
  let secretsStub: SinonStubbedInstance<
    Pick<vscode.SecretStorage, "get" | "store">
  >;
  let extensionContextStub: SinonStubbedInstance<
    Partial<vscode.ExtensionContext>
  >;
  let redirectUriHandlerStub: SinonStubbedInstance<CodeProvider>;
  let registrationDisposable: DisposableStub;
  let authProvider: GoogleAuthProvider;

  beforeEach(() => {
    fetchStub = sinon.stub(nodeFetch, "default");
    secretsStub = {
      get: sinon.stub(),
      store: sinon.stub(),
    };
    extensionContextStub = {
      extension: {
        packageJSON: {
          publisher: "google",
          name: "colab",
        },
      } as vscode.Extension<never>,
      secrets:
        secretsStub as Partial<vscode.SecretStorage> as vscode.SecretStorage,
    };
    redirectUriHandlerStub = {
      waitForCode: sinon.stub(),
    };
    registrationDisposable = new DisposableStub();
    DisposableStub.from.returns(registrationDisposable);

    authProvider = new GoogleAuthProvider(
      vscodeStub,
      extensionContextStub as vscode.ExtensionContext,
      oAuth2Client,
      redirectUriHandlerStub,
    );
  });

  afterEach(() => {
    fetchStub.restore();
    sinon.reset();
  });

  describe("lifecycle", () => {
    it('registers the "Google" authentication provider', () => {
      sinon.assert.calledOnceWithExactly(
        registerAuthenticationProviderStub,
        "google",
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
    it("returns an empty array when no sessions are stored", async () => {
      secretsStub.get.withArgs(SESSIONS_KEY).resolves(undefined);

      const sessions = await authProvider.getSessions(undefined, {});

      assert.deepEqual(sessions, []);
    });

    it("returns a session when one is stored", async () => {
      const mockSessions = [DEFAULT_SESSION];
      secretsStub.get
        .withArgs(SESSIONS_KEY)
        .resolves(JSON.stringify(mockSessions));

      const sessions = await authProvider.getSessions(undefined, {});

      assert.deepEqual(sessions, mockSessions);
    });

    it("returns all sessions when multiple are stored", async () => {
      const secondSession = {
        ...DEFAULT_SESSION,
        id: "2",
      };
      const mockSessions = [DEFAULT_SESSION, secondSession];
      secretsStub.get
        .withArgs(SESSIONS_KEY)
        .resolves(JSON.stringify(mockSessions));

      const sessions = await authProvider.getSessions(undefined, {});

      assert.deepEqual(sessions, mockSessions);
    });
  });

  describe("createSession", () => {
    it("warns when login fails", async () => {
      const cancellationStub: SinonStubbedInstance<vscode.CancellationToken> = {
        isCancellationRequested: false,
        onCancellationRequested: sinon.stub(),
      };
      withProgressStub
        .withArgs(
          sinon.match({
            location: ProgressLocation.Notification,
            title: sinon.match(/Signing in/),
            cancellable: true,
          }),
          sinon.match.any,
        )
        .callsFake(
          (
            _,
            task: (
              progress: vscode.Progress<{
                message?: string;
                increment?: number;
              }>,
              token: vscode.CancellationToken,
            ) => Thenable<string>,
          ) => {
            return task({ report: sinon.stub() }, cancellationStub);
          },
        );
      redirectUriHandlerStub.waitForCode.throws(new Error("Barf"));

      await expect(authProvider.createSession(REQUIRED_SCOPES)).to.be.rejected;

      sinon.assert.calledOnceWithMatch(
        showErrorMessageStub,
        sinon.match(/Sign in failed.+/),
      );
    });

    it("succeeds", async () => {
      const cancellationStub: SinonStubbedInstance<vscode.CancellationToken> = {
        isCancellationRequested: false,
        onCancellationRequested: sinon.stub(),
      };
      withProgressStub
        .withArgs(
          sinon.match({
            location: ProgressLocation.Notification,
            title: sinon.match(/Signing in/),
            cancellable: true,
          }),
          sinon.match.any,
        )
        .callsFake(
          (
            _,
            task: (
              progress: vscode.Progress<{
                message?: string;
                increment?: number;
              }>,
              token: vscode.CancellationToken,
            ) => Thenable<string>,
          ) => {
            return task({ report: sinon.stub() }, cancellationStub);
          },
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
      asExternalUriStub
        .withArgs(
          sinon.match((uri: vscode.Uri) => {
            return new RegExp(`vscode://google\\.colab\\?nonce=${nonce}`).test(
              uri.toString(),
            );
          }),
        )
        .callsFake((_uri) =>
          Promise.resolve(
            TestUri.parse(
              `vscode://google.colab?nonce%3D${nonce}%26windowId%3D1`,
            ),
          ),
        );
      openExternalStub
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
      sinon.assert.calledOnce(openExternalStub);
      const [query] = openExternalStub.firstCall.args.map(
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
    });
  });

  describe("removeSession", () => {
    it("does nothing when no sessions exist", async () => {
      secretsStub.get.withArgs(SESSIONS_KEY).resolves(JSON.stringify([]));

      await authProvider.removeSession(DEFAULT_SESSION.id);

      sinon.assert.notCalled(secretsStub.store);
    });

    it("does nothing when provided session does not exist", async () => {
      secretsStub.get
        .withArgs(SESSIONS_KEY)
        .resolves(JSON.stringify([DEFAULT_SESSION]));

      await authProvider.removeSession("does-not-exist");

      sinon.assert.notCalled(secretsStub.store);
    });

    it("removes when there is just the one sessions", async () => {
      secretsStub.get
        .withArgs(SESSIONS_KEY)
        .resolves(JSON.stringify([DEFAULT_SESSION]));

      await authProvider.removeSession(DEFAULT_SESSION.id);

      sinon.assert.calledOnceWithExactly(
        secretsStub.store,
        SESSIONS_KEY,
        JSON.stringify([]),
      );
    });

    it("removes the provided session when there are many", async () => {
      const secondSession = {
        ...DEFAULT_SESSION,
        id: "2",
      };
      const mockSessions = [DEFAULT_SESSION, secondSession];
      secretsStub.get
        .withArgs(SESSIONS_KEY)
        .resolves(JSON.stringify(mockSessions));

      await authProvider.removeSession(DEFAULT_SESSION.id);

      sinon.assert.calledOnceWithExactly(
        secretsStub.store,
        SESSIONS_KEY,
        JSON.stringify([secondSession]),
      );
    });
  });
});
