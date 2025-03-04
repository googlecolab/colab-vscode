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

describe("CcuInformation", () => {
  let clientStub: SinonStubbedInstance<ColabClient>;
  let fakeClock: SinonFakeTimers;
  let ccuInfo: CcuInformation;

  beforeEach(() => {
    clientStub = createStubInstance(ColabClient);
    fakeClock = useFakeTimers();
  });

  afterEach(() => {
    ccuInfo.dispose();
    fakeClock.restore();
    sinon.restore();
  });

  describe("lifecycle", () => {
    beforeEach(async () => {
      const firstResponse: CcuInfo = {
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
      clientStub.ccuInfo.resolves(firstResponse);
      const vscodeStub = newVsCodeStub();
      ccuInfo = await CcuInformation.initialize(
        vscodeStub.asVsCode(),
        clientStub,
      );
    });

    it("fetches CCU info on initialization", () => {
      sinon.assert.calledOnce(clientStub.ccuInfo);
    });

    it("clears timer on dispose", () => {
      const clearIntervalSpy = sinon.spy(fakeClock, "clearInterval");

      ccuInfo.dispose();

      sinon.assert.calledOnce(clearIntervalSpy);
    });
  });

  it("successfully polls info", async () => {
    const INTERVAL_IN_MS = 1000 * 60 * 5;
    const firstResponse: CcuInfo = {
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
    const secondResponse: CcuInfo = {
      ...firstResponse,
      eligibleGpus: [],
    };
    const thirdResponse: CcuInfo = {
      ...secondResponse,
      currentBalance: 0,
    };
    function stubSuccessfulFetch(response: CcuInfo) {
      clientStub.ccuInfo.resolves(response);
    }
    let updateCount = 0;
    const expectedInfoUpdates = [];

    stubSuccessfulFetch(firstResponse);
    const vscodeStub = newVsCodeStub();
    ccuInfo = await CcuInformation.initialize(
      vscodeStub.asVsCode(),
      clientStub,
    );
    ccuInfo.onDidChangeCcuInfo.event(() => {
      updateCount++;
    });
    await fakeClock.tickAsync(1000);
    expectedInfoUpdates.push(ccuInfo.ccuInfo);

    stubSuccessfulFetch(secondResponse);
    await fakeClock.tickAsync(INTERVAL_IN_MS);
    expectedInfoUpdates.push(ccuInfo.ccuInfo);

    stubSuccessfulFetch(thirdResponse);
    await fakeClock.tickAsync(INTERVAL_IN_MS);
    expectedInfoUpdates.push(ccuInfo.ccuInfo);

    expect(expectedInfoUpdates).to.deep.equal([
      firstResponse,
      secondResponse,
      thirdResponse,
    ]);
    expect(updateCount).to.equal(2);
  });
});
