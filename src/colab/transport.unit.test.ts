/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import fetch, { Response } from 'node-fetch';
import { SinonStub } from 'sinon';
import * as sinon from 'sinon';
import { z } from 'zod';
import { Transport, ColabRequestError } from './transport';

const BEARER_TOKEN = 'access-token';

describe('Transport', () => {
  let fetchStub: sinon.SinonStubbedMember<typeof fetch>;
  let getAccessTokenStub: SinonStub<[], Promise<string>>;
  let onAuthErrorStub: SinonStub<[], Promise<void>>;
  let transport: Transport;

  beforeEach(() => {
    fetchStub = sinon.stub(fetch, 'default').callsFake(() => {
      throw new Error('fetch was called with non-matching call');
    });
    getAccessTokenStub = sinon
      .stub<[], Promise<string>>()
      .resolves(BEARER_TOKEN);
    onAuthErrorStub = sinon.stub<[], Promise<void>>().resolves();
    transport = new Transport(getAccessTokenStub, onAuthErrorStub);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('issues request successfully without parsing', async () => {
    fetchStub.resolves(new Response(undefined, { status: 200 }));

    await expect(transport.issueRequest(new URL('https://example.com'), {})).to
      .eventually.be.fulfilled;

    sinon.assert.calledOnce(fetchStub);
  });

  it('sets authorization and accept headers', async () => {
    fetchStub.callsFake(async (urlOrRequest) => {
      const request = urlOrRequest as unknown as fetch.Request;
      expect(request.headers.get('Authorization')).to.equal(
        'Bearer access-token',
      );
      expect(request.headers.get('Accept')).to.equal('application/json');
      return new Response(JSON.stringify({ foo: 'bar' }), { status: 200 });
    });

    const schema = z.object({ foo: z.string() });
    await transport.issueRequestAndParse(
      new URL('https://example.com'),
      {},
      schema,
    );
    sinon.assert.calledOnce(fetchStub);
  });

  it('does not set authorization header if requireAccessToken is false', async () => {
    fetchStub.callsFake(async (urlOrRequest) => {
      const request = urlOrRequest as unknown as fetch.Request;
      expect(request.headers.get('Authorization')).to.be.null;
      return new Response(JSON.stringify({ foo: 'bar' }), { status: 200 });
    });

    const schema = z.object({ foo: z.string() });
    await transport.issueRequestAndParse(
      new URL('https://example.com'),
      {},
      schema,
      { requireAccessToken: false },
    );
    sinon.assert.calledOnce(fetchStub);
    sinon.assert.notCalled(getAccessTokenStub);
  });

  it('strips XSSI prefix if present', async () => {
    fetchStub.resolves(
      new Response(")]}'\n" + JSON.stringify({ foo: 'bar' }), { status: 200 }),
    );
    const schema = z.object({ foo: z.string() });
    await expect(
      transport.issueRequestAndParse(
        new URL('https://example.com'),
        {},
        schema,
      ),
    ).to.eventually.deep.equal({ foo: 'bar' });
  });

  it('supports non-XSSI responses', async () => {
    fetchStub.resolves(
      new Response(JSON.stringify({ foo: 'bar' }), { status: 200 }),
    );
    const schema = z.object({ foo: z.string() });
    await expect(
      transport.issueRequestAndParse(
        new URL('https://example.com'),
        {},
        schema,
      ),
    ).to.eventually.deep.equal({ foo: 'bar' });
  });

  it('retries request on 401 if onAuthError is provided', async () => {
    fetchStub
      .onFirstCall()
      .resolves(new Response('Unauthorized', { status: 401 }))
      .onSecondCall()
      .resolves(new Response(JSON.stringify({ foo: 'bar' }), { status: 200 }));

    const schema = z.object({ foo: z.string() });
    await expect(
      transport.issueRequestAndParse(
        new URL('https://example.com'),
        {},
        schema,
      ),
    ).to.eventually.deep.equal({ foo: 'bar' });

    sinon.assert.calledTwice(fetchStub);
    sinon.assert.calledOnce(onAuthErrorStub);
  });

  it('does not retry more than two times on persistent 401', async () => {
    fetchStub.resolves(new Response('Unauthorized', { status: 401 }));

    const schema = z.object({ foo: z.string() });
    await expect(
      transport.issueRequestAndParse(
        new URL('https://example.com'),
        {},
        schema,
      ),
    ).to.eventually.be.rejectedWith(ColabRequestError, /Unauthorized/);

    sinon.assert.calledTwice(fetchStub);
    // There's only one attempt to fix the auth error.
    sinon.assert.calledOnce(onAuthErrorStub);
  });

  it('throws on 401 if onAuthError is not provided', async () => {
    transport = new Transport(getAccessTokenStub);
    fetchStub.resolves(new Response('Unauthorized', { status: 401 }));

    const schema = z.object({ foo: z.string() });
    await expect(
      transport.issueRequestAndParse(
        new URL('https://example.com'),
        {},
        schema,
      ),
    ).to.eventually.be.rejectedWith(ColabRequestError, /Unauthorized/);

    sinon.assert.notCalled(onAuthErrorStub);
    sinon.assert.calledOnce(fetchStub);
  });

  it('rejects when error responses are returned', async () => {
    fetchStub.resolves(
      new Response('Error', { status: 500, statusText: 'Foo error' }),
    );

    const schema = z.object({ foo: z.string() });
    await expect(
      transport.issueRequestAndParse(
        new URL('https://example.com'),
        {},
        schema,
      ),
    ).to.eventually.be.rejectedWith(ColabRequestError, /Foo error/);
  });

  it('rejects invalid JSON responses', async () => {
    fetchStub.resolves(new Response(")]}'\nnot JSON eh?", { status: 200 }));

    const schema = z.object({ foo: z.string() });
    await expect(
      transport.issueRequestAndParse(
        new URL('https://example.com'),
        {},
        schema,
      ),
    ).to.eventually.be.rejectedWith(Error);
  });

  it('rejects response schema mismatches', async () => {
    fetchStub.resolves(
      new Response(JSON.stringify({ bar: 'baz' }), { status: 200 }),
    );

    const schema = z.object({ foo: z.string() });
    await expect(
      transport.issueRequestAndParse(
        new URL('https://example.com'),
        {},
        schema,
      ),
    ).to.eventually.be.rejectedWith(z.ZodError);
  });
});
