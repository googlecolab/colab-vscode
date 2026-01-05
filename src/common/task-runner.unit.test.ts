/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon, { SinonFakeTimers } from 'sinon';
import { ColabLogWatcher } from '../test/helpers/logging';
import { newVsCodeStub } from '../test/helpers/vscode';
import { LogLevel } from './logging';
import {
  Config,
  OverrunPolicy,
  SequentialTaskRunner,
  StartMode,
  Task,
} from './task-runner';

const INTERVAL_TIMEOUT_MS = 1000;
const TASK_TIMEOUT_MS = 100;
const ABANDON_GRACE_MS = 10;

interface TestRun {
  /**
   * A promise that resolves when the run was started. Returns the resolver for
   * the run.
   */
  started: Promise<void>;
  /** Finishes the started run, if it has been started. */
  resolve: () => void;
  /** Finishes the started run, if it has been started. */
  reject: (reason: unknown) => void;
  /** A promise that resolves when the run was aborted. */
  aborted: Promise<void>;
}

class TestTask implements Task {
  readonly name = 'test task';
  readonly run = sinon.stub<[AbortSignal], Promise<void>>();

  nextRun(): TestRun {
    let abortResolver: () => void;
    const aborted = new Promise<void>((resolve) => {
      abortResolver = resolve;
    });

    // Only stub the next call to run.
    const callIndex = this.run.callCount;
    let resolveRun: () => void = () => {
      throw new Error(
        "Test setup error: can't resolve task if it hasn't started.",
      );
    };
    let rejectRun: (reason: unknown) => void = () => {
      throw new Error(
        "Test setup error: can't reject task if it hasn't started.",
      );
    };
    const started = new Promise<void>((resolveStarted) => {
      this.run.onCall(callIndex).callsFake((signal: AbortSignal) => {
        signal.addEventListener('abort', () => {
          abortResolver();
        });

        return new Promise<void>((res, rej) => {
          resolveRun = res;
          rejectRun = rej;
          // Resolve the 'started' promise with the resolver for the run.
          resolveStarted();
        });
      });
    });

    return {
      started,
      resolve: () => {
        resolveRun();
      },
      reject: (reason: unknown) => {
        rejectRun(reason);
      },
      aborted,
    };
  }
}

