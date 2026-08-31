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
import { ColabAssignedServer } from '../../../jupyter/servers';
import { TestUri } from '../../../test/helpers/uri';
import {
  ACCEPT_JSON_HEADER,
  AUTHORIZATION_HEADER,
  COLAB_CLIENT_AGENT_HEADER,
  COLAB_RUNTIME_PROXY_TOKEN_HEADER,
  COLAB_TUNNEL_HEADER,
  COLAB_VS_CODE_APP_NAME,
  COLAB_VS_CODE_EXTENSION_VERSION,
  COLAB_XSRF_TOKEN_HEADER,
} from '../../headers';
import { SubscriptionTier, Variant } from '../../types';
import { AuthType, ExperimentFlag, ConsumptionUserInfo } from './api';
import { ColabClient } from '.';

const COLAB_HOST = 'colab.example.com';
const GOOGLE_APIS_HOST = 'colab.example.googleapis.com';
const BEARER_TOKEN = 'access-token';
const APP_NAME = 'mock-app';
const EXTENSION_VERSION = '1.2.3';

describe('ColabClient', () => {
  let fetchStub: sinon.SinonStubbedMember<typeof fetch>;
  let sessionStub: SinonStub<[], Promise<string>>;
  let client: ColabClient;
  let onAuthErrorStub: SinonStub<[], Promise<void>>;

  beforeEach(() => {
    fetchStub = sinon.stub(fetch, 'default').callsFake(() => {
      throw new Error('fetch was called with non-matching call');
    });
    sessionStub = sinon.stub<[], Promise<string>>().resolves(BEARER_TOKEN);
    onAuthErrorStub = sinon.stub();
    client = ColabClient.create(
      new URL(`https://${COLAB_HOST}`),
      new URL(`https://${GOOGLE_APIS_HOST}`),
      { appName: APP_NAME, extensionVersion: EXTENSION_VERSION },
      () => sessionStub(),
      onAuthErrorStub,
    );
  });

  afterEach(() => {
    sinon.restore();
  });

  it('successfully gets consumption user info', async () => {
    const mockResponse = {
      subscriptionTier: 'SUBSCRIPTION_TIER_NONE',
      paidComputeUnitsBalance: 1,
      consumptionRateHourly: 2,
      assignmentsCount: 3,
      eligibleAccelerators: [
        {
          variant: 'VARIANT_GPU',
          models: ['T4'],
        },
        {
          variant: 'VARIANT_TPU',
          models: ['V6E1', 'V28'],
        },
      ],
      ineligibleAccelerators: [
        {
          variant: 'VARIANT_GPU',
          models: ['A100', 'L4'],
        },
        {
          variant: 'VARIANT_TPU',
          models: ['V5E1'],
        },
      ],
      freeCcuQuotaInfo: {
        remainingTokens: '4',
        nextRefillTimestampSec: 5,
      },
    };
    fetchStub
      .withArgs(
        urlMatcher({
          method: 'GET',
          host: GOOGLE_APIS_HOST,
          path: '/v1/user-info',
          queryParams: { get_ccu_consumption_info: 'true' },
          withAuthUser: false,
        }),
      )
      .resolves(
        new Response(withXSSI(JSON.stringify(mockResponse)), { status: 200 }),
      );

    const response = client.getConsumptionUserInfo();

    const expectedResponse: ConsumptionUserInfo = {
      subscriptionTier: SubscriptionTier.NONE,
      paidComputeUnitsBalance: mockResponse.paidComputeUnitsBalance,
      consumptionRateHourly: mockResponse.consumptionRateHourly,
      assignmentsCount: mockResponse.assignmentsCount,
      eligibleAccelerators: [
        {
          variant: Variant.GPU,
          models: ['T4'],
        },
        {
          variant: Variant.TPU,
          models: ['V6E1', 'V28'],
        },
      ],
      ineligibleAccelerators: [
        {
          variant: Variant.GPU,
          models: ['A100', 'L4'],
        },
        {
          variant: Variant.TPU,
          models: ['V5E1'],
        },
      ],
      freeCcuQuotaInfo: {
        ...mockResponse.freeCcuQuotaInfo,
        remainingTokens: Number(mockResponse.freeCcuQuotaInfo.remainingTokens),
      },
    };
    await expect(response).to.eventually.deep.equal(expectedResponse);
    sinon.assert.calledOnce(fetchStub);
  });

  describe('with an assigned server', () => {
    const assignedServerUrl = new URL(
      'https://8080-m-s-foo.bar.prod.colab.dev',
    );
    let assignedServer: ColabAssignedServer;

    beforeEach(() => {
      assignedServer = {
        id: `r-${randomUUID()}`,
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

    it('successfully gets resources by server', async () => {
      const mockResources = {
        memory: { totalBytes: 13605834752, freeBytes: 12475244544 },
        disks: [
          {
            filesystem: {
              label: 'kernel',
              totalBytes: 115658190848,
              usedBytes: 22869635072,
            },
          },
          {
            filesystem: {
              // Intentionally empty to test zod transform logic
            },
          },
        ],
        gpus: [
          {
            name: 'Tesla T4',
            memoryUsedBytes: 2869635072,
            memoryTotalBytes: 13605834752,
            gpuUtilization: 0.15,
            memoryUtilization: 0.21,
            everUsed: true,
          },
          {
            // Intentionally empty to test zod transform logic
          },
        ],
      };
      fetchStub
        .withArgs(
          urlMatcher({
            method: 'GET',
            host: assignedServerUrl.host,
            path: '/api/colab/resources',
            otherHeaders: {
              [COLAB_RUNTIME_PROXY_TOKEN_HEADER.key]:
                assignedServer.connectionInformation.token,
            },
            withAuthUser: false,
          }),
        )
        .resolves(
          new Response(withXSSI(JSON.stringify(mockResources)), {
            status: 200,
          }),
        );

      const response = await client.getResources(assignedServer);

      const expectedResources = {
        memory: mockResources.memory,
        disks: [
          mockResources.disks[0],
          {
            filesystem: { totalBytes: 0, usedBytes: 0 },
          },
        ],
        gpus: [
          mockResources.gpus[0],
          { memoryUsedBytes: 0, memoryTotalBytes: 0 },
        ],
      };
      expect(response).to.deep.equal(expectedResources);
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

  it('retries request on 401 if onAuthError is provided', async () => {
    fetchStub
      .withArgs(
        urlMatcher({
          method: 'GET',
          host: GOOGLE_APIS_HOST,
          path: '/v1/user-info',
          queryParams: { get_ccu_consumption_info: 'true' },
          withAuthUser: false,
        }),
      )
      .onFirstCall()
      .resolves(new Response('Unauthorized', { status: 401 }))
      .onSecondCall()
      .resolves(
        new Response(
          withXSSI(
            JSON.stringify({
              subscriptionTier: 'SUBSCRIPTION_TIER_NONE',
              eligibleAccelerators: [],
              ineligibleAccelerators: [],
              paidComputeUnitsBalance: 1,
              consumptionRateHourly: 2,
              assignmentsCount: 3,
            }),
          ),
          { status: 200 },
        ),
      );

    await expect(client.getConsumptionUserInfo()).to.eventually.deep.equal({
      subscriptionTier: SubscriptionTier.NONE,
      eligibleAccelerators: [],
      ineligibleAccelerators: [],
      paidComputeUnitsBalance: 1,
      consumptionRateHourly: 2,
      assignmentsCount: 3,
    });

    sinon.assert.calledTwice(fetchStub);
    sinon.assert.calledOnce(onAuthErrorStub);
  });

  it('rejects response schema mismatches', async () => {
    const mockResponse = {
      subscriptionTier: 'SUBSCRIPTION_TIER_NONE',
      paidComputeUnitsBalance: 1,
      consumptionRateHourly: 2,
    };
    fetchStub
      .withArgs(
        urlMatcher({
          method: 'GET',
          host: GOOGLE_APIS_HOST,
          path: '/v1/user-info',
          queryParams: { get_ccu_consumption_info: 'true' },
          withAuthUser: false,
        }),
      )
      .resolves(
        new Response(withXSSI(JSON.stringify(mockResponse)), { status: 200 }),
      );

    await expect(client.getConsumptionUserInfo()).to.eventually.be.rejectedWith(
      /eligibleAccelerators.+received undefined/s,
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

/**
 * Options for matching a request URL, method, query parameters, and headers in
 * Sinon.
 */
interface URLMatchOptions {
  method: 'GET' | 'POST' | 'DELETE';
  host: string;
  path: string | RegExp;
  queryParams?: Record<string, string | RegExp>;
  otherHeaders?: Record<string, string>;
  /** Whether the authuser query parameter should be included. */
  withAuthUser?: boolean;
  /** Whether the Authorization header should be included. */
  withAuthorization?: boolean;
}

/**
 * Creates a Sinon matcher that matches a request's URL, method, query
 * parameters, and headers.
 *
 * @param expected - The expected URL matching criteria.
 * @returns A Sinon matcher that matches requests with the specified URL,
 * method, query parameters, and headers. All requests are assumed to be with
 * the correct static headers that are attached to each request.
 */
function urlMatcher(expected: URLMatchOptions): SinonMatcher {
  return sinon.match(
    (request: Request) => {
      // Check method
      if (request.method.toUpperCase() !== expected.method.toUpperCase()) {
        return false;
      }

      const url = new URL(request.url);

      // Check host
      if (url.host !== expected.host) {
        return false;
      }

      // Check path
      const actualPath = url.pathname;
      if (expected.path instanceof RegExp) {
        if (!expected.path.test(actualPath)) {
          return false;
        }
      } else if (actualPath !== expected.path) {
        return false;
      }

      // Check query params
      const params = url.searchParams;
      if (expected.withAuthUser !== false && params.get('authuser') !== '0') {
        return false;
      }

      if (expected.queryParams) {
        for (const [key, value] of Object.entries(expected.queryParams)) {
          const actual = params.get(key);
          if (actual === null) {
            return false;
          }
          if (value instanceof RegExp) {
            if (!value.test(actual)) {
              return false;
            }
          } else if (actual !== value) {
            return false;
          }
        }
      }

      // Check headers
      const headers = request.headers;
      if (expected.withAuthorization !== false) {
        if (
          headers.get(AUTHORIZATION_HEADER.key) !== `Bearer ${BEARER_TOKEN}`
        ) {
          return false;
        }
      }

      const requiredHeaders: Record<string, string> = {
        [ACCEPT_JSON_HEADER.key]: ACCEPT_JSON_HEADER.value,
        [COLAB_CLIENT_AGENT_HEADER.key]: COLAB_CLIENT_AGENT_HEADER.value,
        [COLAB_VS_CODE_APP_NAME.key]: APP_NAME,
        [COLAB_VS_CODE_EXTENSION_VERSION.key]: EXTENSION_VERSION,
        ...expected.otherHeaders,
      };

      for (const [key, expectedVal] of Object.entries(requiredHeaders)) {
        if (headers.get(key) !== expectedVal) {
          return false;
        }
      }

      return true;
    },
    `Request matching ${JSON.stringify(expected)}`,
  );
}
