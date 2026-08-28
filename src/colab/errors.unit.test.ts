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
  redactUrl,
  TooManyAssignmentsError,
  WaitOperationTimeoutError,
} from './errors';

describe('redactUrl', () => {
  it('replaces every query value while keeping the keys', () => {
    expect(redactUrl('https://example.test/a?nbh=secret&authuser=0')).to.equal(
      'https://example.test/a?nbh=REDACTED&authuser=REDACTED',
    );
  });

  it('replaces the whole fragment, keys included', () => {
    expect(redactUrl('https://example.test/a#nbh=secret')).to.equal(
      'https://example.test/a#REDACTED',
    );
  });

  it('leaves a URL with nothing to redact unchanged', () => {
    expect(redactUrl('https://example.test/a/b')).to.equal(
      'https://example.test/a/b',
    );
  });

  it('collapses a repeated key to a single redaction', () => {
    // `set` replaces every occurrence, so the count of a repeated parameter is
    // lost. Both values are still redacted, which is what matters here.
    expect(redactUrl('https://example.test/a?x=1&x=2')).to.equal(
      'https://example.test/a?x=REDACTED',
    );
  });

  it('drops the query and fragment from an unparsable URL', () => {
    expect(redactUrl('/a/b?nbh=secret')).to.equal('/a/b');
    expect(redactUrl('/a/b#nbh=secret')).to.equal('/a/b');
    expect(redactUrl('/a/b?foo=bar#nbh=secret')).to.equal('/a/b');
    expect(redactUrl('not a url')).to.equal('not a url');
  });
});

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

  it('redacts values in the query string', () => {
    const error = buildBadRequestError(
      'https://example.test/tun/m/assign?nbh=secret',
    );

    expect(error.message).to.not.contain('secret');
    expect(error.message).to.contain(
      'https://example.test/tun/m/assign?nbh=REDACTED',
    );
  });

  it('drops the query from a URL that does not parse', () => {
    const error = buildBadRequestError('/tun/m/assign?nbh=secret&authuser=0');

    expect(error.message).to.not.contain('secret');
    expect(error.message).to.not.contain('authuser');
  });

  it('redacts URL fragment', () => {
    const error = buildBadRequestError(
      'https://example.test/v1/thing#nbh=secret',
    );

    expect(error.message).to.not.contain('secret');
    expect(error.message).to.contain('https://example.test/v1/thing#REDACTED');
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
