import { expect } from "chai";
import * as nodeFetch from "node-fetch";
import { Response } from "node-fetch";
import * as sinon from "sinon";
import { SinonFakeTimers, SinonMatcher, SinonStub, useFakeTimers } from "sinon";
import { AuthenticationSession } from "vscode";
import { newVsCodeStub } from "../test/helpers/vscode";
import { Accelerator, CcuInfo } from "./api";
import { CcuInformation } from "./ccu-info";
import { ColabClient } from "./client";

const DOMAIN = "https://colab.example.com";
const BEARER_TOKEN = "access-token";

describe("CcuInformation", () => {
  let fetchStub: SinonStub<
    [url: nodeFetch.RequestInfo, init?: nodeFetch.RequestInit | undefined],
    Promise<Response>
  >;
  let sessionStub: SinonStub<[], Promise<AuthenticationSession>>;
  let client: ColabClient;
  let fakeClock: SinonFakeTimers;
  let ccuInfo: CcuInformation;

  beforeEach(() => {
    fetchStub = sinon.stub(nodeFetch, "default");
    sessionStub = sinon.stub<[], Promise<AuthenticationSession>>().resolves({
      id: "mock-id",
      accessToken: BEARER_TOKEN,
      account: {
        id: "mock-account-id",
        label: "mock-account-label",
      },
      scopes: ["foo"],
    } as AuthenticationSession);
    client = new ColabClient(new URL(DOMAIN), sessionStub);
    fakeClock = useFakeTimers();
  });

  afterEach(() => {
    ccuInfo.dispose();
    fakeClock.restore();
    sinon.restore();
  });

  describe('lifeycle', () => {
    beforeEach(async() => {
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
      fetchStub
        .withArgs(matchAuthorizedRequest("tun/m/ccu-info", "GET"))
        .resolves(
          new Response(withXSSI(JSON.stringify(firstResponse)), { status: 200 }),
        );
      const vscodeStub = newVsCodeStub()
      ccuInfo = await CcuInformation.initialize(vscodeStub.asVsCode(), client);
    });

    it('fetches ccuinfo on initialization', () => {
      sinon.assert.calledOnce(fetchStub);
    });

    it('clears timer on dispose', async () => {
      const clearIntervalSpy = sinon.spy(fakeClock, 'clearInterval');

      ccuInfo.dispose();

      sinon.assert.calledOnce(clearIntervalSpy);
    });
  });

  it("successfully polls info", async () => {
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
    function stubSuccesfulFetch(response: unknown) {
      fetchStub
        .withArgs(matchAuthorizedRequest("tun/m/ccu-info", "GET"))
        .resolves(
          new Response(withXSSI(JSON.stringify(response)), { status: 200 }),
        );
    }
    let updateCount = 0;
    const expectedInfoUpdates = []

    stubSuccesfulFetch(firstResponse);
    const vscodeStub = newVsCodeStub()
    ccuInfo = await CcuInformation.initialize(vscodeStub.asVsCode(), client);
    ccuInfo.onDidChangeCcuInfo.event(() => {
      updateCount++;
    });
    await fakeClock.tickAsync(1000);
    expectedInfoUpdates.push(ccuInfo.ccuInfo);

    stubSuccesfulFetch(secondResponse);
    await fakeClock.nextAsync();
    expectedInfoUpdates.push(ccuInfo.ccuInfo);

    stubSuccesfulFetch(thirdResponse);
    await fakeClock.nextAsync();
    expectedInfoUpdates.push(ccuInfo.ccuInfo);

    expect(expectedInfoUpdates).to.deep.equal([firstResponse, secondResponse, thirdResponse]);
    expect(updateCount).to.equal(2);
  });
});

function withXSSI(response: string): string {
  return `)]}'\n${response}`;
}

function matchAuthorizedRequest(
  endpoint: string,
  method: "GET" | "POST",
): SinonMatcher {
  return sinon.match({
    url: sinon.match(`${DOMAIN}/${endpoint}?authuser=0`),
    method: sinon.match(method),
    headers: sinon.match(
      (headers: nodeFetch.Headers) =>
        headers.get("Authorization") === `Bearer ${BEARER_TOKEN}` &&
        headers.get("Accept") === "application/json",
    ),
  });
}
