/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon, { SinonStub } from 'sinon';
import { Deferred } from '../test/helpers/async';
import { withErrorTracking } from './wrappers';
import { telemetry } from '.';

describe('withErrorTracking', () => {
  let logErrorStub: SinonStub;

  beforeEach(() => {
    logErrorStub = sinon.stub(telemetry, 'logError');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('on an async function', () => {
    it('logs and rethrows errors', async () => {
      const fnCalled = new Deferred<void>();
      const error = new Error('error');
      const fn = async () => {
        await fnCalled.promise;
        return Promise.reject(error);
      };

      const result = withErrorTracking(fn)();
      fnCalled.resolve();

      await expect(result).to.be.rejectedWith('error');
      sinon.assert.calledOnceWithExactly(logErrorStub, error);
    });

    it('does not log when an error is not thrown', async () => {
      const fnCalled = new Deferred<void>();
      const fn = async (input: string) => {
        await fnCalled.promise;
        return input + 'bar';
      };

      const result = withErrorTracking(fn)('foo');
      fnCalled.resolve();

      await expect(result).to.eventually.equal('foobar');
      sinon.assert.notCalled(logErrorStub);
    });
  });

  describe('on a sync function', () => {
    it('logs and rethrows errors', () => {
      const error = new Error('error');
      const fn = () => {
        throw error;
      };

      expect(() => withErrorTracking(fn)()).to.throw('error');
      sinon.assert.calledOnceWithExactly(logErrorStub, error);
    });

    it('does not log when an error is not thrown', () => {
      const fn = (input: string) => {
        return input + 'bar';
      };

      const result = withErrorTracking(fn)('foo');

      expect(result).to.equal('foobar');
      sinon.assert.notCalled(logErrorStub);
    });
  });
});
