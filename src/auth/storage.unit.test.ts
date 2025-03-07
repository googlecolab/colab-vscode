import { expect } from "chai";
import sinon, { SinonStubbedInstance } from "sinon";
import { AuthenticationSession, SecretStorage } from "vscode";
import { PROVIDER_ID } from "../config/constants";
import { SecretStorageFake } from "../test/helpers/secret-storage";
import { AuthStorage } from "./storage";

const SESSIONS_KEY = `${PROVIDER_ID}.sessions`;
const DEFAULT_SESSION: AuthenticationSession = {
  id: "1",
  accessToken: "42",
  account: { id: "foo", label: "bar" },
  scopes: ["baz"],
};

describe("ServerStorage", () => {
  let secretsStub: SinonStubbedInstance<
    Pick<SecretStorage, "get" | "store" | "delete">
  >;
  let authStorage: AuthStorage;

  beforeEach(() => {
    secretsStub = new SecretStorageFake();
    authStorage = new AuthStorage(
      secretsStub as Partial<SecretStorage> as SecretStorage,
    );
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("getSessions", () => {
    it("returns no sessions when none are stored", async () => {
      await expect(authStorage.getSession()).to.eventually.equal(undefined);

      sinon.assert.calledOnceWithExactly(secretsStub.get, SESSIONS_KEY);
    });

    it("returns a single session when one is stored", async () => {
      await authStorage.storeSession(DEFAULT_SESSION);

      await expect(authStorage.getSession()).to.eventually.deep.equal(
        DEFAULT_SESSION,
      );

      sinon.assert.calledOnceWithExactly(secretsStub.get, SESSIONS_KEY);
    });

    it("throws an error when the stored sessions do not conform to the expected schema", async () => {
      secretsStub.store(
        SESSIONS_KEY,
        JSON.stringify([
          { ...DEFAULT_SESSION, account: "shouldn't be a string" },
        ]),
      );

      await expect(authStorage.getSession()).to.eventually.be.rejectedWith(
        /received string/,
      );
    });
  });

  describe("storeSession", () => {
    it("stores the provided session", async () => {
      await authStorage.storeSession(DEFAULT_SESSION);

      await expect(authStorage.getSession()).to.eventually.deep.equal(
        DEFAULT_SESSION,
      );
      sinon.assert.calledOnceWithExactly(
        secretsStub.store,
        SESSIONS_KEY,
        JSON.stringify([DEFAULT_SESSION]),
      );
    });

    it("overrides the existing stored session", async () => {
      const newSession = { ...DEFAULT_SESSION, id: "2" };
      await authStorage.storeSession(DEFAULT_SESSION);

      await authStorage.storeSession(newSession);

      await expect(authStorage.getSession()).to.eventually.deep.equal(
        newSession,
      );
      sinon.assert.calledTwice(secretsStub.store);
      sinon.assert.calledWith(
        secretsStub.store.firstCall,
        SESSIONS_KEY,
        JSON.stringify([DEFAULT_SESSION]),
      );
      sinon.assert.calledWith(
        secretsStub.store.secondCall,
        SESSIONS_KEY,
        JSON.stringify([newSession]),
      );
    });
  });

  describe("removeSession", () => {
    it("returns undefined when no sessions exist", async () => {
      await expect(
        authStorage.removeSession(DEFAULT_SESSION.id),
      ).to.eventually.equal(undefined);

      sinon.assert.notCalled(secretsStub.delete);
    });

    it("returns undefined when the session does not exist", async () => {
      await authStorage.storeSession(DEFAULT_SESSION);

      await expect(
        authStorage.removeSession("does not exist"),
      ).to.eventually.equal(undefined);

      sinon.assert.notCalled(secretsStub.delete);
    });

    it("returns the session when it is the only one and is removed", async () => {
      await authStorage.storeSession(DEFAULT_SESSION);

      await expect(
        authStorage.removeSession(DEFAULT_SESSION.id),
      ).to.eventually.deep.equal(DEFAULT_SESSION);

      sinon.assert.calledOnceWithExactly(secretsStub.delete, SESSIONS_KEY);
    });
  });
});
