/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from "chai";
import * as sinon from "sinon";
import {
  SinonFakeTimers,
  SinonStubbedInstance,
  createStubInstance,
} from "sinon";
import { newVsCodeStub, VsCodeStub } from "../../test/helpers/vscode";
import { Accelerator, CcuInfo } from "../api";
import { ColabClient } from "../client";
import { ConsumptionPoller } from "./poller";

const POLL_INTERVAL_MS = 1000 * 60 * 5; // 5 minutes.
const TASK_TIMEOUT_MS = 1000 * 10; // 10 seconds.
const DEFAULT_CCU_INFO: CcuInfo = {
  currentBalance: 1,
  consumptionRateHourly: 2,
  assignmentsCount: 3,
  eligibleGpus: [Accelerator.T4],
  ineligibleGpus: [Accelerator.A100, Accelerator.L4],
  eligibleTpus: [Accelerator.V6E1, Accelerator.V28],
  ineligibleTpus: [Accelerator.V5E1],
  freeCcuQuotaInfo: {
    remainingTokens: 4,
    nextRefillTimestampSec: 5,
  },
};

describe("ConsumptionPoller", () => {
  let fakeClock: SinonFakeTimers;
  let vsCodeStub: VsCodeStub;
  let clientStub: SinonStubbedInstance<ColabClient>;
  let poller: ConsumptionPoller;

  beforeEach(() => {
    fakeClock = sinon.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "setTimeout"],
    });
    vsCodeStub = newVsCodeStub();
    clientStub = createStubInstance(ColabClient);
    poller = new ConsumptionPoller(vsCodeStub.asVsCode(), clientStub);
  });

  afterEach(() => {
    fakeClock.restore();
    sinon.restore();
  });

  describe("lifecycle", () => {
    beforeEach(() => {
      clientStub.getCcuInfo.resolves(DEFAULT_CCU_INFO);
    });

    afterEach(() => {
      poller.dispose();
    });

    it("disposes the runner", async () => {
      clientStub.getCcuInfo.resetHistory();

      poller.dispose();

      await fakeClock.tickAsync(POLL_INTERVAL_MS);
      sinon.assert.notCalled(clientStub.getCcuInfo);
    });

    it("throws when used after being disposed", () => {
      poller.dispose();

      expect(() => {
        poller.on();
      }).to.throw(/disposed/);
      expect(() => {
        poller.off();
      }).to.throw(/disposed/);
    });

    it("aborts slow calls to get CCU info", async () => {
      clientStub.getCcuInfo.resetHistory();
      clientStub.getCcuInfo.onFirstCall().callsFake(
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        async () => new Promise(() => {}),
      );
      poller.on();

      await fakeClock.tickAsync(TASK_TIMEOUT_MS + 1);

      sinon.assert.calledOnce(clientStub.getCcuInfo);
      expect(clientStub.getCcuInfo.firstCall.args[0]?.aborted).to.be.true;
    });
  });

  describe("toggled on", () => {
    beforeEach(async () => {
      clientStub.getCcuInfo.resolves(DEFAULT_CCU_INFO);
      poller.on();
      // Turning the poller on runs the task immediately. Wait past the task
      // timeout to ensure the immediate invocation runs to completion.
      await fakeClock.tickAsync(TASK_TIMEOUT_MS);
      clientStub.getCcuInfo.resetHistory();
    });

    describe("when the CCU info does not change", () => {
      let onDidChangeCcuInfo: sinon.SinonStub<[CcuInfo]>;

      beforeEach(() => {
        onDidChangeCcuInfo = sinon.stub();
        poller.onDidChangeCcuInfo(onDidChangeCcuInfo);
      });

      it("does not emit an event", async () => {
        await fakeClock.tickAsync(POLL_INTERVAL_MS);

        sinon.assert.calledOnce(clientStub.getCcuInfo);
        sinon.assert.notCalled(onDidChangeCcuInfo);
      });
    });

    describe("when the CCU info changes", () => {
      const newCcuInfo: CcuInfo = {
        ...DEFAULT_CCU_INFO,
        eligibleGpus: [],
      };

      let onDidChangeCcuInfo: sinon.SinonStub<[CcuInfo]>;

      beforeEach(() => {
        onDidChangeCcuInfo = sinon.stub();
        poller.onDidChangeCcuInfo(onDidChangeCcuInfo);
        clientStub.getCcuInfo.resolves(newCcuInfo);
      });

      it("emits an event", async () => {
        await fakeClock.tickAsync(POLL_INTERVAL_MS);

        sinon.assert.calledOnce(clientStub.getCcuInfo);
        sinon.assert.calledOnce(onDidChangeCcuInfo);
      });
    });
  });

  it("can be toggled on and off", async () => {
    const onDidChangeCcuInfo: sinon.SinonStub<[CcuInfo]> = sinon.stub();
    poller.onDidChangeCcuInfo(onDidChangeCcuInfo);

    // On for 3.
    clientStub.getCcuInfo.resolves({ ...DEFAULT_CCU_INFO, currentBalance: 3 });
    poller.on();
    await fakeClock.tickAsync(POLL_INTERVAL_MS);

    // Off for 2.
    clientStub.getCcuInfo.resolves({ ...DEFAULT_CCU_INFO, currentBalance: 2 });
    poller.off();
    await fakeClock.tickAsync(POLL_INTERVAL_MS);

    // On for 1.
    clientStub.getCcuInfo.resolves({ ...DEFAULT_CCU_INFO, currentBalance: 1 });
    poller.on();
    await fakeClock.tickAsync(POLL_INTERVAL_MS);

    sinon.assert.calledTwice(onDidChangeCcuInfo);

    sinon.assert.calledWith(
      onDidChangeCcuInfo.firstCall,
      sinon.match({ currentBalance: 3 }),
    );
    sinon.assert.calledWith(
      onDidChangeCcuInfo.secondCall,
      sinon.match({ currentBalance: 1 }),
    );
  });
});
