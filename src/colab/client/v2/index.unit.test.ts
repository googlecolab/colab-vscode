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
import { AUTHORIZATION_HEADER, COLAB_CLIENT_AGENT_HEADER } from '../../headers';
import { FetchAPI, Key } from './generated/colab';
import { ColabApiClient } from '.';

const COLAB_API_HOST = 'colab.example.com';
const BEARER_TOKEN = 'test-access-token';

const server = setupServer();

describe('ColabApiClient', () => {
  let client: ColabApiClient;
  let sessionStub: sinon.SinonStub<[], Promise<string>>;
  let onAuthErrorStub: sinon.SinonStub<[], Promise<void>>;
  let logErrorStub: SinonStubbedFunction<typeof telemetry.logError>;

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
    client = new ColabApiClient(
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

  describe('middleware', () => {
    let fetchStub: sinon.SinonStubbedFunction<FetchAPI>;

    beforeEach(() => {
      fetchStub = sinon.stub();
      fetchStub.resolves(new Response(JSON.stringify({}), { status: 200 }));
      client = new ColabApiClient(
        `https://${COLAB_API_HOST}`,
        () => sessionStub(),
        onAuthErrorStub,
        fetchStub,
      );
    });

    it('sends client agent header', async () => {
      await client.subscription.get();

      sinon.assert.calledOnceWithMatch(
        fetchStub,
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
      await client.subscription.get();

      sinon.assert.calledOnceWithMatch(
        fetchStub,
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

      await client.subscription.get();

      sinon.assert.calledOnceWithMatch(
        fetchStub,
        sinon.match.string,
        sinon.match((init: RequestInit) => {
          const headers = new Headers(init.headers);
          return !headers.has(AUTHORIZATION_HEADER.key);
        }),
      );
    });

    it('logs to telemetry on fetch error', async () => {
      fetchStub.rejects();

      await expect(client.subscription.get()).to.be.rejected;

      sinon.assert.calledOnce(logErrorStub);
    });
  });

  describe('subscription', () => {
    const subscription = {
      name: 'subscription',
      tier: 'SUBSCRIPTION_TIER_FREE',
    };

    describe('get', () => {
      beforeEach(() => {
        server.use(
          http.get(`https://${COLAB_API_HOST}/v1beta/subscription`, () =>
            HttpResponse.json(subscription, { status: 200 }),
          ),
        );
      });

      it('returns the subscription', async () => {
        await expect(client.subscription.get()).to.eventually.deep.equal(
          subscription,
        );
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
            await expect(client.subscription.get()).to.be.rejected;

            sinon.assert.calledOnce(logErrorStub);
          });

          if (onAuthErrorCalled) {
            it('calls onAuthError', async () => {
              await expect(client.subscription.get()).to.be.rejected;

              sinon.assert.calledOnce(onAuthErrorStub);
            });
          } else {
            it('does not call onAuthError', async () => {
              await expect(client.subscription.get()).to.be.rejected;

              sinon.assert.notCalled(onAuthErrorStub);
            });
          }
        });
      });
    });
  });

  describe('runtimeSpecs', () => {
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

    describe('list', () => {
      beforeEach(() => {
        server.use(
          http.get(`https://${COLAB_API_HOST}/v1beta/runtimespecs`, () =>
            HttpResponse.json({ runtimeSpecs }, { status: 200 }),
          ),
        );
      });

      it('returns a list of runtime specs', async () => {
        await expect(client.runtimeSpecs.list()).to.eventually.deep.equal(
          runtimeSpecs,
        );
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
            await expect(client.runtimeSpecs.list()).to.be.rejected;

            sinon.assert.calledOnce(logErrorStub);
          });

          if (onAuthErrorCalled) {
            it('calls onAuthError', async () => {
              await expect(client.runtimeSpecs.list()).to.be.rejected;

              sinon.assert.calledOnce(onAuthErrorStub);
            });
          } else {
            it('does not call onAuthError', async () => {
              await expect(client.runtimeSpecs.list()).to.be.rejected;

              sinon.assert.notCalled(onAuthErrorStub);
            });
          }
        });
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
        await expect(client.runtimes.list()).to.eventually.deep.equal(runtimes);
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
            await expect(client.runtimes.list()).to.be.rejected;

            sinon.assert.calledOnce(logErrorStub);
          });

          if (onAuthErrorCalled) {
            it('calls onAuthError', async () => {
              await expect(client.runtimes.list()).to.be.rejected;

              sinon.assert.calledOnce(onAuthErrorStub);
            });
          } else {
            it('does not call onAuthError', async () => {
              await expect(client.runtimes.list()).to.be.rejected;

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
        await expect(client.runtimes.get(runtimeId)).to.eventually.deep.equal(
          runtime,
        );
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
            await expect(client.runtimes.get(runtimeId)).to.be.rejected;

            sinon.assert.calledOnce(logErrorStub);
          });

          if (onAuthErrorCalled) {
            it('calls onAuthError', async () => {
              await expect(client.runtimes.get(runtimeId)).to.be.rejected;

              sinon.assert.calledOnce(onAuthErrorStub);
            });
          } else {
            it('does not call onAuthError', async () => {
              await expect(client.runtimes.get(runtimeId)).to.be.rejected;

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
          client.runtimes.create(runtimeSpec, runtimeId, requestId),
        ).to.eventually.deep.equal({
          ...operation,
          error: undefined,
          response: undefined,
        });
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
              client.runtimes.create(runtimeSpec, runtimeId, requestId),
            ).to.be.rejected;

            sinon.assert.calledOnce(logErrorStub);
          });

          if (onAuthErrorCalled) {
            it('calls onAuthError', async () => {
              await expect(
                client.runtimes.create(runtimeSpec, runtimeId, requestId),
              ).to.be.rejected;

              sinon.assert.calledOnce(onAuthErrorStub);
            });
          } else {
            it('does not call onAuthError', async () => {
              await expect(
                client.runtimes.create(runtimeSpec, runtimeId, requestId),
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
        await client.runtimes.delete(runtimeId);
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
            await expect(client.runtimes.delete(runtimeId)).to.be.rejected;

            sinon.assert.calledOnce(logErrorStub);
          });

          if (onAuthErrorCalled) {
            it('calls onAuthError', async () => {
              await expect(client.runtimes.delete(runtimeId)).to.be.rejected;

              sinon.assert.calledOnce(onAuthErrorStub);
            });
          } else {
            it('does not call onAuthError', async () => {
              await expect(client.runtimes.delete(runtimeId)).to.be.rejected;

              sinon.assert.notCalled(onAuthErrorStub);
            });
          }
        });
      });
    });
  });

  describe('operations', () => {
    const operationId = 'test-operation-id';
    const operation = {
      name: `operations/${operationId}`,
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
            `https://${COLAB_API_HOST}/v1/operations/${operationId}`,
            () => HttpResponse.json(operation, { status: 200 }),
          ),
        );
      });

      it('returns the operation', async () => {
        await expect(
          client.operations.get(operationId),
        ).to.eventually.deep.equal({
          ...operation,
          error: undefined,
        });
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
                `https://${COLAB_API_HOST}/v1/operations/${operationId}`,
                () => HttpResponse.json({ error }, { status }),
              ),
            );
          });

          it('throws an error and logs to telemetry', async () => {
            await expect(client.operations.get(operationId)).to.be.rejected;

            sinon.assert.calledOnce(logErrorStub);
          });

          if (onAuthErrorCalled) {
            it('calls onAuthError', async () => {
              await expect(client.operations.get(operationId)).to.be.rejected;

              sinon.assert.calledOnce(onAuthErrorStub);
            });
          } else {
            it('does not call onAuthError', async () => {
              await expect(client.operations.get(operationId)).to.be.rejected;

              sinon.assert.notCalled(onAuthErrorStub);
            });
          }
        });
      });
    });
  });
});
