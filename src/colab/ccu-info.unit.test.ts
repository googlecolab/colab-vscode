import { expect } from "chai";
import * as nodeFetch from "node-fetch";
import { Response } from "node-fetch";
import * as sinon from "sinon";
import { SinonFakeTimers, SinonMatcher, SinonStub, useFakeTimers } from "sinon";
import { AuthenticationSession } from "vscode";
import { vscodeStub } from "../test/helpers/vscode";
import { Accelerator, CCUInfo } from "./api";
import { CCUInformation } from "./ccu-info";
import { ColabClient } from "./client";

const DOMAIN = "https://colab.example.com";
const BEARER_TOKEN = "access-token";

describe("CCUInformation", () => {
  let fetchStub: SinonStub<
    [url: nodeFetch.RequestInfo, init?: nodeFetch.RequestInit | undefined],
    Promise<Response>
  >;
  let sessionStub: SinonStub<[], Promise<AuthenticationSession>>;
  let ccuInfo: CCUInformation;
  let clock: SinonFakeTimers;
  let client: ColabClient;

  beforeEach(() => {
    clock = useFakeTimers();
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
  });

  afterEach(() => {
    clock.restore();
    ccuInfo.dispose();
    sinon.restore();
  });

  describe("getCCUInfo", () => {
    it("successfully resolves CCU info", async () => {
      const mockResponse: CCUInfo = {
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
          new Response(withXSSI(JSON.stringify(mockResponse)), { status: 200 }),
        );
      ccuInfo = await CCUInformation.initialize(vscodeStub, client);
      expect(ccuInfo.ccuInfo).to.deep.equal(mockResponse);

      sinon.assert.calledOnce(fetchStub);
    });

    it("rejects when error responses are returned", () => {
      fetchStub.resolves(
        new Response("Error", {
          status: 500,
          statusText: "Internal Server Error",
        }),
      );

      expect(
        CCUInformation.initialize(vscodeStub, client),
      ).to.eventually.be.rejectedWith(
        `Failed to GET ${DOMAIN}/tun/m/ccu-info?authuser=0: Internal Server Error`,
      );
    });
  });

  describe("pollForInfoUpdate", () => {
    it("successfully polls info", async () => {
      const mockResponse: CCUInfo = {
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
      const mockResponseNoGpu: CCUInfo = {
        currentBalance: 1,
        consumptionRateHourly: 2,
        assignmentsCount: 3,
        eligibleGpus: [],
        ineligibleGpus: [Accelerator.A100, Accelerator.L4],
        freeCcuQuotaInfo: {
          remainingTokens: 4,
          nextRefillTimestampSec: 5,
        },
      };
      const mockResponseNoBalance: CCUInfo = {
        currentBalance: 0,
        consumptionRateHourly: 2,
        assignmentsCount: 3,
        eligibleGpus: [],
        ineligibleGpus: [Accelerator.A100, Accelerator.L4],
        freeCcuQuotaInfo: {
          remainingTokens: 4,
          nextRefillTimestampSec: 5,
        },
      };
      fetchStub
        .withArgs(matchAuthorizedRequest("tun/m/ccu-info", "GET"))
        .resolves(
          new Response(withXSSI(JSON.stringify(mockResponse)), { status: 200 }),
        );

      let updateCount = 0;
      ccuInfo = await CCUInformation.initialize(vscodeStub, client);
      ccuInfo.didChangeCCUInfo.event(() => {
        updateCount++;
      });
      await clock.tickAsync(1000 * 60 * 2);

      fetchStub
        .withArgs(matchAuthorizedRequest("tun/m/ccu-info", "GET"))
        .resolves(
          new Response(withXSSI(JSON.stringify(mockResponseNoBalance)), {
            status: 200,
          }),
        );
      await clock.nextAsync();

      expect(ccuInfo.ccuInfo).to.deep.equal(mockResponseNoBalance);
      expect(updateCount).to.equal(1);

      fetchStub
        .withArgs(matchAuthorizedRequest("tun/m/ccu-info", "GET"))
        .resolves(
          new Response(withXSSI(JSON.stringify(mockResponseNoGpu)), {
            status: 200,
          }),
        );
      await clock.nextAsync();
      expect(ccuInfo.ccuInfo).to.deep.equal(mockResponseNoGpu);
      expect(updateCount).to.equal(2);
    });
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
