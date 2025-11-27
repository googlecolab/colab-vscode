/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "crypto";
import { expect } from "chai";
import sinon, { SinonFakeTimers, SinonStubbedInstance } from "sinon";
import {
  AssignmentChangeEvent,
  AssignmentManager,
} from "../jupyter/assignments";
import { ColabAssignedServer } from "../jupyter/servers";
import { ControllableAsyncToggle } from "../test/helpers/async";
import { TestEventEmitter } from "../test/helpers/events";
import { TestUri } from "../test/helpers/uri";
import { Variant } from "./api";
import { NotFoundError } from "./client";
import {
  ConnectionRefreshController,
  ConnectionRefresher,
} from "./connection-refresher";
import {
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
} from "./headers";

const REFRESH_MS = 1000 * 60 * 60;
const DEFAULT_SERVER: ColabAssignedServer = {
  id: randomUUID(),
  label: "Colab GPU A100",
  variant: Variant.GPU,
  accelerator: "A100",
  endpoint: "m-s-foo",
  connectionInformation: {
    baseUrl: TestUri.parse("https://example.com"),
    token: "123",
    tokenExpiry: new Date(Date.now() + REFRESH_MS),
    headers: {
      [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]: "123",
      [COLAB_CLIENT_AGENT_HEADER.key]: COLAB_CLIENT_AGENT_HEADER.value,
    },
  },
  dateAssigned: new Date(),
};
const DEFAULT_SERVER_TOKEN_EXPIRED: ColabAssignedServer = {
  ...DEFAULT_SERVER,
  connectionInformation: {
    ...DEFAULT_SERVER.connectionInformation,
    tokenExpiry: new Date(Date.now() - 1),
  },
};

function expiresInMs(s: ColabAssignedServer) {
  return Math.max(
    s.connectionInformation.tokenExpiry.getTime() - Date.now(),
    0,
  );
}

describe("ConnectionRefreshController", () => {
  let clock: SinonFakeTimers;
  let assignmentStub: SinonStubbedInstance<AssignmentManager>;
  let controller: ConnectionRefreshController;
  let controllerSpy: ControllableAsyncToggle;

  beforeEach(() => {
    clock = sinon.useFakeTimers({ toFake: ["setTimeout"] });
    assignmentStub = sinon.createStubInstance(AssignmentManager);
    controller = new ConnectionRefreshController(assignmentStub);
    controllerSpy = new ControllableAsyncToggle(controller);
  });

  afterEach(() => {
    controller.dispose();
    clock.restore();
  });

  describe("turned on", () => {
    beforeEach(async () => {
      assignmentStub.getAssignedServers.resolves([DEFAULT_SERVER]);

      controller.on();
      await controllerSpy.turnOn.call(0).waitForCompletion();
    });

    it("refreshes connections ", async () => {
      await clock.tickAsync(REFRESH_MS + 1);
      sinon.assert.calledOnce(assignmentStub.refreshConnection);
    });

    it("stops refreshing connections when turned off", async () => {
      await clock.tickAsync(REFRESH_MS + 1);
      sinon.assert.calledOnce(assignmentStub.refreshConnection);
      assignmentStub.refreshConnection.resetHistory();

      controller.off();

      await controllerSpy.turnOff.call(0).waitForCompletion();
      await clock.tickAsync(REFRESH_MS + 1);
      sinon.assert.notCalled(assignmentStub.refreshConnection);
    });
  });
});

