/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from "chai";
import { OAuth2Client } from "google-auth-library";
import fetch, { RequestInfo, RequestInit, Response } from "node-fetch";
import { SinonStub, SinonStubbedInstance, SinonFakeTimers } from "sinon";
import * as sinon from "sinon";
import vscode from "vscode";
import {
  AUTHORIZATION_HEADER,
  CONTENT_TYPE_JSON_HEADER,
} from "../colab/headers";
import { PROVIDER_ID } from "../config/constants";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { GoogleAuthProvider, REQUIRED_SCOPES } from "./auth-provider";
import { Credentials } from "./login";
import { AuthStorage, RefreshableAuthenticationSession } from "./storage";

const CLIENT_ID = "testClientId";
const SCOPES = Array.from(REQUIRED_SCOPES);
const NOW = Date.now();
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_ACCESS_TOKEN = "42";
const DEFAULT_REFRESH_SESSION: RefreshableAuthenticationSession = {
  id: "1",
  refreshToken: "1//23",
  account: {
    label: "Foo Bar",
    id: "foo@example.com",
  },
  scopes: SCOPES,
};
const DEFAULT_CREDENTIALS = {
  refresh_token: DEFAULT_REFRESH_SESSION.refreshToken,
  access_token: DEFAULT_ACCESS_TOKEN,
  expiry_date: NOW + HOUR_MS,
  id_token: "eh",
  scope: SCOPES.join(" "),
};
const DEFAULT_AUTH_SESSION: vscode.AuthenticationSession = {
  id: DEFAULT_REFRESH_SESSION.id,
  accessToken: DEFAULT_ACCESS_TOKEN,
  account: DEFAULT_REFRESH_SESSION.account,
  scopes: DEFAULT_REFRESH_SESSION.scopes.sort(),
};
const DEFAULT_USER_INFO = {
  id: "1337",
  email: "foo@example.com",
  verified_email: true,
  name: "Foo Bar",
  given_name: "Foo",
  family_name: "Bar",
  picture: "https://example.com/foo.jpg",
  hd: "google.com",
};

