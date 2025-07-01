import { randomUUID } from "crypto";
import { expect } from "chai";
import fetch, { Response, RequestInfo, RequestInit } from "node-fetch";
import { SinonStub, SinonMatcher } from "sinon";
import * as sinon from "sinon";
import {
  Accelerator,
  CcuInfo,
  Assignment,
  Shape,
  SubscriptionState,
  SubscriptionTier,
  Variant,
  Kernel,
  Session,
} from "./api";
import { ColabClient } from "./client";

const COLAB_DOMAIN = "https://colab.example.com";
const GOOGLE_APIS_DOMAIN = "https://colab.example.googleapis.com";
const BEARER_TOKEN = "access-token";
const NOTEBOOK_HASH = randomUUID();
const DEFAULT_ASSIGNMENT_RESPONSE = {
  accelerator: Accelerator.A100,
  endpoint: "mock-endpoint",
  fit: 30,
  sub: SubscriptionState.UNSUBSCRIBED,
  subTier: SubscriptionTier.NONE,
  variant: Variant.GPU,
  machineShape: Shape.STANDARD,
  runtimeProxyInfo: {
    token: "mock-token",
    tokenExpiresInSeconds: 42,
    url: "https://mock-url.com",
  },
};
const { fit, runtimeProxyInfo, sub, subTier, ...rest } =
  DEFAULT_ASSIGNMENT_RESPONSE;
const { tokenExpiresInSeconds, ...rpRest } = runtimeProxyInfo;
const DEFAULT_ASSIGNMENT: Assignment = {
  ...rest,
  idleTimeoutSec: fit,
  subscriptionState: sub,
  subscriptionTier: subTier,
  runtimeProxyInfo: {
    ...rpRest,
    expirySec: tokenExpiresInSeconds,
  },
};

