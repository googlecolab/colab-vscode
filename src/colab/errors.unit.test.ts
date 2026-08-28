/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import { Request, Response } from 'node-fetch';
import { InputFlowAction } from '../common/multi-step-quickpick';
import { ServerNotFound } from '../jupyter/contents/sessions';
import {
  AcceleratorUnavailableError,
  ColabRequestError,
  DenylistedError,
  InsufficientQuotaError,
  LongRunningOperationError,
  NotFoundError,
  TooManyAssignmentsError,
  WaitOperationTimeoutError,
} from './errors';

describe('ColabRequestError', () => {
  function buildBadRequestError(url: string, body?: string): ColabRequestError {
    return new ColabRequestError(
      new Request(url),
      new Response(body, { status: 400, statusText: 'Bad Request' }),
      body,
    );
  }

  it('keeps the method, path and status in the message', () => {
    const error = buildBadRequestError('https://example.test/tun/m/assign');

    expect(error.message).to.contain('GET');
    expect(error.message).to.contain('https://example.test/tun/m/assign');
    expect(error.message).to.contain('Bad Request');
  });

  it('drops the query string, which carries notebook hashes', () => {
    const error = buildBadRequestError(
      'https://example.test/tun/m/assign?nbh=secret&authuser=0',
    );

    expect(error.message).to.not.contain('secret');
    expect(error.message).to.not.contain('authuser');
  });

  it('drops the query from a URL that does not parse', () => {
    const error = buildBadRequestError('/tun/m/assign?nbh=secret&authuser=0');

    expect(error.message).to.not.contain('secret');
    expect(error.message).to.not.contain('authuser');
  });

  it('drops fragments', () => {
    const error = buildBadRequestError(
      'https://example.test/v1/thing#nbh=secret',
    );

    expect(error.message).to.not.contain('secret');
  });

  it('truncates an oversized response body', () => {
    const body = 'x'.repeat(5000);

    const error = buildBadRequestError('https://example.test/v1/thing', body);

    expect(error.message.length).to.be.lessThan(1000);
    expect(error.message).to.contain('5000 chars total');
  });

  it('leaves a small response body intact', () => {
    const error = buildBadRequestError(
      'https://example.test/v1/thing',
      'not found',
    );

    expect(error.message).to.contain('not found');
    expect(error.message).to.not.contain('chars total');
  });

  it('exposes the full body on the error', () => {
    const body = 'x'.repeat(5000);

    expect(
      buildBadRequestError('https://example.test/v1/thing', body).responseBody,
    ).to.equal(body);
  });
});

const errors: [string, Error][] = [
  [
    'ColabRequestError',
    new ColabRequestError(
      new Request('https://example.test/v1/thing'),
      new Response('nope', { status: 500 }),
    ),
  ],
  ['TooManyAssignmentsError', new TooManyAssignmentsError()],
  ['AcceleratorUnavailableError', new AcceleratorUnavailableError('T4')],
  ['DenylistedError', new DenylistedError()],
  ['InsufficientQuotaError', new InsufficientQuotaError()],
  ['NotFoundError', new NotFoundError()],
  ['LongRunningOperationError', new LongRunningOperationError()],
  ['WaitOperationTimeoutError', new WaitOperationTimeoutError('op', '20s')],
  ['InputFlowAction', InputFlowAction.back],
  ['ServerNotFound', new ServerNotFound('https://example.test')],
];

errors.forEach(([expected, error]) => {
  it(`reports ${expected} as its own name`, () => {
    expect(error.name).to.equal(expected);
  });
});

it('gives every error a distinct name', () => {
  const names = errors.map(([, error]) => error.name);

  expect(new Set(names).size).to.equal(names.length);
});
