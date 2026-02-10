/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'crypto';
import { expect } from 'chai';
import fetch, { Response } from 'node-fetch';
import { SinonStub, SinonMatcher } from 'sinon';
import * as sinon from 'sinon';
import { Session } from '../jupyter/client/generated';
import { ColabAssignedServer } from '../jupyter/servers';
import { TestUri } from '../test/helpers/uri';
import { uuidToWebSafeBase64 } from '../utils/uuid';
import {
  CcuInfo,
  Assignment,
  Shape,
  SubscriptionState,
  SubscriptionTier,
  Variant,
  Outcome,
  ListedAssignments,
  RuntimeProxyInfo,
  AuthType,
  ExperimentFlag,
} from './api';
import {
  ColabClient,
  DenylistedError,
  InsufficientQuotaError,
  TooManyAssignmentsError,
} from './client';
import {
  ACCEPT_JSON_HEADER,
  AUTHORIZATION_HEADER,
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_TUNNEL_HEADER,
  COLAB_XSRF_TOKEN_HEADER,
} from './headers';

const COLAB_HOST = 'colab.example.com';
const GOOGLE_APIS_HOST = 'colab.example.googleapis.com';
const BEARER_TOKEN = 'access-token';
const NOTEBOOK_HASH = randomUUID();
const DEFAULT_ASSIGNMENT_RESPONSE = {
  accelerator: 'A100',
  endpoint: 'mock-server',
  fit: 30,
  sub: SubscriptionState.UNSUBSCRIBED,
  subTier: SubscriptionTier.NONE,
  variant: Variant.GPU,
  machineShape: Shape.STANDARD,
  runtimeProxyInfo: {
    token: 'mock-token',
    tokenExpiresInSeconds: 42,
    url: 'https://mock-url.com',
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

describe('ColabClient', () => {
  let fetchStub: sinon.SinonStubbedMember<typeof fetch>;
  let sessionStub: SinonStub<[], Promise<string>>;
  let client: ColabClient;
  let onAuthErrorStub: SinonStub<[], Promise<void>>;

  beforeEach(() => {
    fetchStub = sinon.stub(fetch, 'default');
    sessionStub = sinon.stub<[], Promise<string>>().resolves(BEARER_TOKEN);
    onAuthErrorStub = sinon.stub<[], Promise<void>>().resolves();
    client = new ColabClient(
      new URL(`https://${COLAB_HOST}`),
      new URL(`https://${GOOGLE_APIS_HOST}`),
      sessionStub,
      onAuthErrorStub,
    );
  });

  afterEach(() => {
    sinon.restore();
  });

  it('successfully gets the subscription tier', async () => {
    const mockResponse = {
      subscriptionTier: 'SUBSCRIPTION_TIER_NONE',
      paidComputeUnitsBalance: 0,
      eligibleAccelerators: [{ variant: 'VARIANT_GPU', models: ['T4'] }],
    };
    fetchStub
      .withArgs(
        urlMatcher({
          method: 'GET',
          host: GOOGLE_APIS_HOST,
          path: '/v1/user-info',
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

  it('successfully gets CCU info', async () => {
    const mockResponse = {
      currentBalance: 1,
      consumptionRateHourly: 2,
      assignmentsCount: 3,
      eligibleGpus: ['T4'],
      ineligibleGpus: ['A100', 'L4'],
      eligibleTpus: ['V6E1', 'V28'],
      ineligibleTpus: ['V5E1'],
      freeCcuQuotaInfo: {
        remainingTokens: '4',
        nextRefillTimestampSec: 5,
      },
    };
    fetchStub
      .withArgs(
        urlMatcher({
          method: 'GET',
          host: COLAB_HOST,
          path: '/tun/m/ccu-info',
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

  describe('assignment', () => {
    const ASSIGN_PATH = '/tun/m/assign';
    let wireNbh: string;
    let queryParams: Record<string, string | RegExp>;

    beforeEach(() => {
      wireNbh = uuidToWebSafeBase64(NOTEBOOK_HASH);
      queryParams = {
        nbh: wireNbh,
      };
    });

    it('resolves an existing assignment', async () => {
      fetchStub
        .withArgs(
          urlMatcher({
            method: 'GET',
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
        client.assign(NOTEBOOK_HASH, Variant.GPU, 'A100'),
      ).to.eventually.deep.equal({
        assignment: DEFAULT_ASSIGNMENT,
        isNew: false,
      });

      sinon.assert.calledOnce(fetchStub);
    });

    describe('without an existing assignment', () => {
      beforeEach(() => {
        const mockGetResponse = {
          acc: 'NONE',
          nbh: wireNbh,
          p: false,
          token: 'mock-xsrf-token',
          variant: Variant.DEFAULT,
        };
        fetchStub
          .withArgs(
            urlMatcher({
              method: 'GET',
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

      const assignmentTests: [Variant, string?, Shape?][] = [
        [Variant.DEFAULT, undefined],
        [Variant.GPU, 'T4'],
        [Variant.TPU, 'V28', Shape.STANDARD],
        [Variant.DEFAULT, undefined, Shape.HIGHMEM],
        [Variant.GPU, 'A100', Shape.HIGHMEM],
        [Variant.TPU, 'V6E1', Shape.HIGHMEM],
      ];
      for (const [variant, accelerator, shape] of assignmentTests) {
        const assignment = `${variant}${accelerator ? ` (${accelerator})` : ''} with shape ${String(shape ?? Shape.STANDARD)}`;

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
          if (shape === Shape.HIGHMEM) {
            postQueryParams.shape = 'hm';
          }
          const assignmentResponse = {
            ...DEFAULT_ASSIGNMENT_RESPONSE,
            variant,
            accelerator: accelerator ?? 'NONE',
            ...(shape === Shape.HIGHMEM ? { machineShape: Shape.HIGHMEM } : {}),
          };
          fetchStub
            .withArgs(
              urlMatcher({
                method: 'POST',
                host: COLAB_HOST,
                path: ASSIGN_PATH,
                queryParams: postQueryParams,
                otherHeaders: {
                  [COLAB_XSRF_TOKEN_HEADER.key]: 'mock-xsrf-token',
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
            accelerator: accelerator ?? 'NONE',
            ...(shape === Shape.HIGHMEM ? { machineShape: Shape.HIGHMEM } : {}),
          };
          await expect(
            client.assign(NOTEBOOK_HASH, variant, accelerator, shape),
          ).to.eventually.deep.equal({
            assignment: expectedAssignment,
            isNew: true,
          });

          sinon.assert.calledTwice(fetchStub);
        });
      }

      it('rejects when assignments exceed limit', async () => {
        fetchStub
          .withArgs(
            urlMatcher({
              method: 'POST',
              host: COLAB_HOST,
              path: ASSIGN_PATH,
              queryParams,
              otherHeaders: {
                'X-Goog-Colab-Token': 'mock-xsrf-token',
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
          reason: 'request variant unavailable',
          outcome: Outcome.QUOTA_DENIED_REQUESTED_VARIANTS,
        },
        {
          reason: 'usage time exceeded',
          outcome: Outcome.QUOTA_EXCEEDED_USAGE_TIME,
        },
      ]) {
        it(`rejects when quota is exceeded due to ${quotaTest.reason}`, async () => {
          fetchStub
            .withArgs(
              urlMatcher({
                method: 'POST',
                host: COLAB_HOST,
                path: ASSIGN_PATH,
                queryParams,
                otherHeaders: {
                  'X-Goog-Colab-Token': 'mock-xsrf-token',
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

      it('rejects when user is banned', async () => {
        fetchStub
          .withArgs(
            urlMatcher({
              method: 'POST',
              host: COLAB_HOST,
              path: ASSIGN_PATH,
              queryParams,
              otherHeaders: {
                'X-Goog-Colab-Token': 'mock-xsrf-token',
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

  it('successfully lists assignments', async () => {
    fetchStub
      .withArgs(
        urlMatcher({
          method: 'GET',
          host: COLAB_HOST,
          path: '/tun/m/assignments',
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

  it('successfully unassigns the specified assignment', async () => {
    const endpoint = 'mock-server';
    const path = `/tun/m/unassign/${endpoint}`;
    const token = 'mock-xsrf-token';
    fetchStub
      .withArgs(urlMatcher({ method: 'GET', host: COLAB_HOST, path }))
      .resolves(
        new Response(withXSSI(JSON.stringify({ token })), { status: 200 }),
      );
    fetchStub
      .withArgs(
        urlMatcher({
          method: 'POST',
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

  describe('with an assigned server', () => {
    const assignedServerUrl = new URL(
      'https://8080-m-s-foo.bar.prod.colab.dev',
    );
    let assignedServer: ColabAssignedServer;

    beforeEach(() => {
      assignedServer = {
        id: randomUUID(),
        label: 'foo',
        variant: Variant.DEFAULT,
        accelerator: undefined,
        endpoint: 'm-s-foo',
        connectionInformation: {
          baseUrl: TestUri.parse(assignedServerUrl.toString()),
          token: '123',
          tokenExpiry: new Date(Date.now() + 1000 * 60 * 60),
        },
        dateAssigned: new Date(),
      };
    });

    it('successfully refreshes the connection', async () => {
      const newConnectionInfo: RuntimeProxyInfo = {
        token: 'new',
        tokenExpiresInSeconds: 3600,
        url: assignedServerUrl.toString(),
      };
      const path = '/tun/m/runtime-proxy-token';
      fetchStub
        .withArgs(
          urlMatcher({
            method: 'GET',
            host: COLAB_HOST,
            path,
            queryParams: {
              endpoint: assignedServer.endpoint,
              port: '8080',
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

    it('successfully lists sessions by assignment endpoint', async () => {
      const last_activity = new Date().toISOString();
      const mockResponseSession = {
        id: 'mock-session-id',
        kernel: {
          id: 'mock-kernel-id',
          name: 'mock-kernel-name',
          last_activity,
          execution_state: 'idle',
          connections: 1,
        },
        name: 'mock-session-name',
        path: '/mock-path',
        type: 'notebook',
      };
      const expectedSession: Session = {
        id: 'mock-session-id',
        kernel: {
          id: 'mock-kernel-id',
          name: 'mock-kernel-name',
          lastActivity: last_activity,
          executionState: 'idle',
          connections: 1,
        },
        name: 'mock-session-name',
        path: '/mock-path',
        type: 'notebook',
      };
      fetchStub
        .withArgs(
          urlMatcher({
            method: 'GET',
            host: COLAB_HOST,
            path: `/tun/m/${assignedServer.endpoint}/api/sessions`,
            otherHeaders: {
              [COLAB_TUNNEL_HEADER.key]: COLAB_TUNNEL_HEADER.value,
            },
            withAuthUser: false,
          }),
        )
        .resolves(
          new Response(withXSSI(JSON.stringify([mockResponseSession])), {
            status: 200,
          }),
        );

      await expect(
        client.listSessions(assignedServer.endpoint),
      ).to.eventually.deep.equal([expectedSession]);

      sinon.assert.calledOnce(fetchStub);
    });
  });

  it('successfully issues keep-alive pings', async () => {
    fetchStub
      .withArgs(
        urlMatcher({
          method: 'GET',
          host: COLAB_HOST,
          path: '/tun/m/foo/keep-alive/',
          otherHeaders: {
            [COLAB_TUNNEL_HEADER.key]: COLAB_TUNNEL_HEADER.value,
          },
        }),
      )
      .resolves(new Response(undefined, { status: 200 }));

    await expect(client.sendKeepAlive('foo')).to.eventually.be.fulfilled;

    sinon.assert.calledOnce(fetchStub);
  });

  it('supports non-XSSI responses', async () => {
    const mockResponse = {
      currentBalance: 1,
      consumptionRateHourly: 2,
      assignmentsCount: 3,
      eligibleGpus: ['T4'],
      ineligibleGpus: ['A100', 'L4'],
      eligibleTpus: ['V6E1', 'V28'],
      ineligibleTpus: ['V5E1'],
    };
    fetchStub
      .withArgs(
        urlMatcher({
          method: 'GET',
          host: COLAB_HOST,
          path: '/tun/m/ccu-info',
        }),
      )
      .resolves(new Response(JSON.stringify(mockResponse), { status: 200 }));

    await expect(client.getCcuInfo()).to.eventually.deep.equal(mockResponse);

    sinon.assert.calledOnce(fetchStub);
  });

  it('retries request on 401 if onAuthError is provided', async () => {
    const mockResponse = {
      currentBalance: 1,
      consumptionRateHourly: 2,
      assignmentsCount: 3,
      eligibleGpus: ['T4'],
      ineligibleGpus: ['A100', 'L4'],
      eligibleTpus: ['V6E1', 'V28'],
      ineligibleTpus: ['V5E1'],
    };

    fetchStub
      .withArgs(
        urlMatcher({
          method: 'GET',
          host: COLAB_HOST,
          path: '/tun/m/ccu-info',
        }),
      )
      .onFirstCall()
      .resolves(new Response('Unauthorized', { status: 401 }))
      .onSecondCall()
      .resolves(
        new Response(withXSSI(JSON.stringify(mockResponse)), { status: 200 }),
      );

    await expect(client.getCcuInfo()).to.eventually.deep.equal(mockResponse);

    sinon.assert.calledTwice(fetchStub);
    sinon.assert.calledOnce(onAuthErrorStub);
  });

  it('does not retry more than two times on persistent 401', async () => {
    fetchStub
      .withArgs(sinon.match.any)
      .resolves(new Response('Unauthorized', { status: 401 }));

    await expect(client.getCcuInfo()).to.eventually.be.rejectedWith(
      /Unauthorized/,
    );

    sinon.assert.calledTwice(fetchStub);
    sinon.assert.calledTwice(onAuthErrorStub);
  });

  it('throws on 401 if onAuthError is not provided', async () => {
    client = new ColabClient(
      new URL(`https://${COLAB_HOST}`),
      new URL(`https://${GOOGLE_APIS_HOST}`),
      sessionStub,
    );

    fetchStub
      .withArgs(sinon.match.any)
      .resolves(new Response('Unauthorized', { status: 401 }));

    await expect(client.getCcuInfo()).to.eventually.be.rejectedWith(
      /Unauthorized/,
    );
    sinon.assert.notCalled(onAuthErrorStub);
  });

  it('rejects when error responses are returned', async () => {
    fetchStub
      .withArgs(
        urlMatcher({
          method: 'GET',
          host: COLAB_HOST,
          path: '/tun/m/ccu-info',
        }),
      )
      .resolves(
        new Response('Error', {
          status: 500,
          statusText: 'Foo error',
        }),
      );

    await expect(client.getCcuInfo()).to.eventually.be.rejectedWith(
      /Foo error/,
    );
  });

  it('rejects invalid JSON responses', async () => {
    fetchStub
      .withArgs(
        urlMatcher({
          method: 'GET',
          host: COLAB_HOST,
          path: '/tun/m/ccu-info',
        }),
      )
      .resolves(new Response(withXSSI('not JSON eh?'), { status: 200 }));

    await expect(client.getCcuInfo()).to.eventually.be.rejectedWith(
      /not JSON.+eh\?/,
    );
  });

  it('rejects response schema mismatches', async () => {
    const mockResponse: Partial<CcuInfo> = {
      currentBalance: 1,
      consumptionRateHourly: 2,
      eligibleGpus: ['T4'],
    };
    fetchStub
      .withArgs(
        urlMatcher({
          method: 'GET',
          host: COLAB_HOST,
          path: '/tun/m/ccu-info',
        }),
      )
      .resolves(
        new Response(withXSSI(JSON.stringify(mockResponse)), { status: 200 }),
      );

    await expect(client.getCcuInfo()).to.eventually.be.rejectedWith(
      /assignmentsCount.+received undefined/s,
    );
  });

  it('initializes fetch with abort signal', async () => {
    const abort = new AbortController();
    fetchStub
      .withArgs(sinon.match({ signal: abort.signal }))
      .resolves(new Response(undefined, { status: 200 }));

    await expect(client.sendKeepAlive('foo', abort.signal)).to.eventually.be
      .fulfilled;

    sinon.assert.calledOnce(fetchStub);
  });

  describe('propagateCredentials', () => {
    const tests = [
      { authType: AuthType.DFS_EPHEMERAL, dryRun: true },
      { authType: AuthType.DFS_EPHEMERAL, dryRun: false },
      { authType: AuthType.AUTH_USER_EPHEMERAL, dryRun: true },
      { authType: AuthType.AUTH_USER_EPHEMERAL, dryRun: false },
    ];
    tests.forEach(({ authType, dryRun }) => {
      it(`successfully propagates ${authType} credentials${dryRun ? ' (dryRun)' : ''}`, async () => {
        const endpoint = 'mock-server';
        const path = `/tun/m/credentials-propagation/${endpoint}`;
        const token = 'mock-xsrf-token';
        const queryParams = {
          authtype: authType,
          dryrun: String(dryRun),
          record: 'false',
          version: '2',
          propagate: 'true',
        };
        fetchStub
          .withArgs(
            urlMatcher({
              method: 'GET',
              host: COLAB_HOST,
              path,
              queryParams,
            }),
          )
          .resolves(
            new Response(withXSSI(JSON.stringify({ token })), {
              status: 200,
            }),
          );
        fetchStub
          .withArgs(
            urlMatcher({
              method: 'POST',
              host: COLAB_HOST,
              path,
              queryParams,
              otherHeaders: { [COLAB_XSRF_TOKEN_HEADER.key]: token },
            }),
          )
          .resolves(
            new Response(withXSSI(JSON.stringify({ success: true })), {
              status: 200,
            }),
          );

        const result = client.propagateCredentials(endpoint, {
          authType,
          dryRun,
        });

        await expect(result).to.eventually.be.fulfilled;
        sinon.assert.calledTwice(fetchStub);
      });
    });
  });

  describe('getExperimentState', () => {
    for (const { name, requireAccessToken } of [
      {
        name: 'without auth',
        requireAccessToken: false,
      },
      {
        name: 'with auth',
        requireAccessToken: true,
      },
    ]) {
      it(`successfully gets experiment state ${name}`, async () => {
        const mockResponse = {
          experiments: {
            [ExperimentFlag.RuntimeVersionNames]: true,
          },
        };

        fetchStub
          .withArgs(
            urlMatcher({
              method: 'GET',
              host: COLAB_HOST,
              path: '/vscode/experiment-state',
              withAuthUser: requireAccessToken,
              withAuthorization: requireAccessToken,
            }),
          )
          .resolves(
            new Response(withXSSI(JSON.stringify(mockResponse)), {
              status: 200,
            }),
          );

        await expect(
          client.getExperimentState(requireAccessToken),
        ).to.eventually.deep.equal({
          experiments: new Map([[ExperimentFlag.RuntimeVersionNames, true]]),
        });

        sinon.assert.calledOnce(fetchStub);
      });
    }

    for (const { name, mockResponse, expected } of [
      {
        name: 'filters out undeclared experiment flags',
        mockResponse: {
          experiments: {
            [ExperimentFlag.RuntimeVersionNames]: true,
            undeclared_flag: 'should_be_ignored',
          },
        },
        expected: {
          experiments: new Map([[ExperimentFlag.RuntimeVersionNames, true]]),
        },
      },
      {
        name: 'handles empty experiment state',
        mockResponse: {
          experiments: {},
        },
        expected: {
          experiments: new Map(),
        },
      },
      {
        name: 'handles missing experiment state',
        mockResponse: {},
        expected: {},
      },
    ]) {
      it(name, async () => {
        fetchStub
          .withArgs(
            urlMatcher({
              method: 'GET',
              host: COLAB_HOST,
              path: '/vscode/experiment-state',
              withAuthUser: false,
              withAuthorization: false,
            }),
          )
          .resolves(
            new Response(withXSSI(JSON.stringify(mockResponse)), {
              status: 200,
            }),
          );

        await expect(client.getExperimentState()).to.eventually.deep.equal(
          expected,
        );
      });
    }

    it('rejects invalid experiment state schema', async () => {
      const mockResponse = {
        experiments: 'not-an-object',
      };

      fetchStub
        .withArgs(
          urlMatcher({
            method: 'GET',
            host: COLAB_HOST,
            path: '/vscode/experiment-state',
            withAuthUser: false,
            withAuthorization: false,
          }),
        )
        .resolves(
          new Response(withXSSI(JSON.stringify(mockResponse)), { status: 200 }),
        );

      await expect(client.getExperimentState()).to.eventually.be.rejected;
    });
  });
});

function withXSSI(response: string): string {
  return `)]}'\n${response}`;
}

export interface URLMatchOptions {
  method: 'GET' | 'POST' | 'DELETE';
  host: string;
  path: string | RegExp;
  queryParams?: Record<string, string | RegExp>;
  otherHeaders?: Record<string, string>;
  formBody?: Record<string, string | RegExp>;
  /** Whether the authuser query parameter should be included. Defaults to true. */
  withAuthUser?: boolean;
  /** Whether the Authorization header should be included. Defaults to true. */
  withAuthorization?: boolean;
}

/**
 * Creates a Sinon matcher that matches a request's URL, method, query
 * parameters, and headers.
 *
 * All requests are assumed to be with the correct authorization and accept
 * headers.
 */
export function urlMatcher(expected: URLMatchOptions): SinonMatcher {
  let reason = '';
  return sinon.match((request: Request) => {
    const reasons: string[] = [];
    reason = '';

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
      const actualAuthuser = params.get('authuser');
      if (actualAuthuser !== '0') {
        reasons.push(
          `authuser param is "${actualAuthuser ?? ''}", expected "0"`,
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
    if (expected.withAuthorization !== false) {
      const actualAuth = headers.get(AUTHORIZATION_HEADER.key);
      const expectedAuth = `Bearer ${BEARER_TOKEN}`;
      if (actualAuth !== expectedAuth) {
        reasons.push(
          `Authorization header is "${actualAuth ?? ''}", expected "${expectedAuth}"`,
        );
      }
    }
    const actualAccept = headers.get(ACCEPT_JSON_HEADER.key);
    if (actualAccept !== ACCEPT_JSON_HEADER.value) {
      reasons.push(
        `Accept header is "${actualAccept ?? ''}", expected "${ACCEPT_JSON_HEADER.value}"`,
      );
    }
    const actualClientAgent = headers.get(COLAB_CLIENT_AGENT_HEADER.key);
    if (actualClientAgent !== COLAB_CLIENT_AGENT_HEADER.value) {
      reasons.push(
        `Client-Agent header is "${actualClientAgent ?? ''}", expected "${COLAB_CLIENT_AGENT_HEADER.value}"`,
      );
    }
    if (expected.otherHeaders) {
      for (const [key, expectedVal] of Object.entries(expected.otherHeaders)) {
        const actualVal = headers.get(key);
        if (actualVal !== expectedVal) {
          reasons.push(
            `header "${key}" = "${actualVal ?? ''}", expected "${expectedVal}"`,
          );
        }
      }
    }

    // Check form body
    if (expected.formBody) {
      // Though `request` has a `formData()` method in its type definition, it's
      // unimplemented in tests, hence parsing `request.body` manually.
      const parsedBody = parseRequestBody(request.body);
      for (const [key, expectedVal] of Object.entries(expected.formBody)) {
        if (!(key in parsedBody)) {
          reasons.push(`missing "${key}" in form body`);
          continue;
        }

        const actualVal = parsedBody[key];
        if (expectedVal instanceof RegExp) {
          if (!expectedVal.test(actualVal)) {
            reasons.push(
              `form body "${key}" = "${actualVal}" does not match "${expectedVal.source}"`,
            );
          }
        } else if (actualVal !== expectedVal) {
          reasons.push(
            `form body "${key}" = "${actualVal}" !== expected "${expectedVal}"`,
          );
        }
      }
    }

    if (reasons.length > 0) {
      reason = reasons.join('; ');
      return false;
    }

    return true;
  }, reason || 'URL did not match expected pattern');
}

const formDataKeyPattern = /Content-Disposition: form-data; name="(.+)"/;

function parseRequestBody(
  body: ReadableStream<Uint8Array<ArrayBuffer>> | null,
): Record<string, string> {
  const results: Record<string, string> = {};
  if (!body) return results;

  // Though `request.body` is typed as a `ReadableStream`, it's not a real
  // ReadableStream in tests. Doing a hacky cast to access its internal
  // `_streams` property.
  const bodyStreams = (body as unknown as { _streams: string[] })._streams;
  for (let i = 0; i < bodyStreams.length; i++) {
    const chunk = bodyStreams[i];
    const keyMatch = formDataKeyPattern.exec(chunk);
    if (keyMatch) {
      const key = keyMatch[1];
      const value = bodyStreams[i + 1];
      results[key] = value;
    }
  }
  return results;
}
