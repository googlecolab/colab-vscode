/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "crypto";
import { expect } from "chai";
import fetch, { Response } from "node-fetch";
import { SinonStub, SinonMatcher } from "sinon";
import * as sinon from "sinon";
import { ColabAssignedServer } from "../jupyter/servers";
import { TestUri } from "../test/helpers/uri";
import { uuidToWebSafeBase64 } from "../utils/uuid";
import {
  CcuInfo,
  Assignment,
  Shape,
  SubscriptionState,
  SubscriptionTier,
  Variant,
  Kernel,
  Session,
  Outcome,
  ListedAssignments,
  RuntimeProxyInfo,
} from "./api";
import {
  ColabClient,
  DenylistedError,
  InsufficientQuotaError,
  TooManyAssignmentsError,
  TEST_ONLY,
} from "./client";
import {
  ACCEPT_JSON_HEADER,
  AUTHORIZATION_HEADER,
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
  COLAB_TUNNEL_HEADER,
  COLAB_XSRF_TOKEN_HEADER,
} from "./headers";

const COLAB_HOST = "colab.example.com";
const GOOGLE_APIS_HOST = "colab.example.googleapis.com";
const BEARER_TOKEN = "access-token";
const NOTEBOOK_HASH = randomUUID();
const DEFAULT_ASSIGNMENT_RESPONSE = {
  accelerator: "A100",
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
const DEFAULT_LIST_ASSIGNMENTS_RESPONSE: ListedAssignments = {
  assignments: [
    {
      accelerator: DEFAULT_ASSIGNMENT_RESPONSE.accelerator,
      endpoint: DEFAULT_ASSIGNMENT_RESPONSE.endpoint,
      variant: DEFAULT_ASSIGNMENT_RESPONSE.variant,
      machineShape: DEFAULT_ASSIGNMENT_RESPONSE.machineShape,
    },
  ],
};
const { fit, sub, subTier, ...rest } = DEFAULT_ASSIGNMENT_RESPONSE;
const DEFAULT_ASSIGNMENT: Assignment = {
  ...rest,
  idleTimeoutSec: fit,
  subscriptionState: sub,
  subscriptionTier: subTier,
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
      eligibleAccelerators: [{ variant: "VARIANT_GPU", models: ["T4"] }],
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
      eligibleGpus: ["T4"],
      ineligibleGpus: ["A100", "L4"],
      eligibleTpus: ["V6E1", "V28"],
      ineligibleTpus: ["V5E1"],
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
    const ASSIGN_PATH = "/tun/m/assign";
    let wireNbh: string;
    let queryParams: Record<string, string | RegExp>;

    beforeEach(() => {
      wireNbh = uuidToWebSafeBase64(NOTEBOOK_HASH);
      queryParams = {
        nbh: wireNbh,
      };
    });

    it("resolves an existing assignment", async () => {
      fetchStub
        .withArgs(
          urlMatcher({
            method: "GET",
            host: COLAB_HOST,
            path: ASSIGN_PATH,
            queryParams,
          }),
        )
        .resolves(
          new Response(withXSSI(JSON.stringify(DEFAULT_ASSIGNMENT_RESPONSE)), {
            status: 200,
          }),
        );

      await expect(
        client.assign(NOTEBOOK_HASH, Variant.GPU, "A100"),
      ).to.eventually.deep.equal({
        assignment: DEFAULT_ASSIGNMENT,
        isNew: false,
      });

      sinon.assert.calledOnce(fetchStub);
    });

    describe("without an existing assignment", () => {
      beforeEach(() => {
        const mockGetResponse = {
          acc: "NONE",
          nbh: wireNbh,
          p: false,
          token: "mock-xsrf-token",
          variant: Variant.DEFAULT,
        };
        fetchStub
          .withArgs(
            urlMatcher({
              method: "GET",
              host: COLAB_HOST,
              path: ASSIGN_PATH,
              queryParams,
            }),
          )
          .resolves(
            new Response(withXSSI(JSON.stringify(mockGetResponse)), {
              status: 200,
            }),
          );
      });

      const assignmentTests: [Variant, string?][] = [
        [Variant.DEFAULT, undefined],
        [Variant.GPU, "T4"],
        [Variant.TPU, "V28"],
      ];
      for (const [variant, accelerator] of assignmentTests) {
        const assignment = `${variant}${accelerator ? ` (${accelerator})` : ""}`;

        it(`creates a new ${assignment}`, async () => {
          const postQueryParams: Record<string, string | RegExp> = {
            ...queryParams,
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
            accelerator: accelerator ?? "NONE",
          };
          fetchStub
            .withArgs(
              urlMatcher({
                method: "POST",
                host: COLAB_HOST,
                path: ASSIGN_PATH,
                queryParams: postQueryParams,
                otherHeaders: {
                  [COLAB_XSRF_TOKEN_HEADER.key]: "mock-xsrf-token",
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
            accelerator: accelerator ?? "NONE",
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

      it("rejects when assignments exceed limit", async () => {
        fetchStub
          .withArgs(
            urlMatcher({
              method: "POST",
              host: COLAB_HOST,
              path: ASSIGN_PATH,
              queryParams,
              otherHeaders: {
                "X-Goog-Colab-Token": "mock-xsrf-token",
              },
            }),
          )
          .resolves(new Response(undefined, { status: 412 }));

        await expect(
          client.assign(NOTEBOOK_HASH, Variant.DEFAULT),
        ).to.eventually.be.rejectedWith(TooManyAssignmentsError);
      });

      for (const quotaTest of [
        {
          reason: "request variant unavailable",
          outcome: Outcome.QUOTA_DENIED_REQUESTED_VARIANTS,
        },
        {
          reason: "usage time exceeded",
          outcome: Outcome.QUOTA_EXCEEDED_USAGE_TIME,
        },
      ]) {
        it(`rejects when quota is exceeded due to ${quotaTest.reason}`, async () => {
          fetchStub
            .withArgs(
              urlMatcher({
                method: "POST",
                host: COLAB_HOST,
                path: ASSIGN_PATH,
                queryParams,
                otherHeaders: {
                  "X-Goog-Colab-Token": "mock-xsrf-token",
                },
              }),
            )
            .resolves(
              new Response(
                withXSSI(
                  JSON.stringify({
                    outcome: quotaTest.outcome,
                  }),
                ),
                {
                  status: 200,
                },
              ),
            );

          await expect(
            client.assign(NOTEBOOK_HASH, Variant.DEFAULT),
          ).to.eventually.be.rejectedWith(
            InsufficientQuotaError,
            /insufficient quota/,
          );
        });
      }

      it("rejects when user is banned", async () => {
        fetchStub
          .withArgs(
            urlMatcher({
              method: "POST",
              host: COLAB_HOST,
              path: ASSIGN_PATH,
              queryParams,
              otherHeaders: {
                "X-Goog-Colab-Token": "mock-xsrf-token",
              },
            }),
          )
          .resolves(
            new Response(
              withXSSI(
                JSON.stringify({
                  outcome: Outcome.DENYLISTED,
                }),
              ),
              {
                status: 200,
              },
            ),
          );

        await expect(
          client.assign(NOTEBOOK_HASH, Variant.DEFAULT),
        ).to.eventually.be.rejectedWith(DenylistedError, /blocked/);
      });
    });
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
          withXSSI(JSON.stringify(DEFAULT_LIST_ASSIGNMENTS_RESPONSE)),
          {
            status: 200,
          },
        ),
      );

    await expect(client.listAssignments()).to.eventually.deep.equal(
      DEFAULT_LIST_ASSIGNMENTS_RESPONSE.assignments,
    );

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
            [COLAB_XSRF_TOKEN_HEADER.key]: token,
          },
        }),
      )
      .resolves(new Response(undefined, { status: 200 }));

    await expect(client.unassign(endpoint)).to.eventually.be.fulfilled;

    sinon.assert.calledTwice(fetchStub);
  });

  describe("with an assigned server", () => {
    const assignedServerUrl = new URL(
      "https://8080-m-s-foo.bar.prod.colab.dev",
    );
    let assignedServer: ColabAssignedServer;

    beforeEach(() => {
      assignedServer = {
        id: randomUUID(),
        label: "foo",
        variant: Variant.DEFAULT,
        accelerator: undefined,
        endpoint: "m-s-foo",
        connectionInformation: {
          baseUrl: TestUri.parse(assignedServerUrl.toString()),
          token: "123",
          tokenExpiry: new Date(Date.now() + 1000 * 60 * 60),
        },
        dateAssigned: new Date(),
      };
    });

    it("successfully refreshes the connection", async () => {
      const newConnectionInfo: RuntimeProxyInfo = {
        token: "new",
        tokenExpiresInSeconds: 3600,
        url: assignedServerUrl.toString(),
      };
      const path = "/tun/m/runtime-proxy-token";
      fetchStub
        .withArgs(
          urlMatcher({
            method: "GET",
            host: COLAB_HOST,
            path: path,
            queryParams: {
              endpoint: assignedServer.endpoint,
              port: "8080",
            },
          }),
        )
        .resolves(
          new Response(withXSSI(JSON.stringify(newConnectionInfo)), {
            status: 200,
          }),
        );

      await expect(
        client.refreshConnection(assignedServer.endpoint),
      ).to.eventually.deep.equal(newConnectionInfo);
    });

    it("successfully lists kernels", async () => {
      const lastActivity = new Date().toISOString();

      fetchStub
        .withArgs(
          urlMatcher({
            method: "GET",
            host: assignedServerUrl.host,
            path: "/api/kernels",
            otherHeaders: {
              [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]:
                assignedServer.connectionInformation.token,
            },
            withAuthUser: false,
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

      await expect(client.listKernels(assignedServer)).to.eventually.deep.equal(
        [kernel],
      );

      sinon.assert.calledOnce(fetchStub);
    });

    it("successfully lists sessions by server", async () => {
      const last_activity = new Date().toISOString();
      fetchStub
        .withArgs(
          urlMatcher({
            method: "GET",
            host: assignedServerUrl.host,
            path: "/api/sessions",
            otherHeaders: {
              [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]:
                assignedServer.connectionInformation.token,
            },
            withAuthUser: false,
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

      await expect(
        client.listSessions(assignedServer),
      ).to.eventually.deep.equal([session]);

      sinon.assert.calledOnce(fetchStub);
    });

    it("successfully lists sessions by assignment endpoint", async () => {
      const last_activity = new Date().toISOString();
      fetchStub
        .withArgs(
          urlMatcher({
            method: "GET",
            host: COLAB_HOST,
            path: `${TEST_ONLY.TUN_ENDPOINT}/${assignedServer.endpoint}/api/sessions`,
            otherHeaders: {
              [COLAB_TUNNEL_HEADER.key]: COLAB_TUNNEL_HEADER.value,
            },
            withAuthUser: false,
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

      await expect(
        client.listSessions(assignedServer.endpoint),
      ).to.eventually.deep.equal([session]);

      sinon.assert.calledOnce(fetchStub);
    });

    it("successfully deletes a session", async () => {
      const sessionId = "mock-session-id";
      fetchStub
        .withArgs(
          urlMatcher({
            method: "DELETE",
            host: assignedServerUrl.host,
            path: `/api/sessions/${sessionId}`,
            otherHeaders: {
              [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]:
                assignedServer.connectionInformation.token,
            },
            withAuthUser: false,
          }),
        )
        .resolves(new Response(undefined, { status: 200 }));

      await expect(client.deleteSession(assignedServer, sessionId)).to
        .eventually.be.fulfilled;

      sinon.assert.calledOnce(fetchStub);
    });
  });

  it("successfully issues keep-alive pings", async () => {
    fetchStub
      .withArgs(
        urlMatcher({
          method: "GET",
          host: COLAB_HOST,
          path: "/tun/m/foo/keep-alive/",
          otherHeaders: {
            [COLAB_TUNNEL_HEADER.key]: COLAB_TUNNEL_HEADER.value,
          },
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
      eligibleGpus: ["T4"],
      ineligibleGpus: ["A100", "L4"],
      eligibleTpus: ["V6E1", "V28"],
      ineligibleTpus: ["V5E1"],
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
      eligibleGpus: ["T4"],
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
      /assignmentsCount.+received undefined/s,
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
  host: string;
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
 * All requests are assumed to be with the correct authorization and accept
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
    const actualAuth = headers.get(AUTHORIZATION_HEADER.key);
    const expectedAuth = `Bearer ${BEARER_TOKEN}`;
    if (actualAuth !== expectedAuth) {
      reasons.push(
        `Authorization header is "${actualAuth ?? ""}", expected "${expectedAuth}"`,
      );
    }
    const actualAccept = headers.get(ACCEPT_JSON_HEADER.key);
    if (actualAccept !== ACCEPT_JSON_HEADER.value) {
      reasons.push(
        `Accept header is "${actualAccept ?? ""}", expected "${ACCEPT_JSON_HEADER.value}"`,
      );
    }
    const actualClientAgent = headers.get(COLAB_CLIENT_AGENT_HEADER.key);
    if (actualClientAgent !== COLAB_CLIENT_AGENT_HEADER.value) {
      reasons.push(
        `Client-Agent header is "${actualClientAgent ?? ""}", expected "${COLAB_CLIENT_AGENT_HEADER.value}"`,
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
