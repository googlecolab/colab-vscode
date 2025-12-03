/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { assert, expect } from "chai";
import sinon, { SinonStubbedInstance } from "sinon";
import type { LanguageClient } from "vscode-languageclient/node";
import { AuthChangeEvent } from "../auth/auth-provider";
import {
  AssignmentChangeEvent,
  AssignmentManager,
} from "../jupyter/assignments";
import { ColabAssignedServer } from "../jupyter/servers";
import { Deferred } from "../test/helpers/async";
import { TestEventEmitter } from "../test/helpers/events";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { LanguageClientController, ServerChangeEvent } from "./controller";
import { LanguageClientFactory } from "./language-client";

type LanguageClientStub = sinon.SinonStubbedInstance<LanguageClient>;

function newLanguageClientStub(): LanguageClientStub {
  return {
    needsStart: sinon.stub<[], boolean>().resolves(true),
    start: sinon.stub<[], Promise<void>>().resolves(),
    dispose: sinon.stub<[], Promise<void>>().resolves(),
  } as unknown as LanguageClientStub;
}

/**
 * Breaks the event loop.
 *
 * There are cases where we don't kick off any async work (from the sync
 * signals) and therefore have no hooks to guarantee/guard that we aren't
 * running. Here we break the event loop, allowing any scheduled promise
 * callbacks to execute.
 */
async function breakEventLoop() {
  await new Promise((r) => setTimeout(r, 0));
}

