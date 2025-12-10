/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import { ColabLogWatcher } from '../../test/helpers/logging';
import { newVsCodeStub } from '../../test/helpers/vscode';
import { traceMethod } from './decorators';
import { LogLevel } from '.';

// A simple class to test the method decorator.
class TestClass {
  @traceMethod
  syncMethod(a: number, b: number): number {
    return a + b;
  }

  @traceMethod
  async asyncMethod(a: number, b: number): Promise<number> {
    return new Promise((resolve) => {
      resolve(a * b);
    });
  }

  @traceMethod
  syncErrorMethod(): void {
    throw new Error('Synchronous error');
  }

  @traceMethod
  async asyncErrorMethod(): Promise<void> {
    return Promise.reject(new Error('Asynchronous error'));
  }
}

describe('traceMethod', () => {
  let logs: ColabLogWatcher;
  let test: TestClass;

  beforeEach(() => {
    logs = new ColabLogWatcher(newVsCodeStub(), LogLevel.Trace);
    test = new TestClass();
  });

  afterEach(() => {
    logs.dispose();
  });

  it('logs entry and exit of synchronous method', () => {
    test.syncMethod(2, 3);

    const output = logs.output;
    expect(output).to.match(/TestClass\.syncMethod called with\s+2\s+3/);
    expect(output).to.match(/TestClass\.syncMethod returned \(sync\)\s+5/);
  });

  it('logs entry and exit of asynchronous method', async () => {
    await test.asyncMethod(4, 5);

    const output = logs.output;
    expect(output).to.match(/TestClass\.asyncMethod called with\s+4\s+5/);
    expect(output).to.include('TestClass.asyncMethod returned a Promise');
    expect(output).to.match(
      /TestClass\.asyncMethod Promise resolved[\s\S]*?20/,
    );
  });

  it('logs result of asynchronous method once resolved', async () => {
    const asyncMethod = test.asyncMethod(4, 5);

    const output = logs.output;
    expect(output).to.match(/TestClass\.asyncMethod called with\s+4\s+5/);
    expect(output).to.include('TestClass.asyncMethod returned a Promise');
    expect(output).not.to.match(/resolved/);

    await asyncMethod;
    expect(logs.output).to.match(
      /TestClass\.asyncMethod Promise resolved[\s\S]*?20/,
    );
  });

  it('logs entry and error of synchronous method that throws', () => {
    expect(() => {
      test.syncErrorMethod();
    }).to.throw('Synchronous error');

    const output = logs.output;
    expect(output).to.match(/TestClass\.syncErrorMethod called with/);
    expect(output).to.match(
      /TestClass\.syncErrorMethod threw error \(sync\)\s+Error: Synchronous error/,
    );
  });

  it('logs entry and error of asynchronous method once rejected', async () => {
    await expect(test.asyncErrorMethod()).to.be.rejectedWith(
      'Asynchronous error',
    );

    const output = logs.output;
    expect(output).to.match(/TestClass\.asyncErrorMethod called with/);
    expect(output).to.include('TestClass.asyncErrorMethod returned a Promise');
    expect(output).to.match(
      /TestClass\.asyncErrorMethod Promise rejected[\s\S]*?Error: Asynchronous error/,
    );
  });
});
