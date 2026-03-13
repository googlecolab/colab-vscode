/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon, { SinonStub } from 'sinon';
import { Deferred } from '../test/helpers/async';
import { trackErrors, withErrorTracking } from './decorators';
import { telemetry } from '.';

class TestClass {
  @trackErrors
  syncMethod(a: number, b: number): number {
    return a + b;
  }

  @trackErrors
  async asyncMethod(a: number, b: number): Promise<number> {
    return new Promise((resolve) => {
      resolve(a * b);
    });
  }

  @trackErrors
  syncErrorMethod(): void {
    throw new Error('Synchronous error');
  }

  @trackErrors
  async asyncErrorMethod(): Promise<void> {
    return Promise.reject(new Error('Asynchronous error'));
  }
}

describe('trackError', () => {
  let logErrorStub: SinonStub;
  let test: TestClass;

  beforeEach(() => {
    logErrorStub = sinon.stub(telemetry, 'logError');
    test = new TestClass();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('on an async function', () => {
    it('logs and rethrows errors', async () => {
      const result = test.asyncErrorMethod();

      await expect(result).to.be.rejectedWith('Asynchronous error');
      sinon.assert.calledOnceWithMatch(
        logErrorStub,
        sinon.match
          .instanceOf(Error)
          .and(sinon.match.has('message', 'Asynchronous error')),
      );
    });

    it('does not log when an error is not thrown', async () => {
      const result = test.asyncMethod(2, 3);

      await expect(result).to.eventually.equal(6);
      sinon.assert.notCalled(logErrorStub);
    });
  });

  describe('on a sync function', () => {
    it('logs and rethrows errors', () => {
      expect(() => {
        test.syncErrorMethod();
      }).to.throw('Synchronous error');
      sinon.assert.calledOnceWithMatch(
        logErrorStub,
        sinon.match
          .instanceOf(Error)
          .and(sinon.match.has('message', 'Synchronous error')),
      );
    });

    it('does not log when an error is not thrown', () => {
      const result = test.syncMethod(2, 3);

      expect(result).to.equal(5);
      sinon.assert.notCalled(logErrorStub);
    });
  });
});

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