describe("LanguageClientController", () => {
  let vsCodeStub: VsCodeStub;
  let authChangeEmitter: TestEventEmitter<AuthChangeEvent>;
  let assignmentStub: SinonStubbedInstance<AssignmentManager>;
  let assignmentsChangeEmitter: TestEventEmitter<AssignmentChangeEvent>;
  let factory: sinon.SinonStub<
    Parameters<LanguageClientFactory>,
    ReturnType<LanguageClientFactory>
  >;
  let controller: LanguageClientController;

  const server1 = { endpoint: "server1" } as ColabAssignedServer;
  const server2 = { endpoint: "server2" } as ColabAssignedServer;
  const server3 = { endpoint: "server3" } as ColabAssignedServer;

  function nextChange(): Promise<ServerChangeEvent>;
  function nextChange(
    kind: "connected" | "disconnected",
  ): Promise<ColabAssignedServer>;
  function nextChange(
    kind?: "connected" | "disconnected",
  ): Promise<ColabAssignedServer | ServerChangeEvent> {
    return new Promise((r) => {
      const l = controller.onDidLanguageServerChange((e) => {
        if (kind && e.kind !== kind) {
          return;
        }
        r(kind ? e.server : e);
        l.dispose();
      });
    });
  }

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    authChangeEmitter = new TestEventEmitter<AuthChangeEvent>();
    assignmentStub = sinon.createStubInstance(AssignmentManager);
    assignmentsChangeEmitter = new TestEventEmitter<AssignmentChangeEvent>();
    // Needed to work around the property being readonly.
    Object.defineProperty(assignmentStub, "onDidAssignmentsChange", {
      value: sinon.stub(),
    });
    assignmentStub.onDidAssignmentsChange.callsFake(
      assignmentsChangeEmitter.event,
    );
    factory = sinon.stub();
    factory.callsFake(() => newLanguageClientStub());

    controller = new LanguageClientController(
      vsCodeStub.asVsCode(),
      authChangeEmitter.event,
      assignmentStub,
      factory,
    );
  });

  afterEach(() => {
    controller.dispose();
    sinon.restore();
  });

  function lsClientAt(call: number): LanguageClientStub | undefined {
    if (call > factory.callCount - 1) {
      return undefined;
    }
    return factory.getCall(call).returnValue as LanguageClientStub;
  }

  describe("lifecycle", () => {
    it("disposes the auth event listener", () => {
      expect(authChangeEmitter.hasListeners()).to.be.true;

      controller.dispose();

      expect(authChangeEmitter.hasListeners()).to.be.false;
    });

    it("disposes the assignments change listener", () => {
      expect(assignmentsChangeEmitter.hasListeners()).to.be.true;

      controller.dispose();

      expect(assignmentsChangeEmitter.hasListeners()).to.be.false;
    });

    it("disposes the active client when disposed", async () => {
      assignmentStub.latestServer.resolves(server1);
      const connected = nextChange("connected");
      authChangeEmitter.fire({
        hasValidSession: true,
        added: [],
        removed: [],
        changed: [],
      });
      await connected;
      sinon.assert.calledOnce(factory);
      const lsClient = lsClientAt(0);
      assert(lsClient);
      sinon.assert.calledOnce(lsClient.start);
      const clientDisposed = new Promise<void>((r) => {
        lsClient.dispose.callsFake(() => {
          r();
          return Promise.resolve();
        });
      });

      controller.dispose();

      await expect(clientDisposed).to.eventually.be.fulfilled;
    });
  });

  it("ignores valid auth session changes if already authorized", async () => {
    const fireValidSessionAuthChange = () => {
      authChangeEmitter.fire({
        hasValidSession: true,
        added: [],
        removed: [],
        changed: [],
      });
    };
    fireValidSessionAuthChange();
    fireValidSessionAuthChange();
    await breakEventLoop();

    sinon.assert.calledOnce(assignmentStub.latestServer);
  });

  it("ignores invalid auth session changes if not currently authorized", async () => {
    // Initial state is unauthorized.
    authChangeEmitter.fire({
      hasValidSession: false,
      added: [],
      removed: [],
      changed: [],
    });
    await breakEventLoop();

    sinon.assert.notCalled(assignmentStub.latestServer);
  });

  it("no-ops once authorized when there are no servers", async () => {
    assignmentStub.latestServer.resolves(undefined);

    authChangeEmitter.fire({
      hasValidSession: true,
      added: [],
      removed: [],
      changed: [],
    });
    await breakEventLoop();

    sinon.assert.calledOnce(assignmentStub.latestServer);
    sinon.assert.notCalled(factory);
  });

  it("connects to only server once authorized", async () => {
    assignmentStub.latestServer.resolves(server1);
    const connected = nextChange("connected");

    authChangeEmitter.fire({
      hasValidSession: true,
      added: [],
      removed: [],
      changed: [],
    });

    await expect(connected).to.eventually.equal(server1);
    sinon.assert.calledOnce(factory);
    const lsClient = lsClientAt(0);
    assert(lsClient);
    sinon.assert.calledOnce(lsClient.start);
  });

  it("tears down client once unauthorized when connected to server", async () => {
    assignmentStub.latestServer.resolves(server1);
    const connected = nextChange("connected");
    authChangeEmitter.fire({
      hasValidSession: true,
      added: [],
      removed: [],
      changed: [],
    });
    await connected;
    const disconnected = nextChange("disconnected");

    authChangeEmitter.fire({
      hasValidSession: false,
      added: [],
      removed: [],
      changed: [],
    });

    await disconnected;
  });

  it("ignores server changes while unauthorized", async () => {
    assignmentsChangeEmitter.fire({
      added: [server1],
      removed: [],
      changed: [],
    });
    await breakEventLoop();

    sinon.assert.notCalled(assignmentStub.latestServer);
  });

  describe("while authorized", () => {
    beforeEach(async () => {
      assignmentStub.latestServer.resolves(undefined);
      authChangeEmitter.fire({
        hasValidSession: true,
        added: [],
        removed: [],
        changed: [],
      });
      await breakEventLoop();
      assignmentStub.latestServer.resetHistory();
    });

    describe("with no servers", () => {
      it("connects to new server", async () => {
        assignmentStub.latestServer.resolves(server1);
        const connected = nextChange("connected");

        assignmentsChangeEmitter.fire({
          added: [server1],
          removed: [],
          changed: [],
        });

        await expect(connected).to.eventually.equal(server1);
        sinon.assert.calledOnce(factory);
      });

      it("connects to latest server", async () => {
        assignmentStub.latestServer.resolves(server2);
        const connected = nextChange("connected");

        assignmentsChangeEmitter.fire({
          added: [server1, server2],
          removed: [],
          changed: [],
        });

        await expect(connected).to.eventually.equal(server2);
      });
    });

    describe("with a single server", () => {
      beforeEach(async () => {
        assignmentStub.latestServer.resolves(server1);
        const connected = nextChange("connected");
        assignmentsChangeEmitter.fire({
          added: [server1],
          removed: [],
          changed: [],
        });
        await connected;
      });

      it("disconnects when server's removed", async () => {
        assignmentStub.latestServer.resolves(undefined);
        const disconnected = nextChange("disconnected");

        assignmentsChangeEmitter.fire({
          added: [],
          removed: [{ server: server1, userInitiated: true }],
          changed: [],
        });

        await disconnected;
        const lsClient = lsClientAt(0);
        assert(lsClient);
        sinon.assert.calledOnce(lsClient.dispose);
      });

      it("disconnects when there's a newer server and connects to it", async () => {
        assignmentStub.latestServer.resolves(server2);
        const disconnected = nextChange("disconnected");
        const connected = nextChange("connected");

        assignmentsChangeEmitter.fire({
          added: [server2],
          removed: [],
          changed: [],
        });

        await expect(disconnected).to.eventually.equal(server1);
        const server1LsClient = lsClientAt(0);
        assert(server1LsClient);
        sinon.assert.calledOnce(server1LsClient.start);
        sinon.assert.calledOnce(server1LsClient.dispose);
        await expect(connected).to.eventually.equal(server2);
        const server2LsClient = lsClientAt(1);
        assert(server2LsClient);
        sinon.assert.calledOnce(server2LsClient.start);
        sinon.assert.notCalled(server2LsClient.dispose);
      });
    });

    describe("with multiple servers", () => {
      beforeEach(async () => {
        assignmentStub.latestServer.resolves(server2);
        const connected = nextChange("connected");
        assignmentsChangeEmitter.fire({
          added: [server1, server2],
          removed: [],
          changed: [],
        });
        await connected;
      });

      it("disconnects when all servers are removed", async () => {
        assignmentStub.latestServer.resolves(undefined);
        const disconnected = nextChange("disconnected");

        assignmentsChangeEmitter.fire({
          added: [],
          removed: [
            { server: server1, userInitiated: true },
            { server: server2, userInitiated: true },
          ],
          changed: [],
        });

        await disconnected;
      });

      it("no-ops when and older unused server is removed", async () => {
        assignmentStub.latestServer.resolves(server2);
        const unexpectedChange = nextChange();

        assignmentsChangeEmitter.fire({
          added: [],
          removed: [{ server: server1, userInitiated: true }],
          changed: [],
        });

        await breakEventLoop();
        expect(unexpectedChange).to.not.be.fulfilled;
      });

      it("disconnects when removed and connects to latest remaining server", async () => {
        assignmentStub.latestServer.resolves(server1);
        const connected = nextChange("connected");
        const disconnected = nextChange("disconnected");

        assignmentsChangeEmitter.fire({
          added: [],
          removed: [{ server: server2, userInitiated: true }],
          changed: [],
        });

        await expect(disconnected).to.eventually.equal(server2);
        await expect(connected).to.eventually.equal(server1);
      });

      it("disconnects when there's a newer server and connects to it", async () => {
        assignmentStub.latestServer.resolves(server3);
        const connected = nextChange("connected");
        const disconnected = nextChange("disconnected");

        assignmentsChangeEmitter.fire({
          added: [server3],
          removed: [],
          changed: [],
        });

        await expect(disconnected).to.eventually.equal(server2);
        await expect(connected).to.eventually.equal(server3);
      });
    });
  });

  it("aborts when connection is superseded after getting latest server", async () => {
    // Authorize
    authChangeEmitter.fire({
      hasValidSession: true,
      added: [],
      removed: [],
      changed: [],
    });
    await breakEventLoop();
    assignmentStub.latestServer.resetHistory();
    const firstLatestCall = new Deferred<ColabAssignedServer | undefined>();
    assignmentStub.latestServer.onFirstCall().returns(firstLatestCall.promise);
    assignmentStub.latestServer.onSecondCall().resolves(server2);
    // Trigger run 1
    assignmentsChangeEmitter.fire({
      added: [server1],
      removed: [],
      changed: [],
    });
    // Trigger run 2 (which supersedes run 1).
    assignmentsChangeEmitter.fire({
      added: [server2],
      removed: [],
      changed: [],
    });
    // Wait for run 2 to finish connecting.
    await expect(nextChange("connected")).to.eventually.equal(server2);
    // Unblock run 1, where we expect it to abort and no-op.
    const unexpectedChange = nextChange();

    firstLatestCall.resolve(server2);

    await breakEventLoop();
    expect(unexpectedChange).to.not.be.fulfilled;
    sinon.assert.calledTwice(assignmentStub.latestServer);
    sinon.assert.calledOnce(factory); // Only for server2
  });

  it("aborts and disposes client when connection is superseded after starting client", async () => {
    // Authorize
    authChangeEmitter.fire({
      hasValidSession: true,
      added: [],
      removed: [],
      changed: [],
    });
    await breakEventLoop();
    assignmentStub.latestServer.resetHistory();
    // Setup the first client.
    const client1Start = new Deferred<void>();
    const client1 = newLanguageClientStub();
    const client1StartCalled = new Promise<void>((r) => {
      client1.start.callsFake(() => {
        r();
        return client1Start.promise;
      });
    });
    factory.onFirstCall().returns(client1);
    assignmentStub.latestServer.onFirstCall().resolves(server1);
    // Setup the second client.
    const client2 = newLanguageClientStub();
    client2.start.resolves();
    factory.onSecondCall().returns(client2);
    assignmentStub.latestServer.onSecondCall().resolves(server2);
    const connected = nextChange("connected");
    // Trigger run 1
    assignmentsChangeEmitter.fire({
      added: [server1],
      removed: [],
      changed: [],
    });
    await client1StartCalled;
    sinon.assert.calledOnce(client1.start);

    // Trigger run 2 (which supersedes run 1).
    assignmentsChangeEmitter.fire({
      added: [server2],
      removed: [],
      changed: [],
    });
    // Resolve Run 1 start.
    client1Start.resolve();

    await expect(connected).to.eventually.equal(server2);
    // Ensure we yield to allow run 1 to finish disposing.
    await breakEventLoop();
    sinon.assert.calledTwice(factory); // Both run 1 and 2 created a client.
    sinon.assert.calledOnce(client1.dispose);
    sinon.assert.calledOnce(client2.start);
    sinon.assert.notCalled(client2.dispose);
  });
});
