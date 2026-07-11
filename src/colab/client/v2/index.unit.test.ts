/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import * as sinon from 'sinon';
import { SinonStubbedFunction } from 'sinon';
import { telemetry } from '../../../telemetry';
import {
  AcceleratorUnavailableError,
  DenylistedError,
  InsufficientQuotaError,
  LongRunningOperationError,
  TooManyAssignmentsError,
} from '../../errors';
import { AUTHORIZATION_HEADER, COLAB_CLIENT_AGENT_HEADER } from '../../headers';
import {
  Shape as CommonShape,
  SubscriptionTier as CommonSubscriptionTier,
  Variant as CommonVariant,
} from '../../types';
import {
  FetchAPI,
  Key,
  Shape,
  SubscriptionTier,
  Variant,
} from './generated/colab';
import { Operation } from './generated/operations';
import {
  ColabApiClient,
  createColabApiClient,
  denormalizeShape,
  denormalizeVariant,
  normalizeShape,
  normalizeSubscriptionTier,
  normalizeVariant,
  throwIfOperationError,
} from '.';

const COLAB_API_HOST = 'colab.example.com';
const BEARER_TOKEN = 'test-access-token';

describe('ColabApiClient', () => {
  let client: ColabApiClient;
  let sessionStub: sinon.SinonStub<[], Promise<string>>;
  let onAuthErrorStub: sinon.SinonStub<[], Promise<void>>;
  let logErrorStub: SinonStubbedFunction<typeof telemetry.logError>;
  let fetchSpy: sinon.SinonSpy<Parameters<FetchAPI>, ReturnType<FetchAPI>>;

  const server = setupServer();

  before(() => {
    // NOTE: server.listen must be called before `createClient` is used to
    // ensure the msw can inject its version of `fetch` to intercept the
    // requests.
    server.listen({
      onUnhandledRequest: (request) => {
        throw new Error(
          `No request handler found for ${request.method} ${request.url}`,
        );
      },
    });
  });

  beforeEach(() => {
    sessionStub = sinon.stub<[], Promise<string>>().resolves(BEARER_TOKEN);
    onAuthErrorStub = sinon.stub();
    logErrorStub = sinon.stub(telemetry, 'logError');
    fetchSpy = sinon.spy(globalThis, 'fetch');
    client = createColabApiClient(
      `https://${COLAB_API_HOST}`,
      () => sessionStub(),
      onAuthErrorStub,
    );
  });

  afterEach(() => {
    sinon.restore();
    server.resetHandlers();
  });
  after(() => {
    server.close();
  });

  describe('getSubscription', () => {
    const subscription = {
      name: 'subscription',
      tier: 'SUBSCRIPTION_TIER_FREE',
    };

    beforeEach(() => {
      server.use(
        http.get(`https://${COLAB_API_HOST}/v1beta/subscription`, () =>
          HttpResponse.json(subscription, { status: 200 }),
        ),
      );
    });

    it('returns the subscription', async () => {
      await expect(client.colab.getSubscription()).to.eventually.deep.equal(
        subscription,
      );
    });

    it('sends client agent header', async () => {
      await client.colab.getSubscription();

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match.string,
        sinon.match((init: RequestInit) => {
          const headers = new Headers(init.headers);
          return (
            headers.get(COLAB_CLIENT_AGENT_HEADER.key) ===
            COLAB_CLIENT_AGENT_HEADER.value
          );
        }),
      );
    });

    it('sends authorization header', async () => {
      await client.colab.getSubscription();

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match.string,
        sinon.match((init: RequestInit) => {
          const headers = new Headers(init.headers);
          return (
            headers.get(AUTHORIZATION_HEADER.key) === `Bearer ${BEARER_TOKEN}`
          );
        }),
      );
    });

    it('does not send authorization header if token is empty', async () => {
      sessionStub.resolves('');

      await client.colab.getSubscription();

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match.string,
        sinon.match((init: RequestInit) => {
          const headers = new Headers(init.headers);
          return !headers.has(AUTHORIZATION_HEADER.key);
        }),
      );
    });

    it('logs to telemetry on fetch error', async () => {
      server.use(
        http.get(`https://${COLAB_API_HOST}/v1beta/subscription`, () =>
          HttpResponse.error(),
        ),
      );

      await expect(client.colab.getSubscription()).to.be.rejected;

      sinon.assert.calledOnce(logErrorStub);
    });

    const tests = [
      { error: 'Bad Request', status: 400, onAuthErrorCalled: false },
      { error: 'Unauthorized', status: 401, onAuthErrorCalled: true },
      { error: 'Internal', status: 500, onAuthErrorCalled: false },
    ];
    tests.forEach(({ error, status, onAuthErrorCalled }) => {
      describe(`with status ${String(status)}`, () => {
        beforeEach(() => {
          server.use(
            http.get(`https://${COLAB_API_HOST}/v1beta/subscription`, () =>
              HttpResponse.json({ error }, { status }),
            ),
          );
        });

        it('throws an error and logs to telemetry', async () => {
          await expect(client.colab.getSubscription()).to.be.rejected;

          sinon.assert.calledOnce(logErrorStub);
        });

        if (onAuthErrorCalled) {
          it('calls onAuthError', async () => {
            await expect(client.colab.getSubscription()).to.be.rejected;

            sinon.assert.calledOnce(onAuthErrorStub);
          });
        } else {
          it('does not call onAuthError', async () => {
            await expect(client.colab.getSubscription()).to.be.rejected;

            sinon.assert.notCalled(onAuthErrorStub);
          });
        }
      });
    });
  });

  describe('listRuntimeSpecs', () => {
    const runtimeSpecs = [
      {
        key: {
          variant: 'VARIANT_CPU',
          accelerator: 'NONE',
          shape: 'SHAPE_STANDARD',
        },
        eligible: true,
      },
      {
        key: {
          variant: 'VARIANT_GPU',
          accelerator: 'T4',
          shape: 'SHAPE_STANDARD',
        },
        eligible: true,
      },
      {
        key: {
          variant: 'VARIANT_TPU',
          accelerator: 'V6E1',
          shape: 'SHAPE_HIGHMEM',
        },
        eligible: false,
      },
    ];

    beforeEach(() => {
      server.use(
        http.get(`https://${COLAB_API_HOST}/v1beta/runtimespecs`, () =>
          HttpResponse.json({ runtimeSpecs }, { status: 200 }),
        ),
      );
    });

    it('returns a list of runtime specs', async () => {
      await expect(client.colab.listRuntimeSpecs()).to.eventually.deep.equal({
        runtimeSpecs,
      });
    });

    it('sends client agent header', async () => {
      await client.colab.listRuntimeSpecs();

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match.string,
        sinon.match((init: RequestInit) => {
          const headers = new Headers(init.headers);
          return (
            headers.get(COLAB_CLIENT_AGENT_HEADER.key) ===
            COLAB_CLIENT_AGENT_HEADER.value
          );
        }),
      );
    });

    it('sends authorization header', async () => {
      await client.colab.listRuntimeSpecs();

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match.string,
        sinon.match((init: RequestInit) => {
          const headers = new Headers(init.headers);
          return (
            headers.get(AUTHORIZATION_HEADER.key) === `Bearer ${BEARER_TOKEN}`
          );
        }),
      );
    });

    it('does not send authorization header if token is empty', async () => {
      sessionStub.resolves('');

      await client.colab.listRuntimeSpecs();

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match.string,
        sinon.match((init: RequestInit) => {
          const headers = new Headers(init.headers);
          return !headers.has(AUTHORIZATION_HEADER.key);
        }),
      );
    });

    it('logs to telemetry on fetch error', async () => {
      server.use(
        http.get(`https://${COLAB_API_HOST}/v1beta/runtimespecs`, () =>
          HttpResponse.error(),
        ),
      );

      await expect(client.colab.listRuntimeSpecs()).to.be.rejected;

      sinon.assert.calledOnce(logErrorStub);
    });

    const tests = [
      { error: 'Bad Request', status: 400, onAuthErrorCalled: false },
      { error: 'Unauthorized', status: 401, onAuthErrorCalled: true },
      { error: 'Internal', status: 500, onAuthErrorCalled: false },
    ];
    tests.forEach(({ error, status, onAuthErrorCalled }) => {
      describe(`with status ${String(status)}`, () => {
        beforeEach(() => {
          server.use(
            http.get(`https://${COLAB_API_HOST}/v1beta/runtimespecs`, () =>
              HttpResponse.json({ error }, { status }),
            ),
          );
        });

        it('throws an error and logs to telemetry', async () => {
          await expect(client.colab.listRuntimeSpecs()).to.be.rejected;

          sinon.assert.calledOnce(logErrorStub);
        });

        if (onAuthErrorCalled) {
          it('calls onAuthError', async () => {
            await expect(client.colab.listRuntimeSpecs()).to.be.rejected;

            sinon.assert.calledOnce(onAuthErrorStub);
          });
        } else {
          it('does not call onAuthError', async () => {
            await expect(client.colab.listRuntimeSpecs()).to.be.rejected;

            sinon.assert.notCalled(onAuthErrorStub);
          });
        }
      });
    });
  });

  describe('runtimes', () => {
    const runtimeId = 'r-1';
    const runtimes = [
      {
        name: `runtimes/${runtimeId}`,
        runtimeSpec: {
          variant: 'VARIANT_CPU',
          accelerator: 'NONE',
          shape: 'SHAPE_STANDARD',
        },
        connectionInfo: {
          endpoint: 'test-endpoint',
          url: 'test-url',
          token: 'test-token',
          expireTime: new Date(2026, 0, 1),
        },
      },
      {
        name: 'runtimes/r-2',
        runtimeSpec: {
          variant: 'VARIANT_GPU',
          accelerator: 'T4',
          shape: 'SHAPE_STANDARD',
        },
        connectionInfo: undefined,
      },
      {
        name: 'runtimes/r-3',
        runtimeSpec: {
          variant: 'VARIANT_TPU',
          accelerator: 'V6E1',
          shape: 'SHAPE_HIGHMEM',
        },
        connectionInfo: undefined,
      },
    ];

    describe('list', () => {
      beforeEach(() => {
        server.use(
          http.get(`https://${COLAB_API_HOST}/v1beta/runtimes`, () =>
            HttpResponse.json({ runtimes }, { status: 200 }),
          ),
        );
      });

      it('returns a list of runtimes', async () => {
        await expect(client.colab.listRuntimes()).to.eventually.deep.equal({
          runtimes,
        });
      });

      it('sends client agent header', async () => {
        await client.colab.listRuntimes();

        sinon.assert.calledOnceWithMatch(
          fetchSpy,
          sinon.match.string,
          sinon.match((init: RequestInit) => {
            const headers = new Headers(init.headers);
            return (
              headers.get(COLAB_CLIENT_AGENT_HEADER.key) ===
              COLAB_CLIENT_AGENT_HEADER.value
            );
          }),
        );
      });

      it('sends authorization header', async () => {
        await client.colab.listRuntimes();

        sinon.assert.calledOnceWithMatch(
          fetchSpy,
          sinon.match.string,
          sinon.match((init: RequestInit) => {
            const headers = new Headers(init.headers);
            return (
              headers.get(AUTHORIZATION_HEADER.key) === `Bearer ${BEARER_TOKEN}`
            );
          }),
        );
      });

      it('does not send authorization header if token is empty', async () => {
        sessionStub.resolves('');

        await client.colab.listRuntimes();

        sinon.assert.calledOnceWithMatch(
          fetchSpy,
          sinon.match.string,
          sinon.match((init: RequestInit) => {
            const headers = new Headers(init.headers);
            return !headers.has(AUTHORIZATION_HEADER.key);
          }),
        );
      });

      it('logs to telemetry on fetch error', async () => {
        server.use(
          http.get(`https://${COLAB_API_HOST}/v1beta/runtimes`, () =>
            HttpResponse.error(),
          ),
        );

        await expect(client.colab.listRuntimes()).to.be.rejected;

        sinon.assert.calledOnce(logErrorStub);
      });

      const tests = [
        { error: 'Bad Request', status: 400, onAuthErrorCalled: false },
        { error: 'Unauthorized', status: 401, onAuthErrorCalled: true },
        { error: 'Internal', status: 500, onAuthErrorCalled: false },
      ];
      tests.forEach(({ error, status, onAuthErrorCalled }) => {
        describe(`with status ${String(status)}`, () => {
          beforeEach(() => {
            server.use(
              http.get(`https://${COLAB_API_HOST}/v1beta/runtimes`, () =>
                HttpResponse.json({ error }, { status }),
              ),
            );
          });

          it('throws an error and logs to telemetry', async () => {
            await expect(client.colab.listRuntimes()).to.be.rejected;

            sinon.assert.calledOnce(logErrorStub);
          });

          if (onAuthErrorCalled) {
            it('calls onAuthError', async () => {
              await expect(client.colab.listRuntimes()).to.be.rejected;

              sinon.assert.calledOnce(onAuthErrorStub);
            });
          } else {
            it('does not call onAuthError', async () => {
              await expect(client.colab.listRuntimes()).to.be.rejected;

              sinon.assert.notCalled(onAuthErrorStub);
            });
          }
        });
      });
    });

    describe('get', () => {
      const runtime = runtimes[0];

      beforeEach(() => {
        server.use(
          http.get(
            `https://${COLAB_API_HOST}/v1beta/runtimes/${runtimeId}`,
            () => HttpResponse.json(runtime, { status: 200 }),
          ),
        );
      });

      it('returns the runtime', async () => {
        await expect(
          client.colab.getRuntime({ runtime: runtimeId }),
        ).to.eventually.deep.equal(runtime);
      });

      it('sends client agent header', async () => {
        await client.colab.getRuntime({ runtime: runtimeId });

        sinon.assert.calledOnceWithMatch(
          fetchSpy,
          sinon.match.string,
          sinon.match((init: RequestInit) => {
            const headers = new Headers(init.headers);
            return (
              headers.get(COLAB_CLIENT_AGENT_HEADER.key) ===
              COLAB_CLIENT_AGENT_HEADER.value
            );
          }),
        );
      });

      it('sends authorization header', async () => {
        await client.colab.getRuntime({ runtime: runtimeId });

        sinon.assert.calledOnceWithMatch(
          fetchSpy,
          sinon.match.string,
          sinon.match((init: RequestInit) => {
            const headers = new Headers(init.headers);
            return (
              headers.get(AUTHORIZATION_HEADER.key) === `Bearer ${BEARER_TOKEN}`
            );
          }),
        );
      });

      it('does not send authorization header if token is empty', async () => {
        sessionStub.resolves('');

        await client.colab.getRuntime({ runtime: runtimeId });

        sinon.assert.calledOnceWithMatch(
          fetchSpy,
          sinon.match.string,
          sinon.match((init: RequestInit) => {
            const headers = new Headers(init.headers);
            return !headers.has(AUTHORIZATION_HEADER.key);
          }),
        );
      });

      it('logs to telemetry on fetch error', async () => {
        server.use(
          http.get(
            `https://${COLAB_API_HOST}/v1beta/runtimes/${runtimeId}`,
            () => HttpResponse.error(),
          ),
        );

        await expect(client.colab.getRuntime({ runtime: runtimeId })).to.be
          .rejected;

        sinon.assert.calledOnce(logErrorStub);
      });

      const tests = [
        { error: 'Bad Request', status: 400, onAuthErrorCalled: false },
        { error: 'Unauthorized', status: 401, onAuthErrorCalled: true },
        { error: 'Internal', status: 500, onAuthErrorCalled: false },
      ];
      tests.forEach(({ error, status, onAuthErrorCalled }) => {
        describe(`with status ${String(status)}`, () => {
          beforeEach(() => {
            server.use(
              http.get(
                `https://${COLAB_API_HOST}/v1beta/runtimes/${runtimeId}`,
                () => HttpResponse.json({ error }, { status }),
              ),
            );
          });

          it('throws an error and logs to telemetry', async () => {
            await expect(client.colab.getRuntime({ runtime: runtimeId })).to.be
              .rejected;

            sinon.assert.calledOnce(logErrorStub);
          });

          if (onAuthErrorCalled) {
            it('calls onAuthError', async () => {
              await expect(client.colab.getRuntime({ runtime: runtimeId })).to
                .be.rejected;

              sinon.assert.calledOnce(onAuthErrorStub);
            });
          } else {
            it('does not call onAuthError', async () => {
              await expect(client.colab.getRuntime({ runtime: runtimeId })).to
                .be.rejected;

              sinon.assert.notCalled(onAuthErrorStub);
            });
          }
        });
      });
    });

    describe('create', () => {
      const requestId = 'test-request-id';
      const runtimeSpec: Key = {
        variant: 'VARIANT_CPU',
        accelerator: 'NONE',
        shape: 'SHAPE_STANDARD',
      };
      const operation = {
        name: 'operations/1',
        done: false,
        metadata: {
          runtime: `runtimes/${runtimeId}`,
        },
      };

      beforeEach(() => {
        server.use(
          http.post(
            `https://${COLAB_API_HOST}/v1beta/runtimes`,
            async ({ request }) => {
              const queryParams = new URL(request.url).searchParams;
              expect(queryParams.get('runtimeId')).to.equal(runtimeId);
              expect(queryParams.get('requestId')).to.equal(requestId);
              await expect(request.json()).to.eventually.deep.equal({
                runtimeSpec,
              });
              return HttpResponse.json(operation, { status: 200 });
            },
          ),
        );
      });

      it('returns an operation', async () => {
        await expect(
          client.colab.createRuntime({
            runtime: { runtimeSpec },
            runtimeId,
            requestId,
          }),
        ).to.eventually.deep.equal({
          ...operation,
          error: undefined,
          response: undefined,
        });
      });

      it('sends client agent header', async () => {
        await client.colab.createRuntime({
          runtime: { runtimeSpec },
          runtimeId,
          requestId,
        });

        sinon.assert.calledOnceWithMatch(
          fetchSpy,
          sinon.match.string,
          sinon.match((init: RequestInit) => {
            const headers = new Headers(init.headers);
            return (
              headers.get(COLAB_CLIENT_AGENT_HEADER.key) ===
              COLAB_CLIENT_AGENT_HEADER.value
            );
          }),
        );
      });

      it('sends authorization header', async () => {
        await client.colab.createRuntime({
          runtime: { runtimeSpec },
          runtimeId,
          requestId,
        });

        sinon.assert.calledOnceWithMatch(
          fetchSpy,
          sinon.match.string,
          sinon.match((init: RequestInit) => {
            const headers = new Headers(init.headers);
            return (
              headers.get(AUTHORIZATION_HEADER.key) === `Bearer ${BEARER_TOKEN}`
            );
          }),
        );
      });

      it('does not send authorization header if token is empty', async () => {
        sessionStub.resolves('');

        await client.colab.createRuntime({
          runtime: { runtimeSpec },
          runtimeId,
          requestId,
        });

        sinon.assert.calledOnceWithMatch(
          fetchSpy,
          sinon.match.string,
          sinon.match((init: RequestInit) => {
            const headers = new Headers(init.headers);
            return !headers.has(AUTHORIZATION_HEADER.key);
          }),
        );
      });

      it('logs to telemetry on fetch error', async () => {
        server.use(
          http.post(`https://${COLAB_API_HOST}/v1beta/runtimes`, () =>
            HttpResponse.error(),
          ),
        );

        await expect(
          client.colab.createRuntime({
            runtime: { runtimeSpec },
            runtimeId,
            requestId,
          }),
        ).to.be.rejected;

        sinon.assert.calledOnce(logErrorStub);
      });

      const tests = [
        { error: 'Bad Request', status: 400, onAuthErrorCalled: false },
        { error: 'Unauthorized', status: 401, onAuthErrorCalled: true },
        { error: 'Internal', status: 500, onAuthErrorCalled: false },
      ];
      tests.forEach(({ error, status, onAuthErrorCalled }) => {
        describe(`with status ${String(status)}`, () => {
          beforeEach(() => {
            server.use(
              http.post(`https://${COLAB_API_HOST}/v1beta/runtimes`, () =>
                HttpResponse.json({ error }, { status }),
              ),
            );
          });

          it('throws an error and logs to telemetry', async () => {
            await expect(
              client.colab.createRuntime({
                runtime: { runtimeSpec },
                runtimeId,
                requestId,
              }),
            ).to.be.rejected;

            sinon.assert.calledOnce(logErrorStub);
          });

          if (onAuthErrorCalled) {
            it('calls onAuthError', async () => {
              await expect(
                client.colab.createRuntime({
                  runtime: { runtimeSpec },
                  runtimeId,
                  requestId,
                }),
              ).to.be.rejected;

              sinon.assert.calledOnce(onAuthErrorStub);
            });
          } else {
            it('does not call onAuthError', async () => {
              await expect(
                client.colab.createRuntime({
                  runtime: { runtimeSpec },
                  runtimeId,
                  requestId,
                }),
              ).to.be.rejected;

              sinon.assert.notCalled(onAuthErrorStub);
            });
          }
        });
      });
    });

    describe('delete', () => {
      beforeEach(() => {
        server.use(
          http.delete(
            `https://${COLAB_API_HOST}/v1beta/runtimes/${runtimeId}`,
            () => HttpResponse.json({}, { status: 200 }),
          ),
        );
      });

      it('executes successfully', async () => {
        await client.colab.deleteRuntime({ runtime: runtimeId });
      });

      it('sends client agent header', async () => {
        await client.colab.deleteRuntime({ runtime: runtimeId });

        sinon.assert.calledOnceWithMatch(
          fetchSpy,
          sinon.match.string,
          sinon.match((init: RequestInit) => {
            const headers = new Headers(init.headers);
            return (
              headers.get(COLAB_CLIENT_AGENT_HEADER.key) ===
              COLAB_CLIENT_AGENT_HEADER.value
            );
          }),
        );
      });

      it('sends authorization header', async () => {
        await client.colab.deleteRuntime({ runtime: runtimeId });

        sinon.assert.calledOnceWithMatch(
          fetchSpy,
          sinon.match.string,
          sinon.match((init: RequestInit) => {
            const headers = new Headers(init.headers);
            return (
              headers.get(AUTHORIZATION_HEADER.key) === `Bearer ${BEARER_TOKEN}`
            );
          }),
        );
      });

      it('does not send authorization header if token is empty', async () => {
        sessionStub.resolves('');

        await client.colab.deleteRuntime({ runtime: runtimeId });

        sinon.assert.calledOnceWithMatch(
          fetchSpy,
          sinon.match.string,
          sinon.match((init: RequestInit) => {
            const headers = new Headers(init.headers);
            return !headers.has(AUTHORIZATION_HEADER.key);
          }),
        );
      });

      it('logs to telemetry on fetch error', async () => {
        server.use(
          http.delete(
            `https://${COLAB_API_HOST}/v1beta/runtimes/${runtimeId}`,
            () => HttpResponse.error(),
          ),
        );

        await expect(client.colab.deleteRuntime({ runtime: runtimeId })).to.be
          .rejected;

        sinon.assert.calledOnce(logErrorStub);
      });

      const tests = [
        { error: 'Bad Request', status: 400, onAuthErrorCalled: false },
        { error: 'Unauthorized', status: 401, onAuthErrorCalled: true },
        { error: 'Internal', status: 500, onAuthErrorCalled: false },
      ];
      tests.forEach(({ error, status, onAuthErrorCalled }) => {
        describe(`with status ${String(status)}`, () => {
          beforeEach(() => {
            server.use(
              http.delete(
                `https://${COLAB_API_HOST}/v1beta/runtimes/${runtimeId}`,
                () => HttpResponse.json({ error }, { status }),
              ),
            );
          });

          it('throws an error and logs to telemetry', async () => {
            await expect(client.colab.deleteRuntime({ runtime: runtimeId })).to
              .be.rejected;

            sinon.assert.calledOnce(logErrorStub);
          });

          if (onAuthErrorCalled) {
            it('calls onAuthError', async () => {
              await expect(client.colab.deleteRuntime({ runtime: runtimeId }))
                .to.be.rejected;

              sinon.assert.calledOnce(onAuthErrorStub);
            });
          } else {
            it('does not call onAuthError', async () => {
              await expect(client.colab.deleteRuntime({ runtime: runtimeId }))
                .to.be.rejected;

              sinon.assert.notCalled(onAuthErrorStub);
            });
          }
        });
      });
    });
  });

  describe('operations', () => {
    const OPERATION_ID = 'test-operation-id';
    const operation = {
      name: `operations/${OPERATION_ID}`,
      done: true,
      metadata: {
        runtime: 'runtimes/r-1',
      },
      response: {
        name: 'runtimes/r-1',
        runtimeSpec: {
          variant: 'VARIANT_CPU',
          accelerator: 'NONE',
          shape: 'SHAPE_STANDARD',
        },
        connectionInfo: {
          url: 'test-url',
          token: 'test-token',
          expireTime: '2026-01-01T00:00:00Z',
        },
      },
    };

    describe('get', () => {
      beforeEach(() => {
        server.use(
          http.get(
            `https://${COLAB_API_HOST}/v1/operations/${OPERATION_ID}`,
            () => HttpResponse.json(operation, { status: 200 }),
          ),
        );
      });

      it('returns the operation', async () => {
        await expect(
          client.operations.getOperation({ operationsId: OPERATION_ID }),
        ).to.eventually.deep.equal({
          ...operation,
          error: undefined,
        });
      });

      it('sends client agent header', async () => {
        await client.operations.getOperation({ operationsId: OPERATION_ID });

        sinon.assert.calledOnceWithMatch(
          fetchSpy,
          sinon.match.string,
          sinon.match((init: RequestInit) => {
            const headers = new Headers(init.headers);
            return (
              headers.get(COLAB_CLIENT_AGENT_HEADER.key) ===
              COLAB_CLIENT_AGENT_HEADER.value
            );
          }),
        );
      });

      it('sends authorization header', async () => {
        await client.operations.getOperation({ operationsId: OPERATION_ID });

        sinon.assert.calledOnceWithMatch(
          fetchSpy,
          sinon.match.string,
          sinon.match((init: RequestInit) => {
            const headers = new Headers(init.headers);
            return (
              headers.get(AUTHORIZATION_HEADER.key) === `Bearer ${BEARER_TOKEN}`
            );
          }),
        );
      });

      it('does not send authorization header if token is empty', async () => {
        sessionStub.resolves('');

        await client.operations.getOperation({ operationsId: OPERATION_ID });

        sinon.assert.calledOnceWithMatch(
          fetchSpy,
          sinon.match.string,
          sinon.match((init: RequestInit) => {
            const headers = new Headers(init.headers);
            return !headers.has(AUTHORIZATION_HEADER.key);
          }),
        );
      });

      it('logs to telemetry on fetch error', async () => {
        server.use(
          http.get(
            `https://${COLAB_API_HOST}/v1/operations/${OPERATION_ID}`,
            () => HttpResponse.error(),
          ),
        );

        await expect(
          client.operations.getOperation({ operationsId: OPERATION_ID }),
        ).to.be.rejected;

        sinon.assert.calledOnce(logErrorStub);
      });

      const tests = [
        { error: 'Bad Request', status: 400, onAuthErrorCalled: false },
        { error: 'Unauthorized', status: 401, onAuthErrorCalled: true },
        { error: 'Internal', status: 500, onAuthErrorCalled: false },
      ];
      tests.forEach(({ error, status, onAuthErrorCalled }) => {
        describe(`with status ${String(status)}`, () => {
          beforeEach(() => {
            server.use(
              http.get(
                `https://${COLAB_API_HOST}/v1/operations/${OPERATION_ID}`,
                () => HttpResponse.json({ error }, { status }),
              ),
            );
          });

          it('throws an error and logs to telemetry', async () => {
            await expect(
              client.operations.getOperation({ operationsId: OPERATION_ID }),
            ).to.be.rejected;

            sinon.assert.calledOnce(logErrorStub);
          });

          if (onAuthErrorCalled) {
            it('calls onAuthError', async () => {
              await expect(
                client.operations.getOperation({ operationsId: OPERATION_ID }),
              ).to.be.rejected;

              sinon.assert.calledOnce(onAuthErrorStub);
            });
          } else {
            it('does not call onAuthError', async () => {
              await expect(
                client.operations.getOperation({ operationsId: OPERATION_ID }),
              ).to.be.rejected;

              sinon.assert.notCalled(onAuthErrorStub);
            });
          }
        });
      });
    });

    describe('wait', () => {
      const TIMEOUT = '120s';

      beforeEach(() => {
        server.use(
          http.get(
            `https://${COLAB_API_HOST}/v1/operations/${OPERATION_ID}:wait`,
            ({ request }) => {
              const queryParams = new URL(request.url).searchParams;
              expect(queryParams.get('timeout')).to.equal(TIMEOUT);
              return HttpResponse.json(operation, { status: 200 });
            },
          ),
        );
      });

      it('returns the operation', async () => {
        await expect(
          client.operations.waitOperation({
            operationsId: OPERATION_ID,
            timeout: TIMEOUT,
          }),
        ).to.eventually.deep.equal({
          ...operation,
          error: undefined,
        });
      });

      it('sends client agent header', async () => {
        await client.operations.waitOperation({
          operationsId: OPERATION_ID,
          timeout: TIMEOUT,
        });

        sinon.assert.calledOnceWithMatch(
          fetchSpy,
          sinon.match.string,
          sinon.match((init: RequestInit) => {
            const headers = new Headers(init.headers);
            return (
              headers.get(COLAB_CLIENT_AGENT_HEADER.key) ===
              COLAB_CLIENT_AGENT_HEADER.value
            );
          }),
        );
      });

      it('sends authorization header', async () => {
        await client.operations.waitOperation({
          operationsId: OPERATION_ID,
          timeout: TIMEOUT,
        });

        sinon.assert.calledOnceWithMatch(
          fetchSpy,
          sinon.match.string,
          sinon.match((init: RequestInit) => {
            const headers = new Headers(init.headers);
            return (
              headers.get(AUTHORIZATION_HEADER.key) === `Bearer ${BEARER_TOKEN}`
            );
          }),
        );
      });

      it('does not send authorization header if token is empty', async () => {
        sessionStub.resolves('');

        await client.operations.waitOperation({
          operationsId: OPERATION_ID,
          timeout: TIMEOUT,
        });

        sinon.assert.calledOnceWithMatch(
          fetchSpy,
          sinon.match.string,
          sinon.match((init: RequestInit) => {
            const headers = new Headers(init.headers);
            return !headers.has(AUTHORIZATION_HEADER.key);
          }),
        );
      });

      it('logs to telemetry on fetch error', async () => {
        server.use(
          http.get(
            `https://${COLAB_API_HOST}/v1/operations/${OPERATION_ID}:wait`,
            () => HttpResponse.error(),
          ),
        );

        await expect(
          client.operations.waitOperation({
            operationsId: OPERATION_ID,
            timeout: TIMEOUT,
          }),
        ).to.be.rejected;

        sinon.assert.calledOnce(logErrorStub);
      });

      const tests = [
        { error: 'Bad Request', status: 400, onAuthErrorCalled: false },
        { error: 'Unauthorized', status: 401, onAuthErrorCalled: true },
        { error: 'Internal', status: 500, onAuthErrorCalled: false },
      ];
      tests.forEach(({ error, status, onAuthErrorCalled }) => {
        describe(`with status ${String(status)}`, () => {
          beforeEach(() => {
            server.use(
              http.get(
                `https://${COLAB_API_HOST}/v1/operations/${OPERATION_ID}:wait`,
                () => HttpResponse.json({ error }, { status }),
              ),
            );
          });

          it('throws an error and logs to telemetry', async () => {
            await expect(
              client.operations.waitOperation({
                operationsId: OPERATION_ID,
                timeout: TIMEOUT,
              }),
            ).to.be.rejected;

            sinon.assert.calledOnce(logErrorStub);
          });

          if (onAuthErrorCalled) {
            it('calls onAuthError', async () => {
              await expect(
                client.operations.waitOperation({
                  operationsId: OPERATION_ID,
                  timeout: TIMEOUT,
                }),
              ).to.be.rejected;

              sinon.assert.calledOnce(onAuthErrorStub);
            });
          } else {
            it('does not call onAuthError', async () => {
              await expect(
                client.operations.waitOperation({
                  operationsId: OPERATION_ID,
                  timeout: TIMEOUT,
                }),
              ).to.be.rejected;

              sinon.assert.notCalled(onAuthErrorStub);
            });
          }
        });
      });
    });
  });
});

