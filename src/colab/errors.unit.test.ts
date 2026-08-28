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

describe('errors', () => {
  const cases: [string, Error][] = [
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

  cases.forEach(([expected, error]) => {
    it(`reports ${expected} as its own name`, () => {
      expect(error.name).to.equal(expected);
    });
  });

  it('gives every error a distinct name', () => {
    const names = cases.map(([, error]) => error.name);

    expect(new Set(names).size).to.equal(names.length);
  });
});