describe("GoogleAuthProvider", () => {
  let fakeClock: SinonFakeTimers;
  let vsCodeStub: VsCodeStub;
  let fetchStub: SinonStub<
    [url: RequestInfo, init?: RequestInit | undefined],
    Promise<Response>
  >;
  let storageStub: SinonStubbedInstance<AuthStorage>;
  let loginStub: sinon.SinonStub<[scopes: string[]], Promise<Credentials>>;

  /**
   * Writing tests for the {@link GoogleAuthProvider} is a bit tricky because of
   * the dependency on this *stateful* client. We could completely stub it out,
   * but that would make it hard to test the interactions with it. We could also
   * intercept the fetch calls it makes, but that would make the tests pretty
   * brittle. Instead, we just stub the methods that ultimately make external
   * calls and let the rest of the client do its thing. This is a bit of a
   * compromise, but it seems like the best middle ground.
   */
  let oauth2Client: OAuth2Client;
  let onDidChangeSessionsStub: sinon.SinonStub<
    [vscode.AuthenticationProviderAuthenticationSessionsChangeEvent]
  >;
  let authProvider: GoogleAuthProvider;

  beforeEach(() => {
    fakeClock = sinon.useFakeTimers({ now: NOW, toFake: [] });
    fakeClock.setSystemTime(NOW);
    vsCodeStub = newVsCodeStub();
    fetchStub = sinon.stub(fetch, "default");
    storageStub = sinon.createStubInstance(AuthStorage);
    oauth2Client = new OAuth2Client(
      CLIENT_ID,
      "testClientSecret",
      "https://localhost:8888/vscode/redirect",
    );
    loginStub = sinon.stub();
    onDidChangeSessionsStub = sinon.stub();

    authProvider = new GoogleAuthProvider(
      vsCodeStub.asVsCode(),
      storageStub,
      oauth2Client,
      loginStub,
    );
    authProvider.onDidChangeSessions(onDidChangeSessionsStub);
  });

  afterEach(() => {
    fakeClock.restore();
    fetchStub.restore();
    sinon.restore();
  });

  describe("lifecycle", () => {
    it('registers the "Google" authentication provider', async () => {
      await authProvider.initialize();
      // Expect the provider-specific rejection surrounding the scopes not
      // matching the required set. This validates that the provider was
      // registered and is being used.
      await expect(
        vsCodeStub.authentication.getSession(PROVIDER_ID, [
          "make",
          "it",
          "error",
        ]),
      ).to.eventually.be.rejectedWith(/scopes/);
    });

    it('disposes the "Google" authentication provider', async () => {
      authProvider.dispose();

      await expect(
        vsCodeStub.authentication.getSession(PROVIDER_ID, SCOPES),
      ).to.eventually.be.rejectedWith(/No provider/);
    });

    it("is not functional until initialized", async () => {
      await expect(
        authProvider.getSessions(undefined, {}),
      ).to.eventually.be.rejectedWith(/call initialize/);
      await expect(
        authProvider.createSession([]),
      ).to.eventually.be.rejectedWith(/call initialize/);
      await expect(
        authProvider.removeSession(""),
      ).to.eventually.be.rejectedWith(/call initialize/);
    });

    describe("initialize", () => {
      it("does nothing when there is no stored session", async () => {
        await expect(authProvider.initialize()).to.eventually.be.fulfilled;

        await expect(
          authProvider.getSessions(undefined, {}),
        ).to.eventually.deep.equal([]);
      });

      describe("when there is a stored session", () => {
        beforeEach(() => {
          storageStub.getSession.resolves(DEFAULT_REFRESH_SESSION);
        });

        it("rejects when unable to refresh the OAuth token", async () => {
          // Don't set a new `access_token`.
          sinon.stub(oauth2Client, "refreshAccessToken").resolves();

          await expect(authProvider.initialize()).to.eventually.be.rejectedWith(
            /refresh/,
          );
        });

        it("saturates the oAuth2 credentials", async () => {
          sinon.stub(oauth2Client, "refreshAccessToken").callsFake(() => {
            oauth2Client.credentials.access_token = DEFAULT_ACCESS_TOKEN;
          });
          await expect(authProvider.initialize()).to.eventually.be.fulfilled;

          const session = await GoogleAuthProvider.getOrCreateSession(
            vsCodeStub.asVsCode(),
          );

          expect(session.accessToken).to.equal(DEFAULT_ACCESS_TOKEN);
        });

        it("does not doubly initialize", async () => {
          const setCredentialsSpy = sinon.spy(oauth2Client, "setCredentials");
          const refreshStub = sinon
            .stub(oauth2Client, "refreshAccessToken")
            .callsFake(() => {
              oauth2Client.credentials.access_token = DEFAULT_ACCESS_TOKEN;
            });
          await expect(authProvider.initialize()).to.eventually.be.fulfilled;

          await expect(authProvider.initialize()).to.eventually.be.fulfilled;

          sinon.assert.calledOnce(setCredentialsSpy);
          sinon.assert.calledOnce(refreshStub);
        });
      });
    });
  });

  describe("getSessions", () => {
    let refreshAccessTokenStub: sinon.SinonStubbedMember<
      OAuth2Client["refreshAccessToken"]
    >;
    beforeEach(() => {
      refreshAccessTokenStub = sinon
        .stub(oauth2Client, "refreshAccessToken")
        .callsFake(() => {
          oauth2Client.credentials.access_token = DEFAULT_ACCESS_TOKEN;
        });
    });

    describe("when no session is stored", () => {
      beforeEach(async () => {
        await authProvider.initialize();
      });

      it("returns an empty array when scopes deviate from the supported set", async () => {
        await expect(
          authProvider.getSessions(["foo", "bar"], {}),
        ).to.eventually.deep.equal([]);
      });

      it("returns an empty array", async () => {
        storageStub.getSession.resolves(undefined);

        const sessions = authProvider.getSessions(undefined, {});

        await expect(sessions).to.eventually.deep.equal([]);
        sinon.assert.calledOnce(storageStub.getSession);
      });
    });

    describe("when a session is stored", () => {
      beforeEach(async () => {
        storageStub.getSession.resolves(DEFAULT_REFRESH_SESSION);
        await authProvider.initialize();
      });

      it("returns an empty array when the specified scopes aren't supported", async () => {
        await expect(
          authProvider.getSessions(["foo", "bar"], {}),
        ).to.eventually.deep.equal([]);
      });

      it("returns an empty array when the specified account does not match", async () => {
        const otherAccount = { id: "kev@example.com", label: "Kevin Eger" };
        await expect(
          authProvider.getSessions(SCOPES, {
            account: otherAccount,
          }),
        ).to.eventually.deep.equal([]);
      });

      it("returns the session", async () => {
        const sessions = authProvider.getSessions(undefined, {});

        await expect(sessions).to.eventually.deep.equal([DEFAULT_AUTH_SESSION]);
      });

      it("returns the session when the specified scopes match", async () => {
        const sessions = authProvider.getSessions(SCOPES, {});

        await expect(sessions).to.eventually.deep.equal([DEFAULT_AUTH_SESSION]);
      });

      it("returns the session when the specified account matches", async () => {
        const sessions = authProvider.getSessions(undefined, {
          account: DEFAULT_REFRESH_SESSION.account,
        });

        await expect(sessions).to.eventually.deep.equal([DEFAULT_AUTH_SESSION]);
      });

      it("refreshes the access token when it's close to expiring", async () => {
        refreshAccessTokenStub.callsFake(() => {
          oauth2Client.credentials = {
            ...oauth2Client.credentials,
            access_token: "new",
          };
        });
        const fourMinutesMs = 4 * 60 * 1000;
        fakeClock.tick(HOUR_MS - fourMinutesMs);

        const sessions = authProvider.getSessions(undefined, {});

        await expect(sessions).to.eventually.deep.equal([
          { ...DEFAULT_AUTH_SESSION, accessToken: "new" },
        ]);
      });

      it("refreshes the access token when it's expired", async () => {
        refreshAccessTokenStub.callsFake(() => {
          oauth2Client.credentials = {
            ...oauth2Client.credentials,
            access_token: "new",
          };
        });
        fakeClock.tick(HOUR_MS * 2);

        const sessions = authProvider.getSessions(undefined, {});

        await expect(sessions).to.eventually.deep.equal([
          { ...DEFAULT_AUTH_SESSION, accessToken: "new" },
        ]);
      });
    });
  });

  describe("createSession", () => {
    beforeEach(async () => {
      sinon.stub(oauth2Client, "refreshAccessToken").callsFake(() => {
        oauth2Client.credentials.access_token = DEFAULT_ACCESS_TOKEN;
      });
      await authProvider.initialize();
    });

    it("rejects when the scopes are not supported", async () => {
      await expect(
        authProvider.createSession(["foo", "bar"]),
      ).to.eventually.be.rejectedWith(/scopes/);
    });

    it("rejects when getting token fails", async () => {
      loginStub.rejects(new Error("Failed to get token"));

      await expect(
        authProvider.createSession(SCOPES),
      ).to.eventually.be.rejectedWith(/get token/);

      sinon.assert.calledOnceWithMatch(
        vsCodeStub.window.showErrorMessage,
        sinon.match(/Sign in failed.+/),
      );
    });

    describe("with a successful login", () => {
      beforeEach(() => {
        loginStub.withArgs(SCOPES).resolves(DEFAULT_CREDENTIALS);
        fetchStub
          .withArgs("https://www.googleapis.com/oauth2/v2/userinfo", {
            headers: {
              [AUTHORIZATION_HEADER.key]: `Bearer ${DEFAULT_ACCESS_TOKEN}`,
            },
          })
          .resolves(
            new Response(JSON.stringify(DEFAULT_USER_INFO), {
              status: 200,
              headers: {
                [CONTENT_TYPE_JSON_HEADER.key]: CONTENT_TYPE_JSON_HEADER.value,
              },
            }),
          );
      });

      it("creates a new session", async () => {
        const session = await authProvider.createSession(SCOPES);

        const newSession = {
          ...DEFAULT_AUTH_SESSION,
          id: session.id,
        };
        expect(session).to.deep.equal(newSession);
        sinon.assert.calledOnceWithMatch(
          vsCodeStub.window.showInformationMessage,
          sinon.match(/Signed in/),
        );
        sinon.assert.calledOnceWithExactly(onDidChangeSessionsStub, {
          added: [newSession],
          removed: [],
          changed: [],
        });
      });

      it("replaces an existing session", async () => {
        storageStub.getSession.resolves(DEFAULT_REFRESH_SESSION);
        const session = await authProvider.createSession(SCOPES);

        expect(session).to.deep.equal(DEFAULT_AUTH_SESSION);
        sinon.assert.calledOnceWithMatch(
          vsCodeStub.window.showInformationMessage,
          sinon.match(/Signed in/),
        );
        sinon.assert.calledOnceWithExactly(onDidChangeSessionsStub, {
          added: [],
          removed: [],
          changed: [session],
        });
      });
    });
  });

  describe("removeSession", () => {
    beforeEach(() => {
      sinon.stub(oauth2Client, "refreshAccessToken").callsFake(() => {
        oauth2Client.credentials.access_token = DEFAULT_ACCESS_TOKEN;
      });
    });

    it("does nothing when there is no session", async () => {
      await authProvider.initialize();

      await authProvider.removeSession("foo");

      sinon.assert.notCalled(storageStub.removeSession);
      sinon.assert.notCalled(onDidChangeSessionsStub);
    });

    it("does nothing when the managed session's ID does not match", async () => {
      storageStub.getSession.resolves(DEFAULT_REFRESH_SESSION);
      await authProvider.initialize();

      await authProvider.removeSession("foo");

      sinon.assert.notCalled(storageStub.removeSession);
      sinon.assert.notCalled(onDidChangeSessionsStub);
    });

    describe("when there is a session to remove", () => {
      beforeEach(async () => {
        storageStub.getSession.resolves(DEFAULT_REFRESH_SESSION);
        await authProvider.initialize();
      });

      it("swallows errors from revoking credentials", async () => {
        sinon.stub(oauth2Client, "revokeToken").rejects(new Error("Barf"));

        await expect(authProvider.removeSession(DEFAULT_REFRESH_SESSION.id)).to
          .eventually.be.fulfilled;
      });

      it("removes the session", async () => {
        sinon.stub(oauth2Client, "revokeToken").resolves();

        await authProvider.removeSession(DEFAULT_REFRESH_SESSION.id);

        await expect(
          authProvider.getSessions(undefined, {}),
        ).to.eventually.deep.equal([]);
      });

      it("notifies of the removed session", async () => {
        sinon.stub(oauth2Client, "revokeToken").resolves();

        const session = await authProvider.getSessions(undefined, {});

        await authProvider.removeSession(DEFAULT_REFRESH_SESSION.id);

        sinon.assert.calledOnceWithExactly(onDidChangeSessionsStub, {
          added: [],
          removed: [session[0]],
          changed: [],
        });
      });
    });
  });
});
