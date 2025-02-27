<<<<<<< HEAD
import { randomUUID } from "crypto";
=======
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
import { assert, expect } from "chai";
import sinon, { SinonStubbedInstance } from "sinon";
import { SecretStorage } from "vscode";
import { Variant } from "../colab/api";
import { PROVIDER_ID } from "../config/constants";
<<<<<<< HEAD
import { SecretStorageFake } from "../test/helpers/secret-storage";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { ColabAssignedServer } from "./servers";
import { ServerStorage } from "./storage";

const ASSIGNED_SERVERS_KEY = `${PROVIDER_ID}.assigned_servers`;

=======
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { ColabAssignedServer, ServerStorage } from "./storage";

const ASSIGNED_SERVERS_KEY = `${PROVIDER_ID}.assigned_servers`;

/**
 * A thin fake implementation backed by stubs of `SecretStorage` that stores
 * the last value so it can be retrieved on subsequent requests.
 */
class SecretStorageStub
  implements
    SinonStubbedInstance<Pick<SecretStorage, "get" | "store" | "delete">>
{
  private lastStore?: string;

  get = sinon
    .stub<[key: string], Thenable<string | undefined>>()
    .callsFake(() => Promise.resolve(this.lastStore));
  store = sinon
    .stub<[key: string, value: string], Thenable<void>>()
    .callsFake((_, value: string) => {
      this.lastStore = value;
      return Promise.resolve();
    });
  delete = sinon.stub<[key: string], Thenable<void>>().callsFake(() => {
    this.lastStore = undefined;
    return Promise.resolve();
  });
}

