import { randomUUID } from "crypto";
import { expect } from "chai";
import fetch, { Response } from "node-fetch";
import { SinonStub, SinonMatcher } from "sinon";
import * as sinon from "sinon";
import { uuidToWebSafeBase64 } from "../utils/uuid";
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

const COLAB_HOST = "colab.example.com";
const GOOGLE_APIS_HOST = "colab.example.googleapis.com";
const BEARER_TOKEN = "access-token";
const NOTEBOOK_HASH = randomUUID();
const DEFAULT_ASSIGNMENT_RESPONSE = {
  accelerator: Accelerator.A100,
  endpoint: "mock-server",
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
  let fetchStub: sinon.SinonStubbedMember<typeof fetch>;
  let sessionStub: SinonStub<[], Promise<string>>;
  let client: ColabClient;

  beforeEach(() => {
    fetchStub = sinon.stub(fetch, "default");
    sessionStub = sinon.stub<[], Promise<string>>().resolves(BEARER_TOKEN);
    client = new ColabClient(
      new URL(`https://${COLAB_HOST}`),
      new URL(`https://${GOOGLE_APIS_HOST}`),
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
        urlMatcher({
          method: "GET",
          host: GOOGLE_APIS_HOST,
          path: "/v1/user-info",
          withAuthUser: false,
        }),
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
      .withArgs(
        urlMatcher({
          method: "GET",
          host: COLAB_HOST,
          path: "/tun/m/ccu-info",
        }),
      )
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
        .withArgs(
          urlMatcher({
            method: "GET",
            host: COLAB_HOST,
            path: "/tun/m/assign",
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
        isNew: false,
      });

      sinon.assert.calledOnce(fetchStub);
    });

    const assignmentTests: [Variant, Accelerator?][] = [
      [Variant.DEFAULT, undefined],
      [Variant.GPU, Accelerator.T4],
      [Variant.TPU, Accelerator.V28],
    ];
    for (const [variant, accelerator] of assignmentTests) {
      const assignment = `${variant}${accelerator ? ` (${accelerator})` : ""}`;

      it(`creates a new ${assignment}`, async () => {
        const wireNbh = uuidToWebSafeBase64(NOTEBOOK_HASH);
        const mockGetResponse = {
          acc: accelerator ?? Accelerator.NONE,
          nbh: wireNbh,
          p: false,
          token: "mock-xsrf-token",
          variant: variant,
        };
        const path = "/tun/m/assign";
        const getQueryParams: Record<string, string | RegExp> = {
          nbh: wireNbh,
        };
        fetchStub
          .withArgs(
            urlMatcher({
              method: "GET",
              host: COLAB_HOST,
              path,
              queryParams: getQueryParams,
            }),
          )
          .resolves(
            new Response(withXSSI(JSON.stringify(mockGetResponse)), {
              status: 200,
            }),
          );
        const postQueryParams: Record<string, string | RegExp> = {
          ...getQueryParams,
        };
        if (variant !== Variant.DEFAULT) {
          postQueryParams.variant = variant;
        }
        if (accelerator) {
          postQueryParams.accelerator = accelerator;
        }
        const assignmentResponse = {
          ...DEFAULT_ASSIGNMENT_RESPONSE,
          variant,
          accelerator: accelerator ?? Accelerator.NONE,
        };
        fetchStub
          .withArgs(
            urlMatcher({
              method: "POST",
              host: COLAB_HOST,
              path,
              queryParams: postQueryParams,
              otherHeaders: {
                "X-Goog-Colab-Token": "mock-xsrf-token",
              },
            }),
          )
          .resolves(
            new Response(withXSSI(JSON.stringify(assignmentResponse)), {
              status: 200,
            }),
          );

        const expectedAssignment: Assignment = {
          ...DEFAULT_ASSIGNMENT,
          variant,
          accelerator: accelerator ?? Accelerator.NONE,
        };
        await expect(
          client.assign(NOTEBOOK_HASH, variant, accelerator),
        ).to.eventually.deep.equal({
          assignment: expectedAssignment,
          isNew: true,
        });

        sinon.assert.calledTwice(fetchStub);
      });
    }
  });

  it("successfully lists assignments", async () => {
    fetchStub
      .withArgs(
        urlMatcher({
          method: "GET",
          host: COLAB_HOST,
          path: "/tun/m/assignments",
        }),
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
    const endpoint = "mock-server";
    const path = `/tun/m/unassign/${endpoint}`;
    const token = "mock-xsrf-token";
    fetchStub
      .withArgs(urlMatcher({ method: "GET", host: COLAB_HOST, path: path }))
      .resolves(
        new Response(withXSSI(JSON.stringify({ token })), { status: 200 }),
      );
    fetchStub
      .withArgs(
        urlMatcher({
          method: "POST",
          host: COLAB_HOST,
          path,
          otherHeaders: {
            "X-Goog-Colab-Token": token,
          },
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
        urlMatcher({
          method: "GET",
          host: COLAB_HOST,
          path: "/tun/m/foo/api/kernels",
        }),
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
    const server = "mock-server";
    const last_activity = new Date().toISOString();
    fetchStub
      .withArgs(
        urlMatcher({
          method: "GET",
          host: COLAB_HOST,
          path: `/tun/m/${server}/api/sessions`,
        }),
      )
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
                path: "/mock-path",
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
      path: "/mock-path",
      type: "notebook",
    };

    await expect(client.listSessions(server)).to.eventually.deep.equal([
      session,
    ]);

    sinon.assert.calledOnce(fetchStub);
  });

  it("successfully deletes a session", async () => {
    const server = "mock-server";
    const sessionId = "mock-session-id";
    fetchStub
      .withArgs(
        urlMatcher({
          method: "DELETE",
          host: COLAB_HOST,
          path: `/tun/m/${server}/api/sessions/${sessionId}`,
        }),
      )
      .resolves(new Response(undefined, { status: 200 }));

    await expect(client.deleteSession(server, sessionId)).to.eventually.be
      .fulfilled;

    sinon.assert.calledOnce(fetchStub);
  });

  it("successfully issues keep-alive pings", async () => {
    fetchStub
      .withArgs(
        urlMatcher({
          method: "GET",
          host: COLAB_HOST,
          path: "/tun/m/foo/keep-alive/",
        }),
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
      .withArgs(
        urlMatcher({
          method: "GET",
          host: COLAB_HOST,
          path: "/tun/m/ccu-info",
        }),
      )
      .resolves(new Response(JSON.stringify(mockResponse), { status: 200 }));

    await expect(client.getCcuInfo()).to.eventually.deep.equal(mockResponse);

    sinon.assert.calledOnce(fetchStub);
  });

  it("rejects when error responses are returned", async () => {
    fetchStub
      .withArgs(
        urlMatcher({
          method: "GET",
          host: COLAB_HOST,
          path: "/tun/m/ccu-info",
        }),
      )
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
      .withArgs(
        urlMatcher({
          method: "GET",
          host: COLAB_HOST,
          path: "/tun/m/ccu-info",
        }),
      )
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
      .withArgs(
        urlMatcher({
          method: "GET",
          host: COLAB_HOST,
          path: "/tun/m/ccu-info",
        }),
      )
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

export interface URLMatchOptions {
  method: "GET" | "POST" | "DELETE";
  host: typeof GOOGLE_APIS_HOST | typeof COLAB_HOST;
  path: string | RegExp;
  queryParams?: Record<string, string | RegExp>;
  otherHeaders?: Record<string, string>;
  /** Whether the authuser query parameter should be included. Defaults to true. */
  withAuthUser?: boolean;
}

/**
 * Creates a Sinon matcher that matches a request's URL, method, query
 * parameters, and headers.
 *
 * All requests are assumed to be with the correct `Authorization` and `Accept`
 * headers.
 */
export function urlMatcher(expected: URLMatchOptions): SinonMatcher {
  let reason = "";
  return sinon.match((request: Request) => {
    const reasons: string[] = [];
    reason = "";

    // Check method
    const actualMethod = request.method.toUpperCase();
    const expectedMethod = expected.method.toUpperCase();
    if (actualMethod !== expectedMethod) {
      reasons.push(`method "${actualMethod}" !== expected "${expectedMethod}"`);
    }

    const url = new URL(request.url);

    // Check host
    const actualHost = url.host;
    const expectedHost = expected.host;
    if (actualHost !== expectedHost) {
      reasons.push(`host "${expectedHost}" !== expected "${expectedHost}"`);
    }

    // Check path
    const actualPath = url.pathname;
    const expectedPath = expected.path;
    if (expectedPath instanceof RegExp) {
      if (!expectedPath.test(actualPath)) {
        reasons.push(
          `path "${actualPath}" does not match ${expectedPath.source}`,
        );
      }
    } else {
      if (actualPath !== expectedPath) {
        reasons.push(`path "${actualPath}" !== expected "${expectedPath}"`);
      }
    }

    // Check query params
    const params = url.searchParams;
    if (expected.withAuthUser !== false) {
      const actualAuthuser = params.get("authuser");
      if (actualAuthuser !== "0") {
        reasons.push(
          `authuser param is "${actualAuthuser ?? ""}", expected "0"`,
        );
      }
    }
    if (expected.queryParams) {
      for (const [key, value] of Object.entries(expected.queryParams)) {
        const actual = params.get(key);
        if (actual === null) {
          reasons.push(`missing query param "${key}"`);
        } else if (value instanceof RegExp) {
          if (!value.test(actual)) {
            reasons.push(
              `query param "${key}" = "${actual}" does not match ${value.source}`,
            );
          }
        } else {
          if (actual !== value) {
            reasons.push(
              `query param "${key}" = "${actual}" !== expected "${value}"`,
            );
          }
        }
      }
    }

    // Check headers
    const headers = request.headers;
    const actualAuth = headers.get("Authorization");
    const expectedAuth = `Bearer ${BEARER_TOKEN}`;
    if (actualAuth !== expectedAuth) {
      reasons.push(
        `Authorization header is "${actualAuth ?? ""}", expected "${expectedAuth}"`,
      );
    }
    const actualAccept = headers.get("Accept");
    if (actualAccept !== "application/json") {
      reasons.push(
        `Accept header is "${actualAccept ?? ""}", expected "application/json"`,
      );
    }
    if (expected.otherHeaders) {
      for (const [key, expectedVal] of Object.entries(expected.otherHeaders)) {
        const actualVal = headers.get(key);
        if (actualVal !== expectedVal) {
          reasons.push(
            `header "${key}" = "${actualVal ?? ""}", expected "${expectedVal}"`,
          );
        }
      }
    }

    if (reasons.length > 0) {
      reason = reasons.join("; ");
      return false;
    }

    return true;
  }, reason || "URL did not match expected pattern");
}
