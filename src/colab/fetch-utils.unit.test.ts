/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import { RequestInit, Response } from 'node-fetch';
import * as sinon from 'sinon';
import { z } from 'zod';
import { fetchAndParse } from './fetch-utils';

describe('fetchAndParse', () => {
  const schema = z.object({
    name: z.string(),
    age: z.number(),
  });

  it('successfully fetches and parses valid JSON matching the schema', async () => {
    const mockResponse = new Response(
      JSON.stringify({ name: 'Alice', age: 30 }),
    );
    const fetchStub = sinon.stub().resolves(mockResponse);

    const result = await fetchAndParse(
      fetchStub,
      'https://example.com',
      schema,
    );

    expect(result).to.deep.equal({ name: 'Alice', age: 30 });
    expect(fetchStub.calledOnceWith('https://example.com', undefined)).to.be
      .true;
  });

  it('strips XSSI prefix before parsing', async () => {
    const mockResponse = new Response(
      ")]}'\n" + JSON.stringify({ name: 'Alice', age: 30 }),
    );
    const fetchStub = sinon.stub().resolves(mockResponse);

    const result = await fetchAndParse(
      fetchStub,
      'https://example.com',
      schema,
    );

    expect(result).to.deep.equal({ name: 'Alice', age: 30 });
  });

  it('leaves response untouched if no prefix', async () => {
    const mockResponse = new Response(
      JSON.stringify({ name: 'Alice', age: 30 }),
    );
    const fetchStub = sinon.stub().resolves(mockResponse);

    const result = await fetchAndParse(
      fetchStub,
      'https://example.com',
      schema,
    );

    expect(result).to.deep.equal({ name: 'Alice', age: 30 });
  });

  it('passes init options to fetch', async () => {
    const mockResponse = new Response(JSON.stringify({ name: 'Bob', age: 25 }));
    const fetchStub = sinon.stub().resolves(mockResponse);

    const init: RequestInit = { method: 'POST', body: 'test' };
    const result = await fetchAndParse(
      fetchStub,
      'https://example.com',
      schema,
      init,
    );

    expect(result).to.deep.equal({ name: 'Bob', age: 25 });
    expect(fetchStub.calledOnceWith('https://example.com', init)).to.be.true;
  });

  it('rejects if fetch rejects', async () => {
    const fetchStub = sinon.stub().rejects(new Error('Network failure'));

    await expect(
      fetchAndParse(fetchStub, 'https://example.com', schema),
    ).to.eventually.be.rejectedWith('Network failure');
  });

  it('rejects if response is not valid JSON', async () => {
    const mockResponse = new Response('Not JSON');
    const fetchStub = sinon.stub().resolves(mockResponse);

    await expect(
      fetchAndParse(fetchStub, 'https://example.com', schema),
    ).to.eventually.be.rejectedWith(SyntaxError);
  });

  it('rejects if response does not match schema', async () => {
    const mockResponse = new Response(
      JSON.stringify({ name: 'Charlie', age: 'twenty' }),
    );
    const fetchStub = sinon.stub().resolves(mockResponse);

    await expect(fetchAndParse(fetchStub, 'https://example.com', schema)).to
      .eventually.be.rejected;
  });
});
