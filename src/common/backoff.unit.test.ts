/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon from 'sinon';
import { calculateBackoffIntervals, countsAsNetworkFailure } from './backoff';
import { TimeoutError } from './task-runner';

describe('calculateBackoffIntervals', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('doubles the skipped intervals for consecutive failures', () => {
    sinon.stub(Math, 'random').returns(0.5);

    expect(
      [1, 2, 3, 4].map((failures) => calculateBackoffIntervals(failures, 60)),
    ).to.deep.equal([1, 2, 4, 8]);
  });

  it('caps the skipped intervals at the supplied maximum', () => {
    sinon.stub(Math, 'random').returns(0.5);

    expect(calculateBackoffIntervals(10, 15)).to.equal(15);
    expect(calculateBackoffIntervals(10, 60)).to.equal(60);
  });

  it('never skips fewer than one interval', () => {
    sinon.stub(Math, 'random').returns(0);

    expect(calculateBackoffIntervals(1, 60)).to.equal(1);
  });

  it('clamps jitter that would exceed the cap', () => {
    sinon.stub(Math, 'random').returns(0.999);

    expect(calculateBackoffIntervals(10, 60)).to.equal(60);
  });
});

describe('countsAsNetworkFailure', () => {
  it('counts failures without a signal or with a non-aborted signal', () => {
    expect(countsAsNetworkFailure()).to.be.true;
    expect(countsAsNetworkFailure(new AbortController().signal)).to.be.true;
  });

  it('counts timeouts', () => {
    const controller = new AbortController();
    controller.abort(new TimeoutError('poll', 1000));

    expect(countsAsNetworkFailure(controller.signal)).to.be.true;
  });

  it('does not count other abort reasons', () => {
    for (const reason of [
      undefined,
      new Error('disposed'),
      'cancelled',
      null,
    ]) {
      const controller = new AbortController();
      controller.abort(reason);

      expect(countsAsNetworkFailure(controller.signal)).to.be.false;
    }
  });
});