describe("ColabClient", () => {
  let fetchStub: SinonStub<
    [url: RequestInfo, init?: RequestInit | undefined],
    Promise<Response>
  >;
  let sessionStub: SinonStub<[], Promise<string>>;
  let client: ColabClient;

  beforeEach(() => {
    fetchStub = sinon.stub(fetch, "default");
    sessionStub = sinon.stub<[], Promise<string>>().resolves(BEARER_TOKEN);
    client = new ColabClient(
      new URL(COLAB_DOMAIN),
      new URL(GOOGLE_APIS_DOMAIN),
      sessionStub,
    );
  });

  afterEach(() => {
    sinon.restore();
  });

  it("successfully gets the subscription tier", async () => {
    const mockResponse = {
      subscriptionTier: "SUBSCRIPTION_TIER_NONE",
      paidComputeUnitsBalance: 0,
      eligibleAccelerators: [
        { variant: "VARIANT_GPU", models: [Accelerator.T4] },
      ],
    };
    fetchStub
      .withArgs(
        matchAuthorizedRequest(
          `${GOOGLE_APIS_DOMAIN}/v1/user-info`,
          "GET",
          undefined,
          false,
        ),
      )
      .resolves(
        new Response(withXSSI(JSON.stringify(mockResponse)), { status: 200 }),
      );

    await expect(client.getSubscriptionTier()).to.eventually.deep.equal(
      SubscriptionTier.NONE,
    );

    sinon.assert.calledOnce(fetchStub);
  });

  it("successfully gets CCU info", async () => {
    const mockResponse = {
      currentBalance: 1,
      consumptionRateHourly: 2,
      assignmentsCount: 3,
      eligibleGpus: [Accelerator.T4],
      ineligibleGpus: [Accelerator.A100, Accelerator.L4],
      eligibleTpus: [Accelerator.V6E1, Accelerator.V28],
      ineligibleTpus: [Accelerator.V5E1],
      freeCcuQuotaInfo: {
        remainingTokens: "4",
        nextRefillTimestampSec: 5,
      },
    };
    fetchStub
      .withArgs(matchAuthorizedRequest(`${COLAB_DOMAIN}/tun/m/ccu-info`, "GET"))
      .resolves(
        new Response(withXSSI(JSON.stringify(mockResponse)), { status: 200 }),
      );

    const expectedResponse: CcuInfo = {
      ...mockResponse,
      freeCcuQuotaInfo: {
        ...mockResponse.freeCcuQuotaInfo,
        remainingTokens: Number(mockResponse.freeCcuQuotaInfo.remainingTokens),
      },
    };
    await expect(client.getCcuInfo()).to.eventually.deep.equal(
      expectedResponse,
    );

    sinon.assert.calledOnce(fetchStub);
  });

  describe("assignment", () => {
    it("resolves an existing assignment", async () => {
      fetchStub
        .withArgs(matchAuthorizedRequest(`${COLAB_DOMAIN}/tun/m/assign`, "GET"))
        .resolves(
          new Response(withXSSI(JSON.stringify(DEFAULT_ASSIGNMENT_RESPONSE)), {
            status: 200,
          }),
        );

      await expect(
        client.assign(NOTEBOOK_HASH, Variant.GPU, Accelerator.A100),
      ).to.eventually.deep.equal({
        assignment: DEFAULT_ASSIGNMENT,
        isNew: false,
      });

      sinon.assert.calledOnce(fetchStub);
    });

    it("creates and resolves a new assignment when an existing one does not exist", async () => {
      const mockGetResponse = {
        acc: Accelerator.A100,
        nbh: NOTEBOOK_HASH,
        p: false,
        token: "mock-xsrf-token",
        variant: Variant.DEFAULT,
      };
      fetchStub
        .withArgs(matchAuthorizedRequest(`${COLAB_DOMAIN}/tun/m/assign`, "GET"))
        .resolves(
          new Response(withXSSI(JSON.stringify(mockGetResponse)), {
            status: 200,
          }),
        );
      fetchStub
        .withArgs(
          matchAuthorizedRequest(`${COLAB_DOMAIN}/tun/m/assign`, "POST", {
            "X-Goog-Colab-Token": "mock-xsrf-token",
          }),
        )
        .resolves(
          new Response(withXSSI(JSON.stringify(DEFAULT_ASSIGNMENT_RESPONSE)), {
            status: 200,
          }),
        );

      await expect(
        client.assign(NOTEBOOK_HASH, Variant.GPU, Accelerator.A100),
      ).to.eventually.deep.equal({
        assignment: DEFAULT_ASSIGNMENT,
        isNew: true,
      });

      sinon.assert.calledTwice(fetchStub);
    });
  });

  it("successfully lists assignments", async () => {
    fetchStub
      .withArgs(
        matchAuthorizedRequest(`${COLAB_DOMAIN}/tun/m/assignments`, "GET"),
      )
      .resolves(
        new Response(
          withXSSI(
            JSON.stringify({ assignments: [DEFAULT_ASSIGNMENT_RESPONSE] }),
          ),
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

  it("successfully unassigns the specified assignment", async () => {
    const endpoint = "mock-endpoint";
    const path = `tun/m/unassign/${endpoint}`;
    const token = "mock-xsrf-token";
    fetchStub
      .withArgs(matchAuthorizedRequest(path, "GET"))
      .resolves(
        new Response(withXSSI(JSON.stringify({ token })), { status: 200 }),
      );
    fetchStub
      .withArgs(
        matchAuthorizedRequest(path, "POST", {
          "X-Goog-Colab-Token": token,
        }),
      )
      .resolves(new Response(undefined, { status: 200 }));

    await expect(client.unassign(endpoint)).to.eventually.be.fulfilled;

    sinon.assert.calledTwice(fetchStub);
  });

  it("successfully lists kernels", async () => {
    const lastActivity = new Date().toISOString();

    fetchStub
      .withArgs(
        matchAuthorizedRequest(`${COLAB_DOMAIN}/tun/m/foo/api/kernels`, "GET"),
      )
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

  it("successfully lists sessions", async () => {
    const endpoint = "mock-endpoint";
    const last_activity = new Date().toISOString();
    fetchStub
      .withArgs(matchAuthorizedRequest(`tun/m/${endpoint}/api/sessions`, "GET"))
      .resolves(
        new Response(
          withXSSI(
            JSON.stringify([
              {
                id: "mock-session-id",
                kernel: {
                  id: "mock-kernel-id",
                  name: "mock-kernel-name",
                  last_activity,
                  execution_state: "idle",
                  connections: 1,
                },
                name: "mock-session-name",
                path: "mock-path",
                type: "notebook",
              },
            ]),
          ),
          { status: 200 },
        ),
      );
    const session: Session = {
      id: "mock-session-id",
      kernel: {
        id: "mock-kernel-id",
        name: "mock-kernel-name",
        lastActivity: last_activity,
        executionState: "idle",
        connections: 1,
      },
      name: "mock-session-name",
      path: "mock-path",
      type: "notebook",
    };

    await expect(client.listSessions(endpoint)).to.eventually.deep.equal([
      session,
    ]);

    sinon.assert.calledOnce(fetchStub);
  });

  it("successfully deletes a session", async () => {
    const endpoint = "mock-endpoint";
    const sessionId = "mock-session-id";
    fetchStub
      .withArgs(
        matchAuthorizedRequest(
          `tun/m/${endpoint}/api/sessions/${sessionId}`,
          "DELETE",
        ),
      )
      .resolves(new Response(undefined, { status: 200 }));

    await expect(client.deleteSession(endpoint, sessionId)).to.eventually.be
      .fulfilled;

    sinon.assert.calledOnce(fetchStub);
  });

  it("successfully issues keep-alive pings", async () => {
    fetchStub
      .withArgs(
        matchAuthorizedRequest(`${COLAB_DOMAIN}/tun/m/foo/keep-alive/`, "GET"),
      )
      .resolves(new Response(undefined, { status: 200 }));

    await expect(client.sendKeepAlive("foo")).to.eventually.be.fulfilled;

    sinon.assert.calledOnce(fetchStub);
  });

  it("supports non-XSSI responses", async () => {
    const mockResponse = {
      currentBalance: 1,
      consumptionRateHourly: 2,
      assignmentsCount: 3,
      eligibleGpus: [Accelerator.T4],
      ineligibleGpus: [Accelerator.A100, Accelerator.L4],
      eligibleTpus: [Accelerator.V6E1, Accelerator.V28],
      ineligibleTpus: [Accelerator.V5E1],
    };
    fetchStub
      .withArgs(matchAuthorizedRequest(`${COLAB_DOMAIN}/tun/m/ccu-info`, "GET"))
      .resolves(new Response(JSON.stringify(mockResponse), { status: 200 }));

    await expect(client.getCcuInfo()).to.eventually.deep.equal(mockResponse);

    sinon.assert.calledOnce(fetchStub);
  });

  it("rejects when error responses are returned", async () => {
    fetchStub
      .withArgs(matchAuthorizedRequest(`${COLAB_DOMAIN}/tun/m/ccu-info`, "GET"))
      .resolves(
        new Response("Error", {
          status: 500,
          statusText: "Foo error",
        }),
      );

    await expect(client.getCcuInfo()).to.eventually.be.rejectedWith(
      /Foo error/,
    );
  });

  it("rejects invalid JSON responses", async () => {
    fetchStub
      .withArgs(matchAuthorizedRequest(`${COLAB_DOMAIN}/tun/m/ccu-info`, "GET"))
      .resolves(new Response(withXSSI("not JSON eh?"), { status: 200 }));

    await expect(client.getCcuInfo()).to.eventually.be.rejectedWith(
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
      .withArgs(matchAuthorizedRequest(`${COLAB_DOMAIN}/tun/m/ccu-info`, "GET"))
      .resolves(
        new Response(withXSSI(JSON.stringify(mockResponse)), { status: 200 }),
      );

    await expect(client.getCcuInfo()).to.eventually.be.rejectedWith(
      /assignmentsCount.+Required/s,
    );
  });

  it("initializes fetch with abort signal", async () => {
    const abort = new AbortController();
    fetchStub
      .withArgs(sinon.match({ signal: abort.signal }))
      .resolves(new Response(undefined, { status: 200 }));

    await expect(client.sendKeepAlive("foo", abort.signal)).to.eventually.be
      .fulfilled;

    sinon.assert.calledOnce(fetchStub);
  });
});

function withXSSI(response: string): string {
  return `)]}'\n${response}`;
}

function matchAuthorizedRequest(
  endpoint: string,
  method: "DELETE" | "GET" | "POST",
  otherHeaders?: Record<string, string>,
  withAuthUser = true,
): SinonMatcher {
  const authuser = withAuthUser ? "authuser=0" : "";
  return sinon.match({
    url: sinon.match(new RegExp(`${endpoint}?.*${authuser}`)),
    method: sinon.match(method),
    headers: sinon.match(
      (headers: Headers) =>
        headers.get("Authorization") === `Bearer ${BEARER_TOKEN}` &&
        headers.get("Accept") === "application/json" &&
        Object.entries(otherHeaders ?? {}).every(
          ([key, value]) => headers.get(key) === value,
        ),
    ),
  });
}
