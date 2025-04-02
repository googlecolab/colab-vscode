import { expect } from "chai";
import * as sinon from "sinon";
import {
  SinonFakeTimers,
  SinonStubbedInstance,
  createStubInstance,
} from "sinon";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { Accelerator, CcuInfo } from "./api";
import { CcuInformationManager } from "./ccu-info";
import { ColabClient } from "./client";

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

describe("CcuInformation", () => {
  let fakeClock: SinonFakeTimers;
  let vsCodeStub: VsCodeStub;
  let clientStub: SinonStubbedInstance<ColabClient>;

  beforeEach(() => {
    fakeClock = sinon.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "setTimeout"],
    });
    vsCodeStub = newVsCodeStub();
    clientStub = createStubInstance(ColabClient);
  });

  afterEach(() => {
    fakeClock.restore();
    sinon.restore();
  });

  describe("lifecycle", () => {
    let ccuInfo: CcuInformationManager;

    beforeEach(async () => {
      clientStub.ccuInfo.resolves(DEFAULT_CCU_INFO);
      ccuInfo = await CcuInformationManager.initialize(
        vsCodeStub.asVsCode(),
        clientStub,
      );
    });

    afterEach(() => {
      ccuInfo.dispose();
    });

    it("fetches CCU info on initialization", async () => {
      sinon.assert.calledOnce(clientStub.ccuInfo);
      await expect(clientStub.ccuInfo()).to.eventually.deep.equal(
        DEFAULT_CCU_INFO,
      );
    });

    it("disposes the runner", async () => {
      clientStub.ccuInfo.resetHistory();

      ccuInfo.dispose();

      await fakeClock.tickAsync(POLL_INTERVAL_MS);
      sinon.assert.notCalled(clientStub.ccuInfo);
    });

    it("aborts slow calls to get CCU info", async () => {
      clientStub.ccuInfo.resetHistory();
      clientStub.ccuInfo.onFirstCall().callsFake(
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        async () => new Promise(() => {}),
      );

      await fakeClock.tickAsync(POLL_INTERVAL_MS);
      await fakeClock.tickAsync(TASK_TIMEOUT_MS + 1);

      sinon.assert.calledOnce(clientStub.ccuInfo);
      expect(clientStub.ccuInfo.firstCall.args[0]?.aborted).to.be.true;
    });
  });

  describe("when the CCU info does not change", () => {
    let ccuInfo: CcuInformationManager;
    let onDidChangeCcuInfo: sinon.SinonStub<[]>;

    beforeEach(async () => {
      clientStub.ccuInfo.resolves(DEFAULT_CCU_INFO);
      ccuInfo = await CcuInformationManager.initialize(
        vsCodeStub.asVsCode(),
        clientStub,
      );
      onDidChangeCcuInfo = sinon.stub();
      ccuInfo.onDidChangeCcuInfo(onDidChangeCcuInfo);
      clientStub.ccuInfo.resetHistory();
    });

    it("does not emit an event", async () => {
      await fakeClock.tickAsync(POLL_INTERVAL_MS);

      sinon.assert.calledOnce(clientStub.ccuInfo);
      sinon.assert.notCalled(onDidChangeCcuInfo);
    });

    it("gets the CCU info", async () => {
      expect(ccuInfo.ccuInfo).to.deep.equal(DEFAULT_CCU_INFO);

      await fakeClock.tickAsync(POLL_INTERVAL_MS);

      expect(ccuInfo.ccuInfo).to.deep.equal(DEFAULT_CCU_INFO);
    });
  });

  describe("when the CCU info changes", () => {
    const newCcuInfo: CcuInfo = {
      ...DEFAULT_CCU_INFO,
      eligibleGpus: [],
    };

    let ccuInfo: CcuInformationManager;
    let onDidChangeCcuInfo: sinon.SinonStub<[]>;

    beforeEach(async () => {
      clientStub.ccuInfo.onFirstCall().resolves(DEFAULT_CCU_INFO);
      ccuInfo = await CcuInformationManager.initialize(
        vsCodeStub.asVsCode(),
        clientStub,
      );
      onDidChangeCcuInfo = sinon.stub();
      ccuInfo.onDidChangeCcuInfo(onDidChangeCcuInfo);
      clientStub.ccuInfo.resetHistory();
      clientStub.ccuInfo.onFirstCall().resolves(newCcuInfo);
    });

    it("emits an event", async () => {
      await fakeClock.tickAsync(POLL_INTERVAL_MS);

      sinon.assert.calledOnce(onDidChangeCcuInfo);
      sinon.assert.calledOnce(clientStub.ccuInfo);
    });

    it("gets the CCU info", async () => {
      expect(ccuInfo.ccuInfo).to.deep.equal(DEFAULT_CCU_INFO);

      await fakeClock.tickAsync(POLL_INTERVAL_MS);

      expect(ccuInfo.ccuInfo).to.deep.equal(newCcuInfo);
    });
  });
});
