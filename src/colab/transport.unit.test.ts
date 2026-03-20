/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as https from 'https';
import { expect } from 'chai';
import fetch, { Response } from 'node-fetch';
import { SinonStub } from 'sinon';
import * as sinon from 'sinon';
import { z } from 'zod';
import { REQUIRED_SCOPES } from '../auth/scopes';
import { ACCEPT_JSON_HEADER, AUTHORIZATION_HEADER } from './headers';
import { Transport, ColabRequestError } from './transport';

const DOMAIN = 'https://example.com';
const BEARER_TOKEN = 'access-token';

describe('Transport', () => {
  let fetchStub: sinon.SinonStubbedMember<typeof fetch>;
  let getAccessTokenStub: SinonStub<[readonly string[]], Promise<string>>;
  let onAuthErrorStub: SinonStub<[], Promise<void>>;
  let transport: Transport;

  beforeEach(() => {
    fetchStub = sinon.stub(fetch, 'default').callsFake(() => {
      throw new Error('fetch was called with non-matching call');
    });
    getAccessTokenStub = sinon
      .stub<[readonly string[]], Promise<string>>()
      .resolves(BEARER_TOKEN);
    onAuthErrorStub = sinon.stub<[], Promise<void>>().resolves();
    transport = new Transport(getAccessTokenStub, onAuthErrorStub);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('issues request successfully without parsing', async () => {
    fetchStub.resolves(new Response(undefined, { status: 200 }));

    await expect(transport.issueRequest(new URL(DOMAIN), {})).to.eventually.be
      .fulfilled;
    sinon.assert.calledOnce(fetchStub);
  });

  it('sets authorization and accept headers', async () => {
    fetchStub.resolves(
      new Response(JSON.stringify({ foo: 'bar' }), { status: 200 }),
    );
    const schema = z.object({ foo: z.string() });

    await transport.issueRequestAndParse(new URL(DOMAIN), {}, schema);

    sinon.assert.calledOnce(fetchStub);
    sinon.assert.calledWith(
      fetchStub,
      sinon.match({
        headers: sinon.match((headers: Headers) => {
          return (
            headers.get(AUTHORIZATION_HEADER.key) ===
              `Bearer ${BEARER_TOKEN}` &&
            headers.get(ACCEPT_JSON_HEADER.key) === ACCEPT_JSON_HEADER.value
          );
        }),
      }),
    );
  });

  it('does not set authorization header if requireAccessToken is false', async () => {
    fetchStub.resolves(
      new Response(JSON.stringify({ foo: 'bar' }), { status: 200 }),
    );
    const schema = z.object({ foo: z.string() });

    await transport.issueRequestAndParse(new URL(DOMAIN), {}, schema, {
      requireAccessToken: false,
    });

    sinon.assert.calledOnce(fetchStub);
    sinon.assert.calledWith(
      fetchStub,
      sinon.match(
        (req: Request) => req.headers.get(AUTHORIZATION_HEADER.key) === null,
      ),
    );
    sinon.assert.notCalled(getAccessTokenStub);
  });

  it('uses provided scopes to retrieve access token', async () => {
    const customScopes = ['scope1', 'scope2'];
    fetchStub.resolves(new Response(undefined, { status: 200 }));

    await transport.issueRequest(new URL(DOMAIN), {}, { scopes: customScopes });

    sinon.assert.calledWith(getAccessTokenStub, customScopes);
  });

  it('uses REQUIRED_SCOPES as default scopes', async () => {
    fetchStub.resolves(new Response(undefined, { status: 200 }));

    await transport.issueRequest(new URL(DOMAIN), {});

    sinon.assert.calledWith(getAccessTokenStub, REQUIRED_SCOPES);
  });

  it('uses provided https agent', async () => {
    const agent = new https.Agent();
    fetchStub.resolves(new Response(undefined, { status: 200 }));

    await transport.issueRequest(new URL(DOMAIN), {}, { httpsAgent: agent });

    sinon.assert.calledWith(
      fetchStub,
      sinon.match({
        agent,
      }),
    );
  });

  it('strips XSSI prefix if present', async () => {
    fetchStub.resolves(
      new Response(")]}'\n" + JSON.stringify({ foo: 'bar' }), { status: 200 }),
    );
    const schema = z.object({ foo: z.string() });
    await expect(
      transport.issueRequestAndParse(new URL(DOMAIN), {}, schema),
    ).to.eventually.deep.equal({ foo: 'bar' });
  });

  it('supports non-XSSI responses', async () => {
    fetchStub.resolves(
      new Response(JSON.stringify({ foo: 'bar' }), { status: 200 }),
    );
    const schema = z.object({ foo: z.string() });
    await expect(
      transport.issueRequestAndParse(new URL(DOMAIN), {}, schema),
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
      transport.issueRequestAndParse(new URL(DOMAIN), {}, schema),
    ).to.eventually.deep.equal({ foo: 'bar' });

    sinon.assert.calledTwice(fetchStub);
    sinon.assert.calledOnce(onAuthErrorStub);
  });

  it('does not retry more than two times on persistent 401', async () => {
    fetchStub.resolves(new Response('Unauthorized', { status: 401 }));

    const schema = z.object({ foo: z.string() });
    await expect(
      transport.issueRequestAndParse(new URL(DOMAIN), {}, schema),
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
      transport.issueRequestAndParse(new URL(DOMAIN), {}, schema),
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
      transport.issueRequestAndParse(new URL(DOMAIN), {}, schema),
    ).to.eventually.be.rejectedWith(ColabRequestError, /Foo error/);
  });

  it('rejects invalid JSON responses', async () => {
    fetchStub.resolves(new Response(")]}'\nnot JSON eh?", { status: 200 }));

    const schema = z.object({ foo: z.string() });
    await expect(
      transport.issueRequestAndParse(new URL(DOMAIN), {}, schema),
    ).to.eventually.be.rejectedWith(Error);
  });

  it('rejects response schema mismatches', async () => {
    fetchStub.resolves(
      new Response(JSON.stringify({ foo: 4 }), { status: 200 }),
    );

    const schema = z.object({ foo: z.string() });
    await expect(
      transport.issueRequestAndParse(new URL(DOMAIN), {}, schema),
    ).to.eventually.be.rejectedWith(/foo.+received number/s);
  });
});
