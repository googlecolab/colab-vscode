import { randomUUID } from "crypto";
import { expect } from "chai";
import { Response } from "node-fetch";
import * as nodeFetch from "node-fetch";
import { SinonStub, SinonMatcher } from "sinon";
import * as sinon from "sinon";
import { AuthenticationSession } from "vscode";
import {
  Accelerator,
  CcuInfo,
  Assignment,
  Shape,
  SubscriptionState,
  SubscriptionTier,
  Variant,
  GetAssignmentResponse,
  Kernel,
} from "./api";
import { ColabClient } from "./client";

const DOMAIN = "https://colab.example.com";
const BEARER_TOKEN = "access-token";
const NOTEBOOK_HASH = randomUUID();
const DEFAULT_ASSIGNMENT: Assignment = {
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

  it("successfully gets CCU info", async () => {
    const mockResponse: CcuInfo = {
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
    fetchStub
      .withArgs(matchAuthorizedRequest("tun/m/ccu-info", "GET"))
      .resolves(
        new Response(withXSSI(JSON.stringify(mockResponse)), { status: 200 }),
      );

    await expect(client.ccuInfo()).to.eventually.deep.equal(mockResponse);

    sinon.assert.calledOnce(fetchStub);
  });

  describe("assignment", () => {
    it("resolves an existing assignment", async () => {
      fetchStub
        .withArgs(matchAuthorizedRequest("tun/m/assign", "GET"))
        .resolves(
          new Response(withXSSI(JSON.stringify(DEFAULT_ASSIGNMENT)), {
            status: 200,
          }),
        );

      await expect(
        client.assign(NOTEBOOK_HASH, Variant.GPU, Accelerator.A100),
      ).to.eventually.deep.equal(DEFAULT_ASSIGNMENT);

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
      fetchStub
        .withArgs(
          matchAuthorizedRequest("tun/m/assign", "POST", {
            "X-Goog-Colab-Token": "mock-xsrf-token",
          }),
        )
        .resolves(
          new Response(withXSSI(JSON.stringify(DEFAULT_ASSIGNMENT)), {
            status: 200,
          }),
        );

      await expect(
        client.assign(NOTEBOOK_HASH, Variant.GPU, Accelerator.A100),
      ).to.eventually.deep.equal(DEFAULT_ASSIGNMENT);

      sinon.assert.calledTwice(fetchStub);
    });
  });

  it("successfully lists assignments", async () => {
    fetchStub
      .withArgs(matchAuthorizedRequest("tun/m/assignments", "GET"))
      .resolves(
        new Response(
          withXSSI(JSON.stringify({ assignments: [DEFAULT_ASSIGNMENT] })),
          {
            status: 200,
          },
        ),
      );

    await expect(client.listAssignments()).to.eventually.deep.equal([
      DEFAULT_ASSIGNMENT,
    ]);

    sinon.assert.calledOnce(fetchStub);
  });

  it("successfully lists kernels", async () => {
    const lastActivity = new Date().toISOString();

    fetchStub
      .withArgs(matchAuthorizedRequest("tun/m/foo/api/kernels", "GET"))
      .resolves(
        new Response(
          withXSSI(
            JSON.stringify([
              {
                id: "mock-id",
                name: "mock-name",
                last_activity: lastActivity,
                execution_state: "idle",
                connections: 1,
              },
            ]),
          ),
          {
            status: 200,
          },
        ),
      );
    const kernel: Kernel = {
      id: "mock-id",
      name: "mock-name",
      lastActivity,
      executionState: "idle",
      connections: 1,
    };

    await expect(client.listKernels("foo")).to.eventually.deep.equal([kernel]);

    sinon.assert.calledOnce(fetchStub);
  });

  it("successfully issues keep-alive pings", async () => {
    fetchStub
      .withArgs(matchAuthorizedRequest("tun/m/foo/keep-alive/", "GET"))
      .resolves(new Response(undefined, { status: 200 }));

    await expect(client.keepAlive("foo")).to.eventually.be.fulfilled;

    sinon.assert.calledOnce(fetchStub);
  });

  it("supports non-XSSI responses", async () => {
    const mockResponse: CcuInfo = {
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
    fetchStub
      .withArgs(matchAuthorizedRequest("tun/m/ccu-info", "GET"))
      .resolves(new Response(JSON.stringify(mockResponse), { status: 200 }));

    await expect(client.ccuInfo()).to.eventually.deep.equal(mockResponse);

    sinon.assert.calledOnce(fetchStub);
  });

  it("rejects when error responses are returned", async () => {
    fetchStub
      .withArgs(matchAuthorizedRequest("tun/m/ccu-info", "GET"))
      .resolves(
        new Response("Error", {
          status: 500,
          statusText: "Foo error",
        }),
      );

    await expect(client.ccuInfo()).to.eventually.be.rejectedWith(/Foo error/);
  });

  it("rejects invalid JSON responses", async () => {
    fetchStub
      .withArgs(matchAuthorizedRequest("tun/m/ccu-info", "GET"))
      .resolves(new Response(withXSSI("not JSON eh?"), { status: 200 }));

    await expect(client.ccuInfo()).to.eventually.be.rejectedWith(
      /not JSON.+eh\?/,
    );
  });

  it("rejects response schema mismatches", async () => {
    const mockResponse: Partial<CcuInfo> = {
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

  it("initializes fetch with abort signal", async () => {
    const abort = new AbortController();
    fetchStub
      .withArgs(sinon.match({ signal: abort.signal }))
      .resolves(new Response(undefined, { status: 200 }));

    await expect(client.keepAlive("foo", abort.signal)).to.eventually.be
      .fulfilled;

    sinon.assert.calledOnce(fetchStub);
  });
});

function withXSSI(response: string): string {
  return `)]}'\n${response}`;
}

function matchAuthorizedRequest(
  endpoint: string,
  method: "GET" | "POST",
  otherHeaders?: Record<string, string>,
): SinonMatcher {
  return sinon.match({
    url: sinon.match(new RegExp(`${DOMAIN}/${endpoint}?.*authuser=0`)),
    method: sinon.match(method),
    headers: sinon.match(
      (headers: nodeFetch.Headers) =>
        headers.get("Authorization") === `Bearer ${BEARER_TOKEN}` &&
        headers.get("Accept") === "application/json" &&
        Object.entries(otherHeaders ?? {}).every(
          ([key, value]) => headers.get(key) === value,
        ),
    ),
  });
}