describe('SequentialTaskRunner', () => {
  let clock: SinonFakeTimers;
  let logs: ColabLogWatcher;
  let testTask: TestTask;

  function buildRunner(
    overrun: OverrunPolicy = OverrunPolicy.AllowToComplete,
    config: Config = {
      intervalTimeoutMs: INTERVAL_TIMEOUT_MS,
      taskTimeoutMs: TASK_TIMEOUT_MS,
      abandonGraceMs: ABANDON_GRACE_MS,
    },
  ): SequentialTaskRunner {
    return new SequentialTaskRunner(config, testTask, overrun);
  }

  async function tickPast(ms: number) {
    await clock.tickAsync(ms + 1);
  }

  beforeEach(() => {
    clock = sinon.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout'],
    });
    logs = new ColabLogWatcher(newVsCodeStub(), LogLevel.Warning);
    testTask = new TestTask();
  });

  afterEach(() => {
    logs.dispose();
    clock.restore();
  });

  describe('dispose', () => {
    let runner: SequentialTaskRunner;

    beforeEach(() => {
      runner = buildRunner();
    });

    afterEach(() => {
      runner.dispose();
    });

    it('cancels any scheduled tasks', async () => {
      runner.start(StartMode.Scheduled);

      runner.dispose();

      await tickPast(INTERVAL_TIMEOUT_MS);
      sinon.assert.notCalled(testTask.run);
    });

    it('aborts in-flight tasks', async () => {
      const run = testTask.nextRun();
      runner.start();
      await tickPast(INTERVAL_TIMEOUT_MS);

      runner.dispose();

      await expect(run.aborted, 'Task should be aborted when disposed').to
        .eventually.be.fulfilled;
      expect(logs.output, 'Nothing should be logged on a clean disposal').is
        .empty;
    });
  });

  describe('start', () => {
    it('runs the task immediately when StartMode.Immediately is configured', async () => {
      const runner = buildRunner();
      const run = testTask.nextRun();

      runner.start(StartMode.Immediately);

      await expect(run.started, 'Task should start immediately').to.eventually
        .be.fulfilled;
    });

    it('schedules the task to be run after the configured interval', async () => {
      const runner = buildRunner();
      const run = testTask.nextRun();

      runner.start(StartMode.Scheduled);
      await tickPast(INTERVAL_TIMEOUT_MS);

      await expect(run.started, 'Task should start after scheduled interval').to
        .eventually.be.fulfilled;
    });

    it('does nothing if the task is already started', async () => {
      const runner = buildRunner();
      const run = testTask.nextRun();

      runner.start(StartMode.Scheduled);
      runner.start(StartMode.Immediately);
      await tickPast(INTERVAL_TIMEOUT_MS);

      await expect(run.started, 'Task should start after scheduled interval').to
        .eventually.be.fulfilled;
      sinon.assert.calledOnce(testTask.run);
    });

    it('resumes a previously stopped runner', async () => {
      const runner = buildRunner();
      const firstRun = testTask.nextRun();
      runner.start(StartMode.Immediately);
      await expect(firstRun.started, 'First run should start').to.eventually.be
        .fulfilled;

      runner.stop();

      await expect(firstRun.aborted, 'First run should be aborted').to
        .eventually.be.fulfilled;
      await tickPast(ABANDON_GRACE_MS);
      const secondRun = testTask.nextRun();

      runner.start(StartMode.Immediately);

      await expect(secondRun.started, 'Second run should start').to.eventually
        .be.fulfilled;
      sinon.assert.calledTwice(testTask.run);
    });

    it('runs multiple times', async () => {
      const runner = buildRunner();

      const firstRun = testTask.nextRun();
      runner.start(StartMode.Immediately);
      await expect(firstRun.started, 'First run should start').to.eventually.be
        .fulfilled;
      firstRun.resolve();

      const secondRun = testTask.nextRun();
      await tickPast(INTERVAL_TIMEOUT_MS);
      await expect(secondRun.started, 'Second run should start').to.eventually
        .be.fulfilled;
      secondRun.resolve();
    });
  });

  describe('stop', () => {
    it('cancels the next scheduled task run', async () => {
      const runner = buildRunner();
      runner.start(StartMode.Scheduled);

      runner.stop();

      await tickPast(INTERVAL_TIMEOUT_MS);
      sinon.assert.notCalled(testTask.run);
    });

    it('aborts in-flight tasks', async () => {
      const runner = buildRunner();
      const run = testTask.nextRun();
      runner.start(StartMode.Immediately);
      await expect(run.started, 'Task should start immediately').to.eventually
        .be.fulfilled;

      runner.stop();

      await expect(run.aborted, 'Task should be aborted').to.eventually.be
        .fulfilled;
      sinon.assert.calledOnce(testTask.run);
    });
  });

  describe('when overrun (AllowToComplete policy)', () => {
    it('does nothing for the current interval', async () => {
      const runner = buildRunner(OverrunPolicy.AllowToComplete, {
        abandonGraceMs: ABANDON_GRACE_MS,
        intervalTimeoutMs: INTERVAL_TIMEOUT_MS,
        taskTimeoutMs: INTERVAL_TIMEOUT_MS * 2,
      });
      const firstRun = testTask.nextRun();
      runner.start(StartMode.Immediately);
      await expect(firstRun.started, 'Task should start immediately').to
        .eventually.be.fulfilled;

      await tickPast(INTERVAL_TIMEOUT_MS);

      sinon.assert.calledOnce(testTask.run);
    });
  });

  describe('when overrun (AbandonAndRun policy)', () => {
    let runner: SequentialTaskRunner;
    let firstRun: TestRun;
    let secondRun: TestRun;

    beforeEach(async () => {
      runner = buildRunner(OverrunPolicy.AbandonAndRun, {
        abandonGraceMs: ABANDON_GRACE_MS,
        intervalTimeoutMs: INTERVAL_TIMEOUT_MS,
        // A task timeout longer than the interval so overruns happen.
        taskTimeoutMs: INTERVAL_TIMEOUT_MS * 10,
      });
      firstRun = testTask.nextRun();
      runner.start(StartMode.Immediately);
      await expect(firstRun.started, 'First run should start immediately').to
        .eventually.be.fulfilled;
      secondRun = testTask.nextRun();
      // Don't resolve the first run, to simulate it being in-flight and overrun
      // by the second run.
      await clock.tickAsync(INTERVAL_TIMEOUT_MS);
    });

    afterEach(() => {
      runner.dispose();
    });

    it('aborts the in-flight task and starts a new one after the abandon grace period', async () => {
      await expect(firstRun.aborted, 'First run should be aborted').to
        .eventually.be.fulfilled;

      await clock.tickAsync(ABANDON_GRACE_MS / 2);
      expect(secondRun.started, 'Second run should not start yet').to.not.be
        .fulfilled;
      sinon.assert.calledOnce(testTask.run);

      await clock.tickAsync(ABANDON_GRACE_MS);
      await expect(secondRun.started, 'Second run should start').to.eventually
        .be.fulfilled;
      sinon.assert.calledTwice(testTask.run);
    });

    it('logs a warning message immediately', () => {
      expect(logs.output).to.match(
        new RegExp(`Warning.*${testTask.name}.*new run`),
      );
    });

    it('grants a grace period for the aborted task to complete cleanly', async () => {
      await expect(firstRun.aborted, 'First run should be aborted').to
        .eventually.be.fulfilled;
      await tickPast(ABANDON_GRACE_MS / 2);
      // Verify the second run hasn't started, before the grace period.
      expect(secondRun.started, 'Second run should not start yet').to.not.be
        .fulfilled;

      firstRun.resolve();

      // Wait for grace period to pass and second task to start.
      await tickPast(ABANDON_GRACE_MS);
      await expect(secondRun.started, 'Second run should start').to.eventually
        .be.fulfilled;

      // Check that no non-graceful error was logged. A warning for overrun is
      // expected.
      expect(logs.output).to.match(
        new RegExp(`Warning.*${testTask.name}.*new run`),
      );
      expect(logs.output).to.not.match(
        new RegExp(`Error.*did not complete within a.*grace period`),
      );
    });

    it('logs an error if the aborted task fails to complete within its grace period', async () => {
      await expect(firstRun.aborted, 'First run should be aborted').to
        .eventually.be.fulfilled;

      // Don't resolve the first run, let the grace period expire.
      await tickPast(ABANDON_GRACE_MS);

      expect(logs.output).to.match(
        new RegExp(`Error.*Task "${testTask.name}".*grace period`),
      );
    });

    it('handles multiple overruns', async () => {
      // The beforeEach already triggered the *first* overrun.
      await expect(firstRun.aborted).to.eventually.be.fulfilled;
      await tickPast(ABANDON_GRACE_MS);
      await expect(secondRun.started).to.eventually.be.fulfilled;

      // Trigger a third run (second overrun).
      const thirdRun = testTask.nextRun();
      await tickPast(INTERVAL_TIMEOUT_MS);
      await expect(secondRun.aborted).to.eventually.be.fulfilled;

      await expect(thirdRun.started).to.eventually.be.fulfilled;

      thirdRun.resolve();

      sinon.assert.calledThrice(testTask.run);
    });

    it('does not start a new task if disposed during an overrun grace period', async () => {
      // The beforeEach already triggered the overrun.
      // firstRun is in its grace period.
      await expect(firstRun.aborted).to.eventually.be.fulfilled;

      // Dispose *during* the grace period.
      await clock.tickAsync(ABANDON_GRACE_MS / 2);
      runner.dispose();

      // Let the rest of the grace period and any other timers finish
      await clock.runAllAsync();

      // The secondRun (which was queued) should never have started.
      expect(secondRun.started, 'Second run should not have started').to.not.be
        .fulfilled;

      // Only the very first run should have been called.
      sinon.assert.calledOnce(testTask.run);
    });
  });

  describe('timeout', () => {
    it('aborts the in-flight task', async () => {
      const runner = buildRunner();
      const run = testTask.nextRun();
      runner.start(StartMode.Immediately);
      await expect(run.started).to.eventually.be.fulfilled;

      await tickPast(TASK_TIMEOUT_MS);

      await expect(run.aborted, 'Task should be aborted on timeout').to
        .eventually.be.fulfilled;
    });

    it('logs an error message for the timeout', async () => {
      const runner = buildRunner();
      const run = testTask.nextRun();
      runner.start(StartMode.Immediately);
      await expect(run.started).to.eventually.be.fulfilled;

      await tickPast(TASK_TIMEOUT_MS);
      await expect(run.aborted).to.eventually.be.fulfilled;

      expect(logs.output).to.match(
        new RegExp(`Error.*Task "${testTask.name}".*timed out`),
      );
    });

    it('logs a second error if the timed-out task fails to complete within its grace period', async () => {
      const runner = buildRunner();
      const run = testTask.nextRun();
      runner.start(StartMode.Immediately);
      await expect(run.started).to.eventually.be.fulfilled;

      await tickPast(TASK_TIMEOUT_MS);
      await expect(run.aborted).to.eventually.be.fulfilled;

      // Don't resolve the run, let the grace period expire.
      await tickPast(ABANDON_GRACE_MS);

      expect(logs.output).to.match(
        new RegExp(`Error.*Task "${testTask.name}".*grace period`),
      );
    });

    it('does not log non-graceful error if disposed during timeout grace period', async () => {
      const runner = buildRunner();
      const run = testTask.nextRun();
      runner.start(StartMode.Immediately);
      await expect(run.started).to.eventually.be.fulfilled;

      // Trigger the timeout
      await tickPast(TASK_TIMEOUT_MS);
      await expect(run.aborted).to.eventually.be.fulfilled;

      // Dispose *during* the grace period
      await clock.tickAsync(ABANDON_GRACE_MS / 2);
      runner.dispose();

      // Let all timers finish
      await clock.runAllAsync();

      // The timeout error is expected
      expect(logs.output).to.match(
        new RegExp(`Error.*Task "${testTask.name}".*timed out`),
      );
      // The non-graceful error is *not* expected
      expect(logs.output).to.not.match(
        new RegExp(`Error.*Task "${testTask.name}".*grace period`),
      );
    });
  });

  describe('task errors', () => {
    let runner: SequentialTaskRunner;
    let run: TestRun;

    beforeEach(async () => {
      runner = buildRunner();
      run = testTask.nextRun();
      runner.start(StartMode.Immediately);
      await expect(run.started, 'First run should start immediately').to
        .eventually.be.fulfilled;
    });

    afterEach(() => {
      // Only dispose if the runner wasn't disposed in the test
      if (testTask.run.callCount > 0) {
        runner.dispose();
      }
    });

    it('logs the unhandled error from the task', async () => {
      run.reject(new Error('🤮'));
      await tickPast(ABANDON_GRACE_MS); // Allow promise to settle

      expect(logs.output).to.match(
        new RegExp(`Error.*Unhandled error.*"${testTask.name}"`),
      );
      expect(logs.output).to.match(/🤮/);
    });

    it('continues to run the task on the next interval', async () => {
      run.reject(new Error('🤮'));
      const secondRun = testTask.nextRun();
      await tickPast(INTERVAL_TIMEOUT_MS);

      await expect(secondRun.started, 'Second run should start').to.eventually
        .be.fulfilled;
      sinon.assert.calledTwice(testTask.run);
    });

    it('logs unhandled error if task rejects during grace period', async () => {
      // Trigger timeout to start grace period
      await tickPast(TASK_TIMEOUT_MS);
      await expect(run.aborted).to.eventually.be.fulfilled;

      // Reject the task *during* the grace period
      await clock.tickAsync(ABANDON_GRACE_MS / 2);
      run.reject(new Error('Failed during cleanup'));

      // Let all timers finish
      await clock.tickAsync(ABANDON_GRACE_MS / 2);

      expect(logs.output).to.match(
        new RegExp(`Error.*Unhandled error.*"${testTask.name}"`),
      );
      expect(logs.output).to.match(/Failed during cleanup/);

      // The non-graceful error is *not* expected, as the promise did settle.
      expect(logs.output).to.not.match(
        new RegExp(`Error.*Task "${testTask.name}".*grace period`),
      );
    });
  });
});