describe('normalizeSubscriptionTier', () => {
  const tests = [
    {
      input: SubscriptionTier.SubscriptionTierFree,
      expected: CommonSubscriptionTier.NONE,
    },
    {
      input: SubscriptionTier.SubscriptionTierPro,
      expected: CommonSubscriptionTier.PRO,
    },
    {
      input: SubscriptionTier.SubscriptionTierProPlus,
      expected: CommonSubscriptionTier.PRO_PLUS,
    },
  ];
  tests.forEach(({ input, expected }) => {
    it(`normalizes ${input}`, () => {
      expect(normalizeSubscriptionTier(input)).to.equal(expected);
    });
  });

  it('throws an error if unspecified', () => {
    expect(() =>
      normalizeSubscriptionTier(SubscriptionTier.SubscriptionTierUnspecified),
    ).to.throw(/Unknown subscription tier:/);
  });
});

describe('normalizeVariant', () => {
  const tests = [
    {
      input: Variant.VariantCpu,
      expected: CommonVariant.DEFAULT,
    },
    {
      input: Variant.VariantGpu,
      expected: CommonVariant.GPU,
    },
    {
      input: Variant.VariantTpu,
      expected: CommonVariant.TPU,
    },
  ];
  tests.forEach(({ input, expected }) => {
    it(`normalizes ${input}`, () => {
      expect(normalizeVariant(input)).to.equal(expected);
    });
  });

  it('throws an error if unspecified', () => {
    expect(() => normalizeVariant(Variant.VariantUnspecified)).to.throw(
      /Unknown variant:/,
    );
  });
});

