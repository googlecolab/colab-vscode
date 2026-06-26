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
import { telemetry } from '../../telemetry';
import { ColabRequestError } from '../errors';
import { AUTHORIZATION_HEADER, COLAB_CLIENT_AGENT_HEADER } from '../headers';
import type { components as colabComponents } from './generated/schema-v1beta';
import { ColabApiClient } from '.';

const COLAB_API_HOST = 'colaboratory.example.com';
const BEARER_TOKEN = 'test-access-token';

const server = setupServer();

describe('ColabApiClient', () => {
  let client: ColabApiClient;
  let sessionStub: sinon.SinonStub<[], Promise<string>>;
  let onAuthErrorStub: sinon.SinonStub<[], Promise<void>>;
  let fetchSpy: sinon.SinonSpy<
    Parameters<typeof globalThis.fetch>,
    ReturnType<typeof globalThis.fetch>
  >;
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
    fetchSpy = sinon.spy(globalThis, 'fetch');
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
      await expect(client.getSubscription()).to.eventually.deep.equal(
        subscription,
      );
    });

    it('sends client agent header', async () => {
      await client.getSubscription();

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match(
          (req: Request) =>
            req.headers.get(COLAB_CLIENT_AGENT_HEADER.key) ===
            COLAB_CLIENT_AGENT_HEADER.value,
        ),
      );
    });

    it('sends authorization header', async () => {
      await client.getSubscription();

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match(
          (req: Request) =>
            req.headers.get(AUTHORIZATION_HEADER.key) ===
            `Bearer ${BEARER_TOKEN}`,
        ),
      );
    });

    it('does not send authorization header if token is empty', async () => {
      sessionStub.resolves('');

      await client.getSubscription();

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match(
          (req: Request) => !req.headers.has(AUTHORIZATION_HEADER.key),
        ),
      );
    });

    it('logs fetch TypeError to telemetry', async () => {
      server.use(
        http.get(`https://${COLAB_API_HOST}/v1beta/subscription`, () =>
          HttpResponse.error(),
        ),
      );

      await expect(client.getSubscription()).to.be.rejectedWith(TypeError);

      sinon.assert.calledOnceWithMatch(
        logErrorStub,
        sinon.match.instanceOf(TypeError),
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

        it('throws ColabRequestError and logs to telemetry', async () => {
          await expect(client.getSubscription()).to.be.rejectedWith(
            ColabRequestError,
          );

          sinon.assert.calledOnceWithMatch(
            logErrorStub,
            sinon.match.instanceOf(ColabRequestError),
          );
        });

        if (onAuthErrorCalled) {
          it('calls onAuthError', async () => {
            await expect(client.getSubscription()).to.be.rejected;

            sinon.assert.calledOnce(onAuthErrorStub);
          });
        } else {
          it('does not call onAuthError', async () => {
            await expect(client.getSubscription()).to.be.rejected;

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
          HttpResponse.json(runtimeSpecs, { status: 200 }),
        ),
      );
    });

    it('returns a list of runtime specs', async () => {
      await expect(client.listRuntimeSpecs()).to.eventually.deep.equal(
        runtimeSpecs,
      );
    });

    it('sends client agent header', async () => {
      await client.listRuntimeSpecs();

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match(
          (req: Request) =>
            req.headers.get(COLAB_CLIENT_AGENT_HEADER.key) ===
            COLAB_CLIENT_AGENT_HEADER.value,
        ),
      );
    });

    it('sends authorization header', async () => {
      await client.listRuntimeSpecs();

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match(
          (req: Request) =>
            req.headers.get(AUTHORIZATION_HEADER.key) ===
            `Bearer ${BEARER_TOKEN}`,
        ),
      );
    });

    it('does not send authorization header if token is empty', async () => {
      sessionStub.resolves('');

      await client.listRuntimeSpecs();

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match(
          (req: Request) => !req.headers.has(AUTHORIZATION_HEADER.key),
        ),
      );
    });

    it('logs fetch TypeError to telemetry', async () => {
      server.use(
        http.get(`https://${COLAB_API_HOST}/v1beta/runtimespecs`, () =>
          HttpResponse.error(),
        ),
      );

      await expect(client.listRuntimeSpecs()).to.be.rejectedWith(TypeError);

      sinon.assert.calledOnceWithMatch(
        logErrorStub,
        sinon.match.instanceOf(TypeError),
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

        it('throws ColabRequestError and logs to telemetry', async () => {
          await expect(client.listRuntimeSpecs()).to.be.rejectedWith(
            ColabRequestError,
          );

          sinon.assert.calledOnceWithMatch(
            logErrorStub,
            sinon.match.instanceOf(ColabRequestError),
          );
        });

        if (onAuthErrorCalled) {
          it('calls onAuthError', async () => {
            await expect(client.listRuntimeSpecs()).to.be.rejected;

            sinon.assert.calledOnce(onAuthErrorStub);
          });
        } else {
          it('does not call onAuthError', async () => {
            await expect(client.listRuntimeSpecs()).to.be.rejected;

            sinon.assert.notCalled(onAuthErrorStub);
          });
        }
      });
    });
  });

  describe('listRuntimes', () => {
    const runtimes = [
      {
        name: 'runtimes/r-1',
        runtimeSpec: {
          variant: 'VARIANT_CPU',
          accelerator: 'NONE',
          shape: 'SHAPE_STANDARD',
        },
      },
      {
        name: 'runtimes/r-2',
        runtimeSpec: {
          variant: 'VARIANT_GPU',
          accelerator: 'T4',
          shape: 'SHAPE_STANDARD',
        },
      },
      {
        name: 'runtimes/r-3',
        runtimeSpec: {
          variant: 'VARIANT_TPU',
          accelerator: 'V6E1',
          shape: 'SHAPE_HIGHMEM',
        },
      },
    ];

    beforeEach(() => {
      server.use(
        http.get(`https://${COLAB_API_HOST}/v1beta/runtimes`, () =>
          HttpResponse.json(runtimes, { status: 200 }),
        ),
      );
    });

    it('returns a list of runtimes', async () => {
      await expect(client.listRuntimes()).to.eventually.deep.equal(runtimes);
    });

    it('sends client agent header', async () => {
      await client.listRuntimes();

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match(
          (req: Request) =>
            req.headers.get(COLAB_CLIENT_AGENT_HEADER.key) ===
            COLAB_CLIENT_AGENT_HEADER.value,
        ),
      );
    });

    it('sends authorization header', async () => {
      await client.listRuntimes();

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match(
          (req: Request) =>
            req.headers.get(AUTHORIZATION_HEADER.key) ===
            `Bearer ${BEARER_TOKEN}`,
        ),
      );
    });

    it('does not send authorization header if token is empty', async () => {
      sessionStub.resolves('');

      await client.listRuntimes();

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match(
          (req: Request) => !req.headers.has(AUTHORIZATION_HEADER.key),
        ),
      );
    });

    it('logs fetch TypeError to telemetry', async () => {
      server.use(
        http.get(`https://${COLAB_API_HOST}/v1beta/runtimes`, () =>
          HttpResponse.error(),
        ),
      );

      await expect(client.listRuntimes()).to.be.rejectedWith(TypeError);

      sinon.assert.calledOnceWithMatch(
        logErrorStub,
        sinon.match.instanceOf(TypeError),
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
            http.get(`https://${COLAB_API_HOST}/v1beta/runtimes`, () =>
              HttpResponse.json({ error }, { status }),
            ),
          );
        });

        it('throws ColabRequestError and logs to telemetry', async () => {
          await expect(client.listRuntimes()).to.be.rejectedWith(
            ColabRequestError,
          );

          sinon.assert.calledOnceWithMatch(
            logErrorStub,
            sinon.match.instanceOf(ColabRequestError),
          );
        });

        if (onAuthErrorCalled) {
          it('calls onAuthError', async () => {
            await expect(client.listRuntimes()).to.be.rejected;

            sinon.assert.calledOnce(onAuthErrorStub);
          });
        } else {
          it('does not call onAuthError', async () => {
            await expect(client.listRuntimes()).to.be.rejected;

            sinon.assert.notCalled(onAuthErrorStub);
          });
        }
      });
    });
  });

  describe('getRuntime', () => {
    const runtimeId = 'r-1';
    const runtime = {
      name: `runtimes/${runtimeId}`,
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
    };

    beforeEach(() => {
      server.use(
        http.get(`https://${COLAB_API_HOST}/v1beta/runtimes/${runtimeId}`, () =>
          HttpResponse.json(runtime, { status: 200 }),
        ),
      );
    });

    it('returns the runtime', async () => {
      await expect(client.getRuntime(runtimeId)).to.eventually.deep.equal(
        runtime,
      );
    });

    it('sends client agent header', async () => {
      await client.getRuntime(runtimeId);

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match(
          (req: Request) =>
            req.headers.get(COLAB_CLIENT_AGENT_HEADER.key) ===
            COLAB_CLIENT_AGENT_HEADER.value,
        ),
      );
    });

    it('sends authorization header', async () => {
      await client.getRuntime(runtimeId);

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match(
          (req: Request) =>
            req.headers.get(AUTHORIZATION_HEADER.key) ===
            `Bearer ${BEARER_TOKEN}`,
        ),
      );
    });

    it('does not send authorization header if token is empty', async () => {
      sessionStub.resolves('');

      await client.getRuntime(runtimeId);

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match(
          (req: Request) => !req.headers.has(AUTHORIZATION_HEADER.key),
        ),
      );
    });

    it('logs fetch TypeError to telemetry', async () => {
      server.use(
        http.get(`https://${COLAB_API_HOST}/v1beta/runtimes/${runtimeId}`, () =>
          HttpResponse.error(),
        ),
      );

      await expect(client.getRuntime(runtimeId)).to.be.rejectedWith(TypeError);

      sinon.assert.calledOnceWithMatch(
        logErrorStub,
        sinon.match.instanceOf(TypeError),
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

        it('throws ColabRequestError and logs to telemetry', async () => {
          await expect(client.getRuntime(runtimeId)).to.be.rejectedWith(
            ColabRequestError,
          );

          sinon.assert.calledOnceWithMatch(
            logErrorStub,
            sinon.match.instanceOf(ColabRequestError),
          );
        });

        if (onAuthErrorCalled) {
          it('calls onAuthError', async () => {
            await expect(client.getRuntime(runtimeId)).to.be.rejected;

            sinon.assert.calledOnce(onAuthErrorStub);
          });
        } else {
          it('does not call onAuthError', async () => {
            await expect(client.getRuntime(runtimeId)).to.be.rejected;

            sinon.assert.notCalled(onAuthErrorStub);
          });
        }
      });
    });
  });

  describe('createRuntime', () => {
    const runtimeId = 'test-runtime-id';
    const requestId = 'test-request-id';
    const runtimeSpec = {
      variant: 'VARIANT_CPU',
      accelerator: 'NONE',
      shape: 'SHAPE_STANDARD',
    } as colabComponents['schemas']['Key'];
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
            return HttpResponse.json(operation, { status: 201 });
          },
        ),
      );
    });

    it('returns an operation', async () => {
      await expect(
        client.createRuntime(runtimeSpec, runtimeId, requestId),
      ).to.eventually.deep.equal(operation);
    });

    it('sends client agent header', async () => {
      await client.createRuntime(runtimeSpec, runtimeId, requestId);

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match(
          (req: Request) =>
            req.headers.get(COLAB_CLIENT_AGENT_HEADER.key) ===
            COLAB_CLIENT_AGENT_HEADER.value,
        ),
      );
    });

    it('sends authorization header', async () => {
      await client.createRuntime(runtimeSpec, runtimeId, requestId);

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match(
          (req: Request) =>
            req.headers.get(AUTHORIZATION_HEADER.key) ===
            `Bearer ${BEARER_TOKEN}`,
        ),
      );
    });

    it('does not send authorization header if token is empty', async () => {
      sessionStub.resolves('');

      await client.createRuntime(runtimeSpec, runtimeId, requestId);

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match(
          (req: Request) => !req.headers.has(AUTHORIZATION_HEADER.key),
        ),
      );
    });

    it('logs fetch TypeError to telemetry', async () => {
      server.use(
        http.post(`https://${COLAB_API_HOST}/v1beta/runtimes`, () =>
          HttpResponse.error(),
        ),
      );

      await expect(
        client.createRuntime(runtimeSpec, runtimeId, requestId),
      ).to.be.rejectedWith(TypeError);

      sinon.assert.calledOnceWithMatch(
        logErrorStub,
        sinon.match.instanceOf(TypeError),
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
            http.post(`https://${COLAB_API_HOST}/v1beta/runtimes`, () =>
              HttpResponse.json({ error }, { status }),
            ),
          );
        });

        it('throws ColabRequestError and logs to telemetry', async () => {
          await expect(
            client.createRuntime(runtimeSpec, runtimeId, requestId),
          ).to.be.rejectedWith(ColabRequestError);

          sinon.assert.calledOnceWithMatch(
            logErrorStub,
            sinon.match.instanceOf(ColabRequestError),
          );
        });

        if (onAuthErrorCalled) {
          it('calls onAuthError', async () => {
            await expect(
              client.createRuntime(runtimeSpec, runtimeId, requestId),
            ).to.be.rejected;

            sinon.assert.calledOnce(onAuthErrorStub);
          });
        } else {
          it('does not call onAuthError', async () => {
            await expect(
              client.createRuntime(runtimeSpec, runtimeId, requestId),
            ).to.be.rejected;

            sinon.assert.notCalled(onAuthErrorStub);
          });
        }
      });
    });
  });

  describe('deleteRuntime', () => {
    const runtimeId = 'r-1';

    beforeEach(() => {
      server.use(
        http.delete(
          `https://${COLAB_API_HOST}/v1beta/runtimes/${runtimeId}`,
          () => HttpResponse.json({}, { status: 204 }),
        ),
      );
    });

    it('executes successfully', async () => {
      await client.deleteRuntime(runtimeId);
    });

    it('sends client agent header', async () => {
      await client.deleteRuntime(runtimeId);

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match(
          (req: Request) =>
            req.headers.get(COLAB_CLIENT_AGENT_HEADER.key) ===
            COLAB_CLIENT_AGENT_HEADER.value,
        ),
      );
    });

    it('sends authorization header', async () => {
      await client.deleteRuntime(runtimeId);

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match(
          (req: Request) =>
            req.headers.get(AUTHORIZATION_HEADER.key) ===
            `Bearer ${BEARER_TOKEN}`,
        ),
      );
    });

    it('does not send authorization header if token is empty', async () => {
      sessionStub.resolves('');

      await client.deleteRuntime(runtimeId);

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match(
          (req: Request) => !req.headers.has(AUTHORIZATION_HEADER.key),
        ),
      );
    });

    it('logs fetch TypeError to telemetry', async () => {
      server.use(
        http.delete(
          `https://${COLAB_API_HOST}/v1beta/runtimes/${runtimeId}`,
          () => HttpResponse.error(),
        ),
      );

      await expect(client.deleteRuntime(runtimeId)).to.be.rejectedWith(
        TypeError,
      );

      sinon.assert.calledOnceWithMatch(
        logErrorStub,
        sinon.match.instanceOf(TypeError),
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
            http.delete(
              `https://${COLAB_API_HOST}/v1beta/runtimes/${runtimeId}`,
              () => HttpResponse.json({ error }, { status }),
            ),
          );
        });

        it('throws ColabRequestError and logs to telemetry', async () => {
          await expect(client.deleteRuntime(runtimeId)).to.be.rejectedWith(
            ColabRequestError,
          );

          sinon.assert.calledOnceWithMatch(
            logErrorStub,
            sinon.match.instanceOf(ColabRequestError),
          );
        });

        if (onAuthErrorCalled) {
          it('calls onAuthError', async () => {
            await expect(client.deleteRuntime(runtimeId)).to.be.rejected;

            sinon.assert.calledOnce(onAuthErrorStub);
          });
        } else {
          it('does not call onAuthError', async () => {
            await expect(client.deleteRuntime(runtimeId)).to.be.rejected;

            sinon.assert.notCalled(onAuthErrorStub);
          });
        }
      });
    });
  });

  describe('getOperation', () => {
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

    beforeEach(() => {
      server.use(
        http.get(`https://${COLAB_API_HOST}/v1/operations/${operationId}`, () =>
          HttpResponse.json(operation, { status: 200 }),
        ),
      );
    });

    it('returns the operation', async () => {
      await expect(client.getOperation(operationId)).to.eventually.deep.equal(
        operation,
      );
    });

    it('sends client agent header', async () => {
      await client.getOperation(operationId);

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match(
          (req: Request) =>
            req.headers.get(COLAB_CLIENT_AGENT_HEADER.key) ===
            COLAB_CLIENT_AGENT_HEADER.value,
        ),
      );
    });

    it('sends authorization header', async () => {
      await client.getOperation(operationId);

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match(
          (req: Request) =>
            req.headers.get(AUTHORIZATION_HEADER.key) ===
            `Bearer ${BEARER_TOKEN}`,
        ),
      );
    });

    it('does not send authorization header if token is empty', async () => {
      sessionStub.resolves('');

      await client.getOperation(operationId);

      sinon.assert.calledOnceWithMatch(
        fetchSpy,
        sinon.match(
          (req: Request) => !req.headers.has(AUTHORIZATION_HEADER.key),
        ),
      );
    });

    it('logs fetch TypeError to telemetry', async () => {
      server.use(
        http.get(`https://${COLAB_API_HOST}/v1/operations/${operationId}`, () =>
          HttpResponse.error(),
        ),
      );

      await expect(client.getOperation(operationId)).to.be.rejectedWith(
        TypeError,
      );

      sinon.assert.calledOnceWithMatch(
        logErrorStub,
        sinon.match.instanceOf(TypeError),
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
              `https://${COLAB_API_HOST}/v1/operations/${operationId}`,
              () => HttpResponse.json({ error }, { status }),
            ),
          );
        });

        it('throws ColabRequestError and logs to telemetry', async () => {
          await expect(client.getOperation(operationId)).to.be.rejectedWith(
            ColabRequestError,
          );

          sinon.assert.calledOnceWithMatch(
            logErrorStub,
            sinon.match.instanceOf(ColabRequestError),
          );
        });

        if (onAuthErrorCalled) {
          it('calls onAuthError', async () => {
            await expect(client.getOperation(operationId)).to.be.rejected;

            sinon.assert.calledOnce(onAuthErrorStub);
          });
        } else {
          it('does not call onAuthError', async () => {
            await expect(client.getOperation(operationId)).to.be.rejected;

            sinon.assert.notCalled(onAuthErrorStub);
          });
        }
      });
    });
  });
});