>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
describe("ServerStorage", () => {
  let vsCodeStub: VsCodeStub;
  let secretsStub: SinonStubbedInstance<
    Pick<SecretStorage, "get" | "store" | "delete">
  >;
  let defaultServer: ColabAssignedServer;
  let serverStorage: ServerStorage;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
<<<<<<< HEAD
    secretsStub = new SecretStorageFake();
    defaultServer = {
      id: randomUUID(),
      label: "foo",
      variant: Variant.DEFAULT,
      accelerator: undefined,
      endpoint: "m-s-foo",
=======
    secretsStub = new SecretStorageStub();
    defaultServer = {
      id: "42",
      label: "foo",
      variant: Variant.DEFAULT,
      accelerator: undefined,
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
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
<<<<<<< HEAD
    describe("list", () => {
      beforeEach(async () => {
        await expect(serverStorage.list()).to.eventually.deep.equal([]);
=======
    describe("get", () => {
      beforeEach(async () => {
        await expect(serverStorage.get()).to.eventually.deep.equal([]);
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
      });

      it("returns an empty array", () => {
        sinon.assert.calledOnce(secretsStub.get);
      });

      it("caches empty array", async () => {
        // Calling the second time uses the cache.
<<<<<<< HEAD
        await expect(serverStorage.list()).to.eventually.deep.equal([]);
=======
        await expect(serverStorage.get()).to.eventually.deep.equal([]);
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))

        sinon.assert.calledOnce(secretsStub.get);
      });
    });

    describe("store", () => {
      beforeEach(async () => {
<<<<<<< HEAD
        await expect(serverStorage.store([defaultServer])).to.eventually.be
          .fulfilled;
      });

      // TODO: Update tests now that we're accepting an array.

=======
        await expect(serverStorage.store(defaultServer)).to.eventually.be
          .fulfilled;
      });

>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
      it("stores the server", () => {
        sinon.assert.calledOnceWithMatch(
          secretsStub.store,
          ASSIGNED_SERVERS_KEY,
        );
<<<<<<< HEAD
        expect(serverStorage.list()).to.eventually.deep.equal([defaultServer]);
=======
        expect(serverStorage.get()).to.eventually.deep.equal([defaultServer]);
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
      });

      it("clears the cache", async () => {
        secretsStub.get.resetHistory();
<<<<<<< HEAD
        await serverStorage.list();
        // Calling the second time uses the cache.
        await serverStorage.list();
=======
        await serverStorage.get();
        // Calling the second time uses the cache.
        await serverStorage.get();
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
        sinon.assert.calledOnce(secretsStub.get);
      });
    });

    it("remove is a no-op", async () => {
<<<<<<< HEAD
      await expect(serverStorage.remove(randomUUID())).to.eventually.be.false;
=======
      await expect(serverStorage.remove("42")).to.eventually.be.false;
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))

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
<<<<<<< HEAD
        await serverStorage.list();
        // Calling the second time uses the cache.
        await serverStorage.list();
=======
        await serverStorage.get();
        // Calling the second time uses the cache.
        await serverStorage.get();
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))

        sinon.assert.calledOnce(secretsStub.get);
      });
    });
  });

  describe("when a single server is stored", () => {
    beforeEach(async () => {
<<<<<<< HEAD
      await assert.isFulfilled(serverStorage.store([defaultServer]));
=======
      await assert.isFulfilled(serverStorage.store(defaultServer));
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
      sinon.assert.calledOnce(secretsStub.store);
      // Reset the history so tests can easily evaluate it.
      secretsStub.get.resetHistory();
      secretsStub.store.resetHistory();
    });

<<<<<<< HEAD
    describe("list", () => {
      it("returns the server", async () => {
        await expect(serverStorage.list()).to.eventually.deep.equal([
=======
    describe("get", () => {
      it("returns the server", async () => {
        await expect(serverStorage.get()).to.eventually.deep.equal([
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
          defaultServer,
        ]);

        sinon.assert.calledOnce(secretsStub.get);
      });

      it("caches the returned server", async () => {
<<<<<<< HEAD
        await expect(serverStorage.list()).to.eventually.deep.equal([
=======
        await expect(serverStorage.get()).to.eventually.deep.equal([
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
          defaultServer,
        ]);

        // Calling the second time uses the cache.
<<<<<<< HEAD
        await expect(serverStorage.list()).to.eventually.deep.equal([
=======
        await expect(serverStorage.get()).to.eventually.deep.equal([
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
          defaultServer,
        ]);

        sinon.assert.calledOnce(secretsStub.get);
      });
    });

    describe("store", () => {
      it("stores a new server", async () => {
        const newServer = {
          ...defaultServer,
<<<<<<< HEAD
          id: randomUUID(),
        };

        await expect(serverStorage.store([newServer])).to.eventually.be
          .fulfilled;
=======
          id: "1",
        };

        await expect(serverStorage.store(newServer)).to.eventually.be.fulfilled;
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))

        sinon.assert.calledOnceWithMatch(
          secretsStub.store,
          ASSIGNED_SERVERS_KEY,
        );
<<<<<<< HEAD
        expect(serverStorage.list()).to.eventually.deep.equal([
=======
        expect(serverStorage.get()).to.eventually.deep.equal([
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
          defaultServer,
          newServer,
        ]);
      });

      it("stores an updated server", async () => {
        const updatedServer = {
          ...defaultServer,
          label: "bar",
        };

<<<<<<< HEAD
        await expect(serverStorage.store([updatedServer])).to.eventually.be
=======
        await expect(serverStorage.store(updatedServer)).to.eventually.be
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
          .fulfilled;

        sinon.assert.calledOnceWithMatch(
          secretsStub.store,
          ASSIGNED_SERVERS_KEY,
        );
<<<<<<< HEAD
        expect(serverStorage.list()).to.eventually.deep.equal([updatedServer]);
=======
        expect(serverStorage.get()).to.eventually.deep.equal([updatedServer]);
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
      });

      describe("when storing is a no-op", () => {
        it("does not store", async () => {
<<<<<<< HEAD
          await expect(serverStorage.store([defaultServer])).to.eventually.be
            .fulfilled;

          sinon.assert.notCalled(secretsStub.store);
          expect(serverStorage.list()).to.eventually.deep.equal([
            defaultServer,
          ]);
=======
          await expect(serverStorage.store(defaultServer)).to.eventually.be
            .fulfilled;

          sinon.assert.notCalled(secretsStub.store);
          expect(serverStorage.get()).to.eventually.deep.equal([defaultServer]);
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
        });

        it("does not clear cache", async () => {
          // Populate the cache.
<<<<<<< HEAD
          await assert.isFulfilled(serverStorage.list());

          await expect(serverStorage.store([defaultServer])).to.be.eventually
            .fulfilled;

          secretsStub.get.resetHistory();
          await expect(serverStorage.list()).to.be.eventually.fulfilled;
          await expect(serverStorage.list()).to.be.eventually.fulfilled;
=======
          await assert.isFulfilled(serverStorage.get());

          await expect(serverStorage.store(defaultServer)).to.be.eventually
            .fulfilled;

          secretsStub.get.resetHistory();
          await expect(serverStorage.get()).to.be.eventually.fulfilled;
          await expect(serverStorage.get()).to.be.eventually.fulfilled;
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
          sinon.assert.notCalled(secretsStub.get);
        });
      });

      it("clears the cache upon storing the server", async () => {
        const updatedServer = {
          ...defaultServer,
          label: "bar",
        };

<<<<<<< HEAD
        await expect(serverStorage.store([updatedServer])).to.eventually.be
=======
        await expect(serverStorage.store(updatedServer)).to.eventually.be
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
          .fulfilled;

        sinon.assert.calledOnceWithMatch(
          secretsStub.store,
          ASSIGNED_SERVERS_KEY,
        );
        secretsStub.get.resetHistory();
<<<<<<< HEAD
        await expect(serverStorage.list()).to.be.eventually.fulfilled;
=======
        await expect(serverStorage.get()).to.be.eventually.fulfilled;
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
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
<<<<<<< HEAD
          expect(serverStorage.list()).to.eventually.deep.equal([]);
        });

        it("clears the cache", async () => {
          await expect(serverStorage.list()).to.be.eventually.fulfilled;
=======
          expect(serverStorage.get()).to.eventually.deep.equal([]);
        });

        it("clears the cache", async () => {
          await expect(serverStorage.get()).to.be.eventually.fulfilled;
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
          sinon.assert.calledOnce(secretsStub.get);
        });
      });

      describe("for a server that does not exist", () => {
<<<<<<< HEAD
        const nonExistentId = randomUUID();

        it("is a no-op", async () => {
          await expect(serverStorage.remove(nonExistentId)).to.eventually.be
=======
        it("is a no-op", async () => {
          await expect(serverStorage.remove("does-not-exist")).to.eventually.be
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
            .false;

          sinon.assert.notCalled(secretsStub.store);
        });

        it("does not clear the cache", async () => {
<<<<<<< HEAD
          await assert.isFulfilled(serverStorage.list());

          await expect(serverStorage.remove(nonExistentId)).to.eventually.be
            .false;

          secretsStub.get.resetHistory();
          await expect(serverStorage.list()).to.be.eventually.fulfilled;
=======
          await assert.isFulfilled(serverStorage.get());

          await expect(serverStorage.remove("does-not-exist")).to.eventually.be
            .false;

          secretsStub.get.resetHistory();
          await expect(serverStorage.get()).to.be.eventually.fulfilled;
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
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
<<<<<<< HEAD
        await serverStorage.list();
=======
        await serverStorage.get();
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))

        sinon.assert.calledOnce(secretsStub.get);
      });
    });
  });

  describe("when multiple servers are stored", () => {
    let servers: ColabAssignedServer[];

    beforeEach(async () => {
      servers = [
<<<<<<< HEAD
        { ...defaultServer, id: randomUUID(), label: "first" },
        { ...defaultServer, id: randomUUID(), label: "second" },
      ];
      for (const server of servers) {
        await assert.isFulfilled(serverStorage.store([server]));
=======
        { ...defaultServer, id: "1" },
        { ...defaultServer, id: "2" },
      ];
      for (const server of servers) {
        await assert.isFulfilled(serverStorage.store(server));
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
      }
      // Reset the history so tests can easily evaluate it.
      secretsStub.get.resetHistory();
      secretsStub.store.resetHistory();
    });

<<<<<<< HEAD
    describe("list", () => {
      it("returns the servers", async () => {
        await expect(serverStorage.list()).to.eventually.have.same.deep.members(
          servers,
        );
=======
    describe("get", () => {
      it("returns the servers", async () => {
        await expect(serverStorage.get()).to.eventually.deep.equal(servers);
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))

        sinon.assert.calledOnce(secretsStub.get);
      });

      it("caches the returned servers", async () => {
<<<<<<< HEAD
        await expect(serverStorage.list()).to.eventually.have.same.deep.members(
          servers,
        );

        // Calling the second time uses the cache.
        await expect(serverStorage.list()).to.eventually.have.same.deep.members(
          servers,
        );
=======
        await expect(serverStorage.get()).to.eventually.deep.equal(servers);

        // Calling the second time uses the cache.
        await expect(serverStorage.get()).to.eventually.deep.equal(servers);
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))

        sinon.assert.calledOnce(secretsStub.get);
      });
    });

    describe("store", () => {
      it("stores a new server", async () => {
        const newServer = {
          ...defaultServer,
<<<<<<< HEAD
          id: randomUUID(),
        };

        await expect(serverStorage.store([newServer])).to.eventually.be
          .fulfilled;
=======
          id: "3",
        };

        await expect(serverStorage.store(newServer)).to.eventually.be.fulfilled;
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))

        sinon.assert.calledOnceWithMatch(
          secretsStub.store,
          ASSIGNED_SERVERS_KEY,
        );
<<<<<<< HEAD
        expect(serverStorage.list()).to.eventually.have.same.deep.members([
=======
        expect(serverStorage.get()).to.eventually.deep.equal([
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
          ...servers,
          newServer,
        ]);
      });

      it("stores an updated server", async () => {
        const updatedServer = {
          ...servers[0],
          label: "bar",
        };

<<<<<<< HEAD
        await expect(serverStorage.store([updatedServer])).to.eventually.be
=======
        await expect(serverStorage.store(updatedServer)).to.eventually.be
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
          .fulfilled;

        sinon.assert.calledOnceWithMatch(
          secretsStub.store,
          ASSIGNED_SERVERS_KEY,
        );
<<<<<<< HEAD
        expect(serverStorage.list()).to.eventually.have.same.deep.members([
=======
        expect(serverStorage.get()).to.eventually.deep.equal([
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
          updatedServer,
          servers[1],
        ]);
      });

      describe("when storing is a no-op", () => {
        it("does not store", async () => {
<<<<<<< HEAD
          await expect(serverStorage.store([servers[0]])).to.eventually.be
            .fulfilled;

          sinon.assert.notCalled(secretsStub.store);
          expect(serverStorage.list()).to.eventually.have.same.deep.members(
            servers,
          );
=======
          await expect(serverStorage.store(servers[0])).to.eventually.be
            .fulfilled;

          sinon.assert.notCalled(secretsStub.store);
          expect(serverStorage.get()).to.eventually.deep.equal(servers);
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
        });

        it("does not clear cache", async () => {
          // Populate the cache.
<<<<<<< HEAD
          await assert.isFulfilled(serverStorage.list());

          await expect(serverStorage.store([servers[0]])).to.be.eventually
            .fulfilled;

          secretsStub.get.resetHistory();
          await expect(serverStorage.list()).to.be.eventually.fulfilled;
          await expect(serverStorage.list()).to.be.eventually.fulfilled;
=======
          await assert.isFulfilled(serverStorage.get());

          await expect(serverStorage.store(servers[0])).to.be.eventually
            .fulfilled;

          secretsStub.get.resetHistory();
          await expect(serverStorage.get()).to.be.eventually.fulfilled;
          await expect(serverStorage.get()).to.be.eventually.fulfilled;
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
          sinon.assert.notCalled(secretsStub.get);
        });
      });

      it("clears the cache upon storing the server", async () => {
        const updatedServer = {
          ...servers[0],
          label: "bar",
        };

<<<<<<< HEAD
        await expect(serverStorage.store([updatedServer])).to.eventually.be
=======
        await expect(serverStorage.store(updatedServer)).to.eventually.be
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
          .fulfilled;

        sinon.assert.calledOnceWithMatch(
          secretsStub.store,
          ASSIGNED_SERVERS_KEY,
        );
        secretsStub.get.resetHistory();
<<<<<<< HEAD
        await expect(serverStorage.list()).to.be.eventually.fulfilled;
=======
        await expect(serverStorage.get()).to.be.eventually.fulfilled;
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
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
<<<<<<< HEAD
          expect(serverStorage.list()).to.eventually.deep.equal([servers[1]]);
        });

        it("clears the cache", async () => {
          await expect(serverStorage.list()).to.be.eventually.fulfilled;
=======
          expect(serverStorage.get()).to.eventually.deep.equal([servers[1]]);
        });

        it("clears the cache", async () => {
          await expect(serverStorage.get()).to.be.eventually.fulfilled;
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
          sinon.assert.calledOnce(secretsStub.get);
        });
      });

      describe("for a server that does not exist", () => {
<<<<<<< HEAD
        const nonExistentId = randomUUID();

        it("is a no-op", async () => {
          await expect(serverStorage.remove(nonExistentId)).to.eventually.be
=======
        it("is a no-op", async () => {
          await expect(serverStorage.remove("does-not-exist")).to.eventually.be
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
            .false;

          sinon.assert.notCalled(secretsStub.store);
        });

        it("does not clear the cache", async () => {
<<<<<<< HEAD
          await assert.isFulfilled(serverStorage.list());

          await expect(serverStorage.remove(nonExistentId)).to.eventually.be
            .false;

          secretsStub.get.resetHistory();
          await expect(serverStorage.list()).to.be.eventually.fulfilled;
=======
          await assert.isFulfilled(serverStorage.get());

          await expect(serverStorage.remove("does-not-exist")).to.eventually.be
            .false;

          secretsStub.get.resetHistory();
          await expect(serverStorage.get()).to.be.eventually.fulfilled;
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))
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
<<<<<<< HEAD
        await serverStorage.list();
=======
        await serverStorage.get();
>>>>>>> 5fb2a42 (feat: add support for storing the Colab Jupyter servers (#32))

        sinon.assert.calledOnce(secretsStub.get);
      });
    });
  });
});
