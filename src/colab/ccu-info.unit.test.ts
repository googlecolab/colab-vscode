import { expect } from "chai";
import * as sinon from "sinon";
import {
  SinonFakeTimers,
  SinonStubbedInstance,
  useFakeTimers,
  createStubInstance,
} from "sinon";
import { newVsCodeStub } from "../test/helpers/vscode";
import { Accelerator, CcuInfo } from "./api";
import { CcuInformation } from "./ccu-info";
import { ColabClient } from "./client";

const FIRST_RESPONSE: CcuInfo = {
  currentBalance: 1,
  consumptionRateHourly: 2,
  assignmentsCount: 3,
  eligibleGpus: [Accelerator.T4],
  ineligibleGpus: [Accelerator.A100, Accelerator.L4],
  freeCcuQuotaInfo: {
    remainingTokens: 4,
    nextRefillTimestampSec: 5,
  },
};

describe("CcuInformation", () => {
  let clientStub: SinonStubbedInstance<ColabClient>;
  let fakeClock: SinonFakeTimers;

  beforeEach(() => {
    clientStub = createStubInstance(ColabClient);
    fakeClock = useFakeTimers();
  });

  afterEach(() => {
    fakeClock.restore();
    sinon.restore();
  });

  describe("lifecycle", () => {
    let ccuInfo: CcuInformation;

    beforeEach(async () => {
      clientStub.ccuInfo.resolves(FIRST_RESPONSE);
      const vscodeStub = newVsCodeStub();
      ccuInfo = await CcuInformation.initialize(
        vscodeStub.asVsCode(),
        clientStub,
      );
    });

    afterEach(() => {
      ccuInfo.dispose();
    });

    it("fetches CCU info on initialization", async () => {
      sinon.assert.calledOnce(clientStub.ccuInfo);
      await expect(clientStub.ccuInfo()).to.eventually.deep.equal(
        FIRST_RESPONSE,
      );
    });

    it("clears timer on dispose", () => {
      const clearIntervalSpy = sinon.spy(fakeClock, "clearInterval");

      ccuInfo.dispose();

      sinon.assert.calledOnce(clearIntervalSpy);
    });
  });

  it("successfully polls info", async () => {
    const intervalInMs = 1000 * 60 * 5;
    const secondResponse: CcuInfo = {
      ...FIRST_RESPONSE,
      eligibleGpus: [],
    };
    const thirdResponse: CcuInfo = {
      ...secondResponse,
      currentBalance: 0,
    };
    let updateCount = 0;
    const expectedInfoUpdates = [];
    clientStub.ccuInfo.resolves(FIRST_RESPONSE);
    const vscodeStub = newVsCodeStub();
    const ccuInfo = await CcuInformation.initialize(
      vscodeStub.asVsCode(),
      clientStub,
    );
    ccuInfo.onDidChangeCcuInfo.event(() => {
      updateCount++;
    });

    await fakeClock.tickAsync(1000);
    expectedInfoUpdates.push(ccuInfo.ccuInfo);
    clientStub.ccuInfo.resolves(secondResponse);
    await fakeClock.tickAsync(intervalInMs);
    expectedInfoUpdates.push(ccuInfo.ccuInfo);
    clientStub.ccuInfo.resolves(thirdResponse);
    await fakeClock.tickAsync(intervalInMs);
    expectedInfoUpdates.push(ccuInfo.ccuInfo);

    expect(expectedInfoUpdates).to.deep.equal([
      FIRST_RESPONSE,
      secondResponse,
      thirdResponse,
    ]);
    expect(updateCount).to.equal(2);
    ccuInfo.dispose();
  });
});
