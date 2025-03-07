import { randomUUID } from "crypto";
import { expect } from "chai";
import { Response } from "node-fetch";
import * as nodeFetch from "node-fetch";
import { SinonStub, SinonMatcher } from "sinon";
import * as sinon from "sinon";
import { AuthenticationSession } from "vscode";
import {
  Accelerator,
  CCUInfo,
  Assignment,
  Shape,
  SubscriptionState,
  SubscriptionTier,
  Variant,
  GetAssignmentResponse,
} from "./api";
import { ColabClient } from "./client";

const DOMAIN = "https://colab.example.com";
const BEARER_TOKEN = "access-token";
const NOTEBOOK_HASH = randomUUID();

describe("ColabClient", () => {
  let fetchStub: SinonStub<
    [url: nodeFetch.RequestInfo, init?: nodeFetch.RequestInit | undefined],
    Promise<Response>
  >;
  let sessionStub: SinonStub<[], Promise<AuthenticationSession>>;
  let client: ColabClient;

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
  });

  afterEach(() => {
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

      await expect(client.ccuInfo()).to.eventually.deep.equal(mockResponse);

      sinon.assert.calledOnce(fetchStub);
    });

    it("rejects when error responses are returned", () => {
      fetchStub.resolves(
        new Response("Error", {
          status: 500,
          statusText: "Internal Server Error",
        }),
      );

      expect(client.ccuInfo()).to.eventually.be.rejectedWith(
        `Failed to GET ${DOMAIN}/tun/m/ccu-info?authuser=0: Internal Server Error`,
      );
    });
  });

  describe("assignment", () => {
    it("resolves an existing assignment", async () => {
      const mockResponse: Assignment = {
        accelerator: Accelerator.A100,
        endpoint: "mock-endpoint",
        sub: SubscriptionState.UNSUBSCRIBED,
        subTier: SubscriptionTier.UNKNOWN_TIER,
        variant: Variant.GPU,
        machineShape: Shape.STANDARD,
        runtimeProxyInfo: {
          token: "mock-token",
          tokenExpiresInSeconds: 42,
          url: "https://mock-url.com",
        },
      };
      fetchStub
        .withArgs(matchAuthorizedRequest("tun/m/assign", "GET"))
        .resolves(
          new Response(withXSSI(JSON.stringify(mockResponse)), { status: 200 }),
        );

      await expect(
        client.assign(NOTEBOOK_HASH, Variant.GPU, Accelerator.A100),
      ).to.eventually.deep.equal(mockResponse);

      sinon.assert.calledOnce(fetchStub);
    });

    it("creates and resolves a new assignment when an existing one does not exist", async () => {
      const mockGetResponse: GetAssignmentResponse = {
        acc: Accelerator.A100,
        nbh: NOTEBOOK_HASH,
        p: false,
        token: "mock-xsrf-token",
        variant: Variant.DEFAULT,
      };
      fetchStub
        .withArgs(matchAuthorizedRequest("tun/m/assign", "GET"))
        .resolves(
          new Response(withXSSI(JSON.stringify(mockGetResponse)), {
            status: 200,
          }),
        );

      const mockPostResponse: Assignment = {
        accelerator: Accelerator.A100,
        endpoint: "mock-endpoint",
        sub: SubscriptionState.UNSUBSCRIBED,
        subTier: SubscriptionTier.UNKNOWN_TIER,
        variant: Variant.GPU,
        machineShape: Shape.STANDARD,
        runtimeProxyInfo: {
          token: "mock-token",
          tokenExpiresInSeconds: 42,
          url: "https://mock-url.com",
        },
      };
      fetchStub
        .withArgs(matchAuthorizedRequest("tun/m/assign", "POST"))
        .resolves(
          new Response(withXSSI(JSON.stringify(mockPostResponse)), {
            status: 200,
          }),
        );

      await expect(
        client.assign(NOTEBOOK_HASH, Variant.GPU, Accelerator.A100),
      ).to.eventually.deep.equal(mockPostResponse);

      sinon.assert.calledTwice(fetchStub);
    });

    it("rejects when error responses are returned", () => {
      fetchStub.resolves(
        new Response("Error", {
          status: 500,
          statusText: "Internal Server Error",
        }),
      );

      expect(
        client.assign(NOTEBOOK_HASH, Variant.DEFAULT),
      ).to.eventually.be.rejectedWith(
        `Failed to GET ${DOMAIN}/tun/m/assign?authuser=0&nbh=${NOTEBOOK_HASH}: Internal Server Error`,
      );
    });
  });

  it("supports non-XSSI responses", async () => {
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
      .resolves(new Response(JSON.stringify(mockResponse), { status: 200 }));

    await expect(client.ccuInfo()).to.eventually.deep.equal(mockResponse);

    sinon.assert.calledOnce(fetchStub);
  });

  it("rejects invalid JSON responses", () => {
    fetchStub
      .withArgs(matchAuthorizedRequest("tun/m/ccu-info", "GET"))
      .resolves(new Response(withXSSI("not JSON eh?"), { status: 200 }));

    expect(client.ccuInfo()).to.eventually.be.rejectedWith(/not valid.+eh\?/);
  });

  it("rejects response schema mismatches", async () => {
    const mockResponse: Partial<CCUInfo> = {
      currentBalance: 1,
      consumptionRateHourly: 2,
      eligibleGpus: [Accelerator.T4],
    };
    fetchStub
      .withArgs(matchAuthorizedRequest("tun/m/ccu-info", "GET"))
      .resolves(
        new Response(withXSSI(JSON.stringify(mockResponse)), { status: 200 }),
      );

    await expect(client.ccuInfo()).to.eventually.be.rejectedWith(
      /assignmentsCount.+Required/s,
    );
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
