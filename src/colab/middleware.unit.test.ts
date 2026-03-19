/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect } from 'chai';
import { Request, Response } from 'node-fetch';
import * as sinon from 'sinon';
import { ColabRequestError } from './errors';
import {
  FetchMiddleware,
  buildFetchChain,
  createXSSIMiddleware,
  createAcceptJsonMiddleware,
  createAuthMiddleware,
  createErrorMiddleware,
} from './middleware';

describe('buildFetchChain', () => {
  it('simply calls fetch with no middleware', async () => {
    const baseFetch = sinon.stub().resolves(new Response('ok'));

    const composed = buildFetchChain([], baseFetch);
    const req = new Request('https://example.com');
    await composed(req);

    sinon.assert.calledOnce(baseFetch);
  });

  it('invokes a single middleware', async () => {
    const middleware = sinon
      .stub()
      .callsFake((req: Request, next: (req: Request) => Promise<Response>) => {
        return next(req);
      });
    const baseFetch = sinon.stub().resolves(new Response('ok'));

    const composed = buildFetchChain([middleware], baseFetch);
    const req = new Request('https://example.com');
    await composed(req);

    sinon.assert.calledOnce(middleware);
    sinon.assert.calledOnce(baseFetch);
  });

  it('chains middleware in the provided order', async () => {
    let x = 1;
    const middleware1: FetchMiddleware = async (req, next) => {
      req.headers.set('X-Test-1', x.toString());
      x++;
      return next(req);
    };
    const middleware2: FetchMiddleware = async (req, next) => {
      req.headers.set('X-Test-2', x.toString());
      x++;
      return next(req);
    };
    const baseFetch = sinon.stub().resolves(new Response('ok'));

    const composed = buildFetchChain([middleware1, middleware2], baseFetch);
    const req = new Request('https://example.com');
    await composed(req);

    sinon.assert.calledOnce(baseFetch);
    const finalReq = baseFetch.firstCall.args[0] as Request;
    expect(finalReq.headers.get('X-Test-1')).to.equal('1');
    expect(finalReq.headers.get('X-Test-2')).to.equal('2');
  });
});

describe('XSSIMiddleware', () => {
  it('strips XSSI prefix from response body', async () => {
    const baseFetch = sinon.stub().resolves(new Response(')]}\'\n{"ok":true}'));
    const fetch = buildFetchChain([createXSSIMiddleware()], baseFetch);
    const res = await fetch(new Request('https://example.com'));
    const body = await res.text();
    expect(body).to.equal('{"ok":true}');
  });

  it('leaves response untouched if no prefix', async () => {
    const baseFetch = sinon.stub().resolves(new Response('{"ok":true}'));
    const fetch = buildFetchChain([createXSSIMiddleware()], baseFetch);
    const res = await fetch(new Request('https://example.com'));
    const body = await res.text();
    expect(body).to.equal('{"ok":true}');
  });
});

describe('AcceptJsonMiddleware', () => {
  it('adds Accept header', async () => {
    const baseFetch = sinon.stub().resolves(new Response('ok'));
    const fetch = buildFetchChain([createAcceptJsonMiddleware()], baseFetch);
    await fetch(new Request('https://example.com'));
    const finalReq = baseFetch.firstCall.args[0] as Request;
    expect(finalReq.headers.get('Accept')).to.equal('application/json');
  });
});

describe('ErrorMiddleware', () => {
  it('passes through successful responses', async () => {
    const baseFetch = sinon
      .stub()
      .resolves(new Response('ok', { status: 200 }));
    const fetch = buildFetchChain([createErrorMiddleware()], baseFetch);
    const res = await fetch(new Request('https://example.com'));
    expect(res.status).to.equal(200);
  });

  it('throws ColabRequestError for non-ok responses', async () => {
    const baseFetch = sinon.stub().resolves(
      new Response('error body', {
        status: 500,
        statusText: 'Internal Server Error',
      }),
    );
    const fetch = buildFetchChain([createErrorMiddleware()], baseFetch);
    let error: unknown;
    try {
      await fetch(new Request('https://example.com'));
    } catch (e) {
      error = e;
    }
    expect(error).to.be.instanceOf(ColabRequestError);
    if (error instanceof ColabRequestError) {
      expect(error.responseBody).to.equal('error body');
      expect(error.message).to.include(
        'Failed to issue request GET https://example.com/: Internal Server Error',
      );
    }
  });
});

describe('AuthMiddleware', () => {
  it('adds authorization header with token', async () => {
    const baseFetch = sinon.stub().resolves(new Response('ok'));
    const getAccessToken = sinon.stub().resolves('my-token');
    const fetch = buildFetchChain(
      [createAuthMiddleware(getAccessToken)],
      baseFetch,
    );

    await fetch(new Request('https://example.com'));
    const finalReq = baseFetch.firstCall.args[0] as Request;
    expect(finalReq.headers.get('Authorization')).to.equal('Bearer my-token');
  });

  it('retries once on 401 if onAuthError is provided', async () => {
    const baseFetch = sinon
      .stub()
      .onFirstCall()
      .resolves(new Response('Unauthorized', { status: 401 }))
      .onSecondCall()
      .resolves(new Response('ok', { status: 200 }));
    const getAccessToken = sinon.stub().resolves('my-token');
    const onAuthError = sinon.stub().resolves();

    const fetch = buildFetchChain(
      [createAuthMiddleware(getAccessToken, onAuthError)],
      baseFetch,
    );
    const res = await fetch(new Request('https://example.com'));

    expect(baseFetch.calledTwice).to.be.true;
    expect(onAuthError.calledOnce).to.be.true;
    expect(res.status).to.equal(200);
  });

  it('does not retry if onAuthError is not provided', async () => {
    const baseFetch = sinon
      .stub()
      .resolves(new Response('Unauthorized', { status: 401 }));
    const getAccessToken = sinon.stub().resolves('my-token');

    const fetch = buildFetchChain(
      [createAuthMiddleware(getAccessToken)],
      baseFetch,
    );
    const res = await fetch(new Request('https://example.com'));

    expect(baseFetch.calledOnce).to.be.true;
    expect(res.status).to.equal(401);
  });
});
