import { expect } from "chai";
import * as sinon from "sinon";
import {
  SinonFakeTimers,
  SinonStubbedInstance,
  createStubInstance,
} from "sinon";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { SubscriptionTier } from "./api";
import { ColabClient } from "./client";
import { SubscriptionTierChange, SubscriptionWatcher } from "./subscription";

const POLL_INTERVAL_MS = 1000 * 60 * 5; // 5 minutes.
const TASK_TIMEOUT_MS = 1000 * 10; // 10 seconds.

describe("SubscriptionWatcher", () => {
  let fakeClock: SinonFakeTimers;
  let vsCodeStub: VsCodeStub;
  let clientStub: SinonStubbedInstance<ColabClient>;
  let subscriptionWatcher: SubscriptionWatcher;

  beforeEach(() => {
    fakeClock = sinon.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "setTimeout"],
    });
    vsCodeStub = newVsCodeStub();
    clientStub = createStubInstance(ColabClient);

    subscriptionWatcher = new SubscriptionWatcher(
      vsCodeStub.asVsCode(),
      clientStub,
      SubscriptionTier.NONE,
    );
  });

  afterEach(() => {
    subscriptionWatcher.dispose();
  });

  afterEach(() => {
    fakeClock.restore();
    sinon.restore();
  });

  describe("lifecycle", () => {
    it("disposes the runner", async () => {
      subscriptionWatcher.dispose();

      await fakeClock.tickAsync(POLL_INTERVAL_MS);
      sinon.assert.notCalled(clientStub.getSubscriptionTier);
    });

    it("aborts slow calls to get the subscription tier", async () => {
      clientStub.getSubscriptionTier.onFirstCall().callsFake(
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        async () => new Promise(() => {}),
      );

      await fakeClock.tickAsync(POLL_INTERVAL_MS);
      await fakeClock.tickAsync(TASK_TIMEOUT_MS + 1);

      sinon.assert.calledOnce(clientStub.getSubscriptionTier);
      expect(clientStub.getSubscriptionTier.firstCall.args[0]?.aborted).to.be
        .true;
    });
  });

  describe("when the subscription tier does not change", () => {
    let onDidChangeTier: sinon.SinonStub<[SubscriptionTierChange]>;

    beforeEach(() => {
      clientStub.getSubscriptionTier.resolves(SubscriptionTier.NONE);
      onDidChangeTier = sinon.stub();
      subscriptionWatcher.onDidChangeTier(onDidChangeTier);
    });

    it("does not emit an event", async () => {
      await fakeClock.tickAsync(POLL_INTERVAL_MS);

      sinon.assert.calledOnce(clientStub.getSubscriptionTier);
      sinon.assert.notCalled(onDidChangeTier);
    });

    it("gets the subscription tier", async () => {
      expect(subscriptionWatcher.tier).to.deep.equal(SubscriptionTier.NONE);

      await fakeClock.tickAsync(POLL_INTERVAL_MS);

      expect(subscriptionWatcher.tier).to.deep.equal(SubscriptionTier.NONE);
    });
  });

  describe("when the subscription tier changes", () => {
    let onDidChangeTier: sinon.SinonStub<[SubscriptionTierChange]>;

    beforeEach(() => {
      clientStub.getSubscriptionTier
        .onFirstCall()
        .resolves(SubscriptionTier.PRO)
        .onSecondCall()
        .resolves(SubscriptionTier.PRO_PLUS);
      onDidChangeTier = sinon.stub();
      subscriptionWatcher.onDidChangeTier(onDidChangeTier);
    });

    it("emits an event", async () => {
      // From NONE to PRO.
      await fakeClock.tickAsync(POLL_INTERVAL_MS);
      sinon.assert.calledWithExactly(onDidChangeTier.firstCall, {
        from: SubscriptionTier.NONE,
        to: SubscriptionTier.PRO,
      });

      // From PRO to PRO_PLUS.
      await fakeClock.tickAsync(POLL_INTERVAL_MS);
      sinon.assert.calledWithExactly(onDidChangeTier.secondCall, {
        from: SubscriptionTier.PRO,
        to: SubscriptionTier.PRO_PLUS,
      });
    });

    it("gets the subscription tier", async () => {
      expect(subscriptionWatcher.tier).to.deep.equal(SubscriptionTier.NONE);

      // From NONE to PRO.
      await fakeClock.tickAsync(POLL_INTERVAL_MS);
      expect(subscriptionWatcher.tier).to.deep.equal(SubscriptionTier.PRO);

      // From PRO to PRO_PLUS.
      await fakeClock.tickAsync(POLL_INTERVAL_MS);
      expect(subscriptionWatcher.tier).to.deep.equal(SubscriptionTier.PRO_PLUS);
    });
  });
});