describe('normalizeShape', () => {
  const tests = [
    {
      input: Shape.ShapeStandard,
      expected: CommonShape.STANDARD,
    },
    {
      input: Shape.ShapeHighmem,
      expected: CommonShape.HIGHMEM,
    },
  ];
  tests.forEach(({ input, expected }) => {
    it(`normalizes ${input}`, () => {
      expect(normalizeShape(input)).to.equal(expected);
    });
  });

  it('throws an error if unspecified', () => {
    expect(() => normalizeShape(Shape.ShapeUnspecified)).to.throw(
      /Unknown shape:/,
    );
  });
});

describe('denormalizeVariant', () => {
  const tests = [
    {
      input: CommonVariant.DEFAULT,
      expected: Variant.VariantCpu,
    },
    {
      input: CommonVariant.GPU,
      expected: Variant.VariantGpu,
    },
    {
      input: CommonVariant.TPU,
      expected: Variant.VariantTpu,
    },
  ];
  tests.forEach(({ input, expected }) => {
    it(`returns ${expected} from ${input}`, () => {
      expect(denormalizeVariant(input)).to.equal(expected);
    });
  });
});

describe('denormalizeShape', () => {
  const tests = [
    {
      name: 'undefined value',
      input: undefined,
      expected: Shape.ShapeStandard,
    },
    {
      name: 'STANDARD',
      input: CommonShape.STANDARD,
      expected: Shape.ShapeStandard,
    },
    {
      name: 'HIGHMEM',
      input: CommonShape.HIGHMEM,
      expected: Shape.ShapeHighmem,
    },
  ];
  tests.forEach(({ name, input, expected }) => {
    it(`returns ${expected} from ${name}`, () => {
      expect(denormalizeShape(input)).to.equal(expected);
    });
  });
});

