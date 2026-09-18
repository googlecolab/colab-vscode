/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import { isCancellation, UserCancelledError } from './cancellation';
import { InputFlowAction } from './multi-step-quickpick';

function namedError(name: string): Error {
  const error = new Error('boom');
  error.name = name;
  return error;
}

describe('isCancellation', () => {
  const cancellations = [
    { label: 'an AbortSignal abort', error: namedError('AbortError') },
    { label: 'a vscode CancellationError', error: namedError('Canceled') },
    {
      label: 'a modern CancellationError',
      error: namedError('CancellationError'),
    },
    { label: 'a dismissed quick pick', error: InputFlowAction.cancel },
    { label: 'a UserCancelledError', error: new UserCancelledError('nope') },
  ];
  for (const { label, error } of cancellations) {
    it(`classifies ${label} as a cancellation`, () => {
      expect(isCancellation(error)).to.be.true;
    });
  }

  it('does not classify a plain error as a cancellation', () => {
    expect(isCancellation(new Error('the network is on fire'))).to.be.false;
  });

  it('does not classify an error merely mentioning cancellation', () => {
    expect(isCancellation(new Error('request was cancelled upstream'))).to.be
      .false;
  });

  it('does not classify a non-error as a cancellation', () => {
    expect(isCancellation('Canceled')).to.be.false;
  });
});

describe('UserCancelledError', () => {
  it('reports a name error reporting recognizes', () => {
    expect(new UserCancelledError('nope').name).to.equal('CancellationError');
  });

  it('retains the message and the underlying cause', () => {
    const cause = new Error('the user closed the tab');

    const err = new UserCancelledError('Sign-in was cancelled.', { cause });

    expect(err.message).to.equal('Sign-in was cancelled.');
    expect(err.cause).to.equal(cause);
  });
});
