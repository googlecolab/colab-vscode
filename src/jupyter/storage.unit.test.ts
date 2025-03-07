import { randomUUID } from "crypto";
import { assert, expect } from "chai";
import sinon, { SinonStubbedInstance } from "sinon";
import { SecretStorage } from "vscode";
import { Variant } from "../colab/api";
import { PROVIDER_ID } from "../config/constants";
import { SecretStorageFake } from "../test/helpers/secret-storage";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { ColabAssignedServer } from "./servers";
import { ServerStorage } from "./storage";

const ASSIGNED_SERVERS_KEY = `${PROVIDER_ID}.assigned_servers`;

describe("ServerStorage", () => {
  let vsCodeStub: VsCodeStub;
  let secretsStub: SinonStubbedInstance<
    Pick<SecretStorage, "get" | "store" | "delete">
  >;
  let defaultServer: ColabAssignedServer;
  let serverStorage: ServerStorage;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    secretsStub = new SecretStorageFake();
    defaultServer = {
      id: randomUUID(),
      label: "foo",
      variant: Variant.DEFAULT,
      accelerator: undefined,
      connectionInformation: {
        baseUrl: vsCodeStub.Uri.parse("https://example.com"),
        token: "123",
        headers: { foo: "bar" },
      },
    };
    serverStorage = new ServerStorage(
      vsCodeStub.asVsCode(),
      secretsStub as Partial<SecretStorage> as SecretStorage,
    );
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("when no servers are stored", () => {
    describe("get", () => {
      beforeEach(async () => {
        await expect(serverStorage.get()).to.eventually.deep.equal([]);
      });

      it("returns an empty array", () => {
        sinon.assert.calledOnce(secretsStub.get);
      });

      it("caches empty array", async () => {
        // Calling the second time uses the cache.
        await expect(serverStorage.get()).to.eventually.deep.equal([]);

        sinon.assert.calledOnce(secretsStub.get);
      });
    });

    describe("store", () => {
      beforeEach(async () => {
        await expect(serverStorage.store(defaultServer)).to.eventually.be
          .fulfilled;
      });

      it("stores the server", () => {
        sinon.assert.calledOnceWithMatch(
          secretsStub.store,
          ASSIGNED_SERVERS_KEY,
        );
        expect(serverStorage.get()).to.eventually.deep.equal([defaultServer]);
      });

      it("clears the cache", async () => {
        secretsStub.get.resetHistory();
        await serverStorage.get();
        // Calling the second time uses the cache.
        await serverStorage.get();
        sinon.assert.calledOnce(secretsStub.get);
      });
    });

    it("remove is a no-op", async () => {
      await expect(serverStorage.remove(randomUUID())).to.eventually.be.false;

      sinon.assert.notCalled(secretsStub.store);
    });

    describe("clear", () => {
      beforeEach(async () => {
        await expect(serverStorage.clear()).to.be.eventually.fulfilled;
      });

      it("deletes the non-existent servers", () => {
        sinon.assert.calledOnceWithExactly(
          secretsStub.delete,
          ASSIGNED_SERVERS_KEY,
        );
      });

      it("clears the cache", async () => {
        await serverStorage.get();
        // Calling the second time uses the cache.
        await serverStorage.get();

        sinon.assert.calledOnce(secretsStub.get);
      });
    });
  });

  describe("when a single server is stored", () => {
    beforeEach(async () => {
      await assert.isFulfilled(serverStorage.store(defaultServer));
      sinon.assert.calledOnce(secretsStub.store);
      // Reset the history so tests can easily evaluate it.
      secretsStub.get.resetHistory();
      secretsStub.store.resetHistory();
    });

    describe("get", () => {
      it("returns the server", async () => {
        await expect(serverStorage.get()).to.eventually.deep.equal([
          defaultServer,
        ]);

        sinon.assert.calledOnce(secretsStub.get);
      });

      it("caches the returned server", async () => {
        await expect(serverStorage.get()).to.eventually.deep.equal([
          defaultServer,
        ]);

        // Calling the second time uses the cache.
        await expect(serverStorage.get()).to.eventually.deep.equal([
          defaultServer,
        ]);

        sinon.assert.calledOnce(secretsStub.get);
      });
    });

    describe("store", () => {
      it("stores a new server", async () => {
        const newServer = {
          ...defaultServer,
          id: randomUUID(),
        };

        await expect(serverStorage.store(newServer)).to.eventually.be.fulfilled;

        sinon.assert.calledOnceWithMatch(
          secretsStub.store,
          ASSIGNED_SERVERS_KEY,
        );
        expect(serverStorage.get()).to.eventually.deep.equal([
          defaultServer,
          newServer,
        ]);
      });

      it("stores an updated server", async () => {
        const updatedServer = {
          ...defaultServer,
          label: "bar",
        };

        await expect(serverStorage.store(updatedServer)).to.eventually.be
          .fulfilled;

        sinon.assert.calledOnceWithMatch(
          secretsStub.store,
          ASSIGNED_SERVERS_KEY,
        );
        expect(serverStorage.get()).to.eventually.deep.equal([updatedServer]);
      });

      describe("when storing is a no-op", () => {
        it("does not store", async () => {
          await expect(serverStorage.store(defaultServer)).to.eventually.be
            .fulfilled;

          sinon.assert.notCalled(secretsStub.store);
          expect(serverStorage.get()).to.eventually.deep.equal([defaultServer]);
        });

        it("does not clear cache", async () => {
          // Populate the cache.
          await assert.isFulfilled(serverStorage.get());

          await expect(serverStorage.store(defaultServer)).to.be.eventually
            .fulfilled;

          secretsStub.get.resetHistory();
          await expect(serverStorage.get()).to.be.eventually.fulfilled;
          await expect(serverStorage.get()).to.be.eventually.fulfilled;
          sinon.assert.notCalled(secretsStub.get);
        });
      });

      it("clears the cache upon storing the server", async () => {
        const updatedServer = {
          ...defaultServer,
          label: "bar",
        };

        await expect(serverStorage.store(updatedServer)).to.eventually.be
          .fulfilled;

        sinon.assert.calledOnceWithMatch(
          secretsStub.store,
          ASSIGNED_SERVERS_KEY,
        );
        secretsStub.get.resetHistory();
        await expect(serverStorage.get()).to.be.eventually.fulfilled;
        sinon.assert.calledOnce(secretsStub.get);
      });
    });

    describe("remove", () => {
      describe("for the existing server", () => {
        beforeEach(async () => {
          await expect(serverStorage.remove(defaultServer.id)).to.eventually.be
            .true;
          secretsStub.get.resetHistory();
        });

        it("deletes it", () => {
          sinon.assert.calledOnce(secretsStub.store);
          expect(serverStorage.get()).to.eventually.deep.equal([]);
        });

        it("clears the cache", async () => {
          await expect(serverStorage.get()).to.be.eventually.fulfilled;
          sinon.assert.calledOnce(secretsStub.get);
        });
      });

      describe("for a server that does not exist", () => {
        const nonExistentId = randomUUID();

        it("is a no-op", async () => {
          await expect(serverStorage.remove(nonExistentId)).to.eventually.be
            .false;

          sinon.assert.notCalled(secretsStub.store);
        });

        it("does not clear the cache", async () => {
          await assert.isFulfilled(serverStorage.get());

          await expect(serverStorage.remove(nonExistentId)).to.eventually.be
            .false;

          secretsStub.get.resetHistory();
          await expect(serverStorage.get()).to.be.eventually.fulfilled;
          sinon.assert.notCalled(secretsStub.get);
        });
      });
    });

    describe("clear", () => {
      beforeEach(async () => {
        await expect(serverStorage.clear()).to.be.eventually.fulfilled;
      });

      it("deletes the server", () => {
        sinon.assert.calledOnceWithExactly(
          secretsStub.delete,
          ASSIGNED_SERVERS_KEY,
        );
      });

      it("clears the cache", async () => {
        await serverStorage.get();

        sinon.assert.calledOnce(secretsStub.get);
      });
    });
  });

  describe("when multiple servers are stored", () => {
    let servers: ColabAssignedServer[];

    beforeEach(async () => {
      servers = [
        { ...defaultServer, id: randomUUID(), label: "first" },
        { ...defaultServer, id: randomUUID(), label: "second" },
      ];
      for (const server of servers) {
        await assert.isFulfilled(serverStorage.store(server));
      }
      // Reset the history so tests can easily evaluate it.
      secretsStub.get.resetHistory();
      secretsStub.store.resetHistory();
    });

    describe("get", () => {
      it("returns the servers", async () => {
        await expect(serverStorage.get()).to.eventually.have.same.deep.members(
          servers,
        );

        sinon.assert.calledOnce(secretsStub.get);
      });

      it("caches the returned servers", async () => {
        await expect(serverStorage.get()).to.eventually.have.same.deep.members(
          servers,
        );

        // Calling the second time uses the cache.
        await expect(serverStorage.get()).to.eventually.have.same.deep.members(
          servers,
        );

        sinon.assert.calledOnce(secretsStub.get);
      });
    });

    describe("store", () => {
      it("stores a new server", async () => {
        const newServer = {
          ...defaultServer,
          id: randomUUID(),
        };

        await expect(serverStorage.store(newServer)).to.eventually.be.fulfilled;

        sinon.assert.calledOnceWithMatch(
          secretsStub.store,
          ASSIGNED_SERVERS_KEY,
        );
        expect(serverStorage.get()).to.eventually.have.same.deep.members([
          ...servers,
          newServer,
        ]);
      });

      it("stores an updated server", async () => {
        const updatedServer = {
          ...servers[0],
          label: "bar",
        };

        await expect(serverStorage.store(updatedServer)).to.eventually.be
          .fulfilled;

        sinon.assert.calledOnceWithMatch(
          secretsStub.store,
          ASSIGNED_SERVERS_KEY,
        );
        expect(serverStorage.get()).to.eventually.have.same.deep.members([
          updatedServer,
          servers[1],
        ]);
      });

      describe("when storing is a no-op", () => {
        it("does not store", async () => {
          await expect(serverStorage.store(servers[0])).to.eventually.be
            .fulfilled;

          sinon.assert.notCalled(secretsStub.store);
          expect(serverStorage.get()).to.eventually.have.same.deep.members(
            servers,
          );
        });

        it("does not clear cache", async () => {
          // Populate the cache.
          await assert.isFulfilled(serverStorage.get());

          await expect(serverStorage.store(servers[0])).to.be.eventually
            .fulfilled;

          secretsStub.get.resetHistory();
          await expect(serverStorage.get()).to.be.eventually.fulfilled;
          await expect(serverStorage.get()).to.be.eventually.fulfilled;
          sinon.assert.notCalled(secretsStub.get);
        });
      });

      it("clears the cache upon storing the server", async () => {
        const updatedServer = {
          ...servers[0],
          label: "bar",
        };

        await expect(serverStorage.store(updatedServer)).to.eventually.be
          .fulfilled;

        sinon.assert.calledOnceWithMatch(
          secretsStub.store,
          ASSIGNED_SERVERS_KEY,
        );
        secretsStub.get.resetHistory();
        await expect(serverStorage.get()).to.be.eventually.fulfilled;
        sinon.assert.calledOnce(secretsStub.get);
      });
    });

    describe("remove", () => {
      describe("for an existing server", () => {
        beforeEach(async () => {
          await expect(serverStorage.remove(servers[0].id)).to.eventually.be
            .true;
          secretsStub.get.resetHistory();
        });

        it("deletes it", () => {
          sinon.assert.calledOnce(secretsStub.store);
          expect(serverStorage.get()).to.eventually.deep.equal([servers[1]]);
        });

        it("clears the cache", async () => {
          await expect(serverStorage.get()).to.be.eventually.fulfilled;
          sinon.assert.calledOnce(secretsStub.get);
        });
      });

      describe("for a server that does not exist", () => {
        const nonExistentId = randomUUID();

        it("is a no-op", async () => {
          await expect(serverStorage.remove(nonExistentId)).to.eventually.be
            .false;

          sinon.assert.notCalled(secretsStub.store);
        });

        it("does not clear the cache", async () => {
          await assert.isFulfilled(serverStorage.get());

          await expect(serverStorage.remove(nonExistentId)).to.eventually.be
            .false;

          secretsStub.get.resetHistory();
          await expect(serverStorage.get()).to.be.eventually.fulfilled;
          sinon.assert.notCalled(secretsStub.get);
        });
      });
    });

    describe("clear", () => {
      beforeEach(async () => {
        await expect(serverStorage.clear()).to.be.eventually.fulfilled;
      });

      it("deletes the servers", () => {
        sinon.assert.calledOnceWithExactly(
          secretsStub.delete,
          ASSIGNED_SERVERS_KEY,
        );
      });

      it("clears the cache", async () => {
        await serverStorage.get();

        sinon.assert.calledOnce(secretsStub.get);
      });
    });
  });
});