describe("ConnectionRefresher", () => {
  let assignmentStub: SinonStubbedInstance<AssignmentManager>;
  let assignmentsChangeEmitter: TestEventEmitter<AssignmentChangeEvent>;

  beforeEach(() => {
    assignmentStub = sinon.createStubInstance(AssignmentManager);
    assignmentsChangeEmitter = new TestEventEmitter<AssignmentChangeEvent>();
    // Needed to work around the property being readonly.
    Object.defineProperty(assignmentStub, "onDidAssignmentsChange", {
      value: sinon.stub(),
    });
    assignmentStub.onDidAssignmentsChange.callsFake(
      assignmentsChangeEmitter.event,
    );
  });

  describe("lifecycle", () => {
    describe("initialize", () => {
      it("creates a new connection refresher when there are no servers", async () => {
        assignmentStub.getAssignedServers.resolves([]);

        const initialization = ConnectionRefresher.initialize(assignmentStub);
        await expect(initialization).to.eventually.be.fulfilled;

        (await initialization).dispose();
      });

      it("creates a new connection refresher with a single server not needing refreshing", async () => {
        assignmentStub.getAssignedServers.resolves([DEFAULT_SERVER]);

        const initialization = ConnectionRefresher.initialize(assignmentStub);
        await expect(initialization).to.eventually.be.fulfilled;

        (await initialization).dispose();
      });

      it("creates a new connection refresher with a multiple servers not needing refreshing", async () => {
        assignmentStub.getAssignedServers.resolves([
          DEFAULT_SERVER,
          { ...DEFAULT_SERVER, id: randomUUID() },
        ]);

        const initialization = ConnectionRefresher.initialize(assignmentStub);
        await expect(initialization).to.eventually.be.fulfilled;

        (await initialization).dispose();
      });

      it("refreshes a single server before creating a new connection refresher", async () => {
        assignmentStub.getAssignedServers.resolves([
          DEFAULT_SERVER_TOKEN_EXPIRED,
        ]);

        const initialization = ConnectionRefresher.initialize(assignmentStub);
        await expect(initialization).to.eventually.be.fulfilled;

        sinon.assert.calledOnceWithMatch(
          assignmentStub.refreshConnection,
          DEFAULT_SERVER_TOKEN_EXPIRED.id,
        );
        (await initialization).dispose();
      });

      it("refreshes multiple servers before creating a new connection refresher", async () => {
        const server1 = DEFAULT_SERVER_TOKEN_EXPIRED;
        const server2 = { ...server1, id: randomUUID() };
        assignmentStub.getAssignedServers.resolves([server1, server2]);

        const initialization = ConnectionRefresher.initialize(assignmentStub);
        await expect(initialization).to.eventually.be.fulfilled;

        sinon.assert.calledTwice(assignmentStub.refreshConnection);
        sinon.assert.calledWith(assignmentStub.refreshConnection, server1.id);
        sinon.assert.calledWith(assignmentStub.refreshConnection, server2.id);
        (await initialization).dispose();
      });

      it("refreshes only servers needing it before creating a new connection refresher", async () => {
        const server2 = {
          ...DEFAULT_SERVER_TOKEN_EXPIRED,
          id: randomUUID(),
        };
        assignmentStub.getAssignedServers.resolves([DEFAULT_SERVER, server2]);

        const initialization = ConnectionRefresher.initialize(assignmentStub);
        await expect(initialization).to.eventually.be.fulfilled;

        sinon.assert.calledOnceWithMatch(
          assignmentStub.refreshConnection,
          server2.id,
        );
        (await initialization).dispose();
      });

      it("aborts initialization when signalled", async () => {
        let getAbortSignal: AbortSignal | undefined;
        assignmentStub.getAssignedServers.callsFake((signal) => {
          getAbortSignal = signal;
          return Promise.resolve([DEFAULT_SERVER_TOKEN_EXPIRED]);
        });
        let refreshAbortSignal: AbortSignal | undefined;
        const cancel = new AbortController();
        assignmentStub.refreshConnection.callsFake((_id, signal) => {
          refreshAbortSignal = signal;
          // Trigger the abort after refresh was called.
          cancel.abort();
          return Promise.resolve(DEFAULT_SERVER);
        });

        await expect(
          ConnectionRefresher.initialize(assignmentStub, cancel.signal),
        ).to.eventually.be.rejectedWith(/initialization aborted/);

        expect(
          getAbortSignal?.aborted,
          "Call to get assigned servers should be aborted",
        ).to.be.true;
        expect(
          refreshAbortSignal?.aborted,
          "Call to refresh servers should be aborted",
        ).to.be.true;
      });
    });

    describe("dispose", () => {
      let clock: SinonFakeTimers;

      beforeEach(() => {
        clock = sinon.useFakeTimers({ toFake: ["setTimeout"] });
      });

      afterEach(() => {
        clock.restore();
      });

      it("clears scheduled refreshes", async () => {
        assignmentStub.getAssignedServers.resolves([DEFAULT_SERVER]);
        const refresher = await ConnectionRefresher.initialize(assignmentStub);

        refresher.dispose();

        await clock.tickAsync(expiresInMs(DEFAULT_SERVER));
        sinon.assert.notCalled(assignmentStub.refreshConnection);
      });
    });

    describe("refresh with a server", () => {
      let server = DEFAULT_SERVER;
      let clock: SinonFakeTimers;
      let refresher: ConnectionRefresher;

      beforeEach(async () => {
        clock = sinon.useFakeTimers({ toFake: ["setTimeout"] });
        assignmentStub.getAssignedServers.resolves([server]);
        refresher = await ConnectionRefresher.initialize(assignmentStub);
        assignmentStub.refreshConnection.callsFake(() => {
          server = {
            ...server,
            connectionInformation: {
              ...server.connectionInformation,
              tokenExpiry: new Date(Date.now() + REFRESH_MS),
            },
          };
          assignmentsChangeEmitter.fire({
            added: [],
            changed: [server],
            removed: [],
          });
          return Promise.resolve(server);
        });
      });

      afterEach(() => {
        refresher.dispose();
        clock.restore();
      });

      it("refreshes a connection before its expiry", async () => {
        await clock.tickAsync(expiresInMs(server) - 1);
        sinon.assert.calledOnce(assignmentStub.refreshConnection);
      });

      it("schedules a refresh after refreshing", async () => {
        await clock.tickAsync(expiresInMs(server) - 1);
        sinon.assert.calledOnce(assignmentStub.refreshConnection);

        await clock.tickAsync(REFRESH_MS + 1);
        sinon.assert.calledTwice(assignmentStub.refreshConnection);
      });

      it("stops refreshing if the server to refresh is gone", async () => {
        assignmentStub.refreshConnection
          .onFirstCall()
          .rejects(new NotFoundError());
        await clock.tickAsync(expiresInMs(server) - 1);
        assignmentStub.refreshConnection.resetHistory();

        await clock.tickAsync(REFRESH_MS + 1);
        sinon.assert.notCalled(assignmentStub.refreshConnection);
      });

      it("schedules a retry on failure if within buffer", async () => {
        assignmentStub.refreshConnection.onFirstCall().rejects("💩");
        await clock.tickAsync(expiresInMs(server) - 60 * 1000);

        sinon.assert.calledTwice(assignmentStub.refreshConnection);
      });

      it("schedules a normal refresh after a successful retry", async () => {
        assignmentStub.refreshConnection.onFirstCall().rejects("💩");
        await clock.tickAsync(expiresInMs(server) - 60 * 1000);

        sinon.assert.calledTwice(assignmentStub.refreshConnection);
        await clock.tickAsync(REFRESH_MS + 1);
        sinon.assert.calledThrice(assignmentStub.refreshConnection);
      });

      it("gives up retrying if outside buffer", async () => {
        assignmentStub.refreshConnection.onFirstCall().rejects("💩");
        await clock.tickAsync(expiresInMs(server) - 1);

        sinon.assert.calledTwice(assignmentStub.refreshConnection);
      });

      describe("as assignments change", () => {
        it("schedules new servers for refreshes", async () => {
          const server2 = { ...server, id: randomUUID() };
          assignmentsChangeEmitter.fire({
            added: [server2],
            changed: [],
            removed: [],
          });

          await clock.tickAsync(REFRESH_MS + 1);
          sinon.assert.calledTwice(assignmentStub.refreshConnection);
          sinon.assert.calledWithMatch(
            assignmentStub.refreshConnection,
            server.id,
          );
          sinon.assert.calledWithMatch(
            assignmentStub.refreshConnection,
            server2.id,
          );
        });

        it("no-ops when irrelevant changes are made", async () => {
          assignmentsChangeEmitter.fire({
            added: [],
            changed: [{ ...server, label: "foo" }],
            removed: [],
          });

          await clock.tickAsync(REFRESH_MS + 1);
          sinon.assert.calledOnce(assignmentStub.refreshConnection);
        });

        // This test is the exact same as "schedules a refresh after refreshing"
        // above, but is included to reinforce the fact that refreshes are
        // scheduled as a result of the assigned server updating.
        it("updates the scheduled refresh when the expiry changes", async () => {
          await clock.tickAsync(expiresInMs(server) - 1);
          sinon.assert.calledOnce(assignmentStub.refreshConnection);

          await clock.tickAsync(REFRESH_MS + 1);
          sinon.assert.calledTwice(assignmentStub.refreshConnection);
        });

        it("stops scheduling refreshes for removed servers", async () => {
          assignmentsChangeEmitter.fire({
            added: [],
            changed: [],
            removed: [{ server, userInitiated: false }],
          });

          await clock.tickAsync(REFRESH_MS + 1);
          sinon.assert.notCalled(assignmentStub.refreshConnection);
        });

        it("ignores changes after being disposed", async () => {
          refresher.dispose();

          await clock.tickAsync(expiresInMs(server) - 1);
          await clock.tickAsync(REFRESH_MS + 1);
          await clock.tickAsync(REFRESH_MS + 1);

          sinon.assert.notCalled(assignmentStub.refreshConnection);
        });
      });
    });
  });
});