describe('throwIfOperationError', () => {
  const OPERATION_NAME = 'operations/test-operation-id';
  const ERROR_CODE = 9;
  const ERROR_MESSAGE = 'test error message';

  it('does nothing if operation does not contain an error', () => {
    const nonErrorOperation: Operation = {
      name: OPERATION_NAME,
      done: true,
      response: {
        name: 'runtimes/1',
      },
    };

    throwIfOperationError(nonErrorOperation);

    // No error is thrown. We are good!
  });

  it('throws TooManyAssignmentsError if TOO_MANY_ACTIVE_RUNTIMES', () => {
    const errorOperation: Operation = {
      name: OPERATION_NAME,
      done: true,
      error: {
        code: ERROR_CODE,
        message: ERROR_MESSAGE,
        details: [
          // Intentionally add an unrelated detail here to ensure that it will
          // be ignored
          { unrelatedKey: 'unrelated value' },
          // This will be identified as the ErrorInfo containing the reason
          { reason: 'TOO_MANY_ACTIVE_RUNTIMES' },
        ],
      },
    };

    expect(() => {
      throwIfOperationError(errorOperation);
    }).to.throw(TooManyAssignmentsError, ERROR_MESSAGE);
  });

  it('throws DenylistedError if DENYLISTED', () => {
    const errorOperation: Operation = {
      name: OPERATION_NAME,
      done: true,
      error: {
        code: ERROR_CODE,
        message: ERROR_MESSAGE,
        details: [
          // Intentionally add an unrelated detail here to ensure that it will
          // be ignored
          { unrelatedKey: 'unrelated value' },
          // This will be identified as the ErrorInfo containing the reason
          { reason: 'DENYLISTED' },
        ],
      },
    };

    expect(() => {
      throwIfOperationError(errorOperation);
    }).to.throw(DenylistedError, /This account has been blocked/);
  });

  it('throws InsufficientQuotaError if QUOTA_EXCEEDED_USAGE_TIME', () => {
    const errorOperation: Operation = {
      name: OPERATION_NAME,
      done: true,
      error: {
        code: ERROR_CODE,
        message: ERROR_MESSAGE,
        details: [
          // Intentionally add an unrelated detail here to ensure that it will
          // be ignored
          { unrelatedKey: 'unrelated value' },
          // This will be identified as the ErrorInfo containing the reason
          { reason: 'QUOTA_EXCEEDED_USAGE_TIME' },
        ],
      },
    };

    expect(() => {
      throwIfOperationError(errorOperation);
    }).to.throw(
      InsufficientQuotaError,
      'You have insufficient quota to assign this server.',
    );
  });

  it('throws AcceleratorUnavailableError if any other reason with accelerator', () => {
    const errorOperation: Operation = {
      name: OPERATION_NAME,
      done: true,
      error: {
        code: ERROR_CODE,
        message: ERROR_MESSAGE,
        details: [
          // Intentionally add an unrelated detail here to ensure that it will
          // be ignored
          { unrelatedKey: 'unrelated value' },
          // This will be identified as the ErrorInfo containing the reason
          { reason: 'ANY_RANDOM_REASON' },
        ],
      },
    };

    expect(() => {
      throwIfOperationError(errorOperation, 'T4');
    }).to.throw(AcceleratorUnavailableError, /T4/);
  });

  const accelerators = [undefined, 'NONE'];
  accelerators.forEach((accelerator) => {
    it(`throws LongRunningOperationError if any other reason with ${accelerator ?? 'no'} accelerator`, () => {
      const errorOperation: Operation = {
        name: OPERATION_NAME,
        done: true,
        error: {
          code: ERROR_CODE,
          message: ERROR_MESSAGE,
          details: [
            // Intentionally add an unrelated detail here to ensure that it will
            // be ignored
            { unrelatedKey: 'unrelated value' },
            // This will be identified as the ErrorInfo containing the reason
            { reason: 'ANY_RANDOM_REASON' },
          ],
        },
      };

      expect(() => {
        throwIfOperationError(errorOperation, accelerator);
      }).to.throw(
        LongRunningOperationError,
        `Operation ${OPERATION_NAME} failed with error ${String(ERROR_CODE)}: ${ERROR_MESSAGE} (reason: ANY_RANDOM_REASON)`,
      );
    });
  });
});
