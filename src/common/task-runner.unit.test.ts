/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import sinon, { SinonFakeTimers } from "sinon";
import { OverrunPolicy, SequentialTaskRunner } from "./task-runner";

const INTERVAL_TIMEOUT_MS = 1000;
const TASK_TIMEOUT_MS = 100;
const ABORTING_TASK = async (signal?: AbortSignal): Promise<void> =>
  new Promise((_, reject) => {
    signal?.addEventListener("abort", () => {
      reject(new Error("Aborted"));
    });
  });

function buildRunner(
  task: (signal: AbortSignal) => Promise<void>,
  overrun: OverrunPolicy = OverrunPolicy.AllowToComplete,
  config = {
    intervalTimeoutMs: INTERVAL_TIMEOUT_MS,
    taskTimeoutMs: TASK_TIMEOUT_MS,
  },
): SequentialTaskRunner {
  return new SequentialTaskRunner(config, task, overrun);
}

describe("SequentialTaskRunner", () => {
  let clock: SinonFakeTimers;

  async function tickPast(ms: number) {
    await clock.tickAsync(ms + 1);
  }

  beforeEach(() => {
    clock = sinon.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "setTimeout"],
    });
  });

  afterEach(() => {
    clock.restore();
  });

  describe("lifecycle", () => {
    let task: sinon.SinonStub<[signal: AbortSignal], Promise<void>>;
    let runner: SequentialTaskRunner;

    beforeEach(() => {
      task = sinon.stub();
      runner = buildRunner(task, OverrunPolicy.AllowToComplete);
    });

    afterEach(() => {
      runner.dispose();
    });

    it("runs the task when initialized", async () => {
      await clock.runToLastAsync();

      sinon.assert.calledOnce(task);
    });

    it("clears the interval when disposed", async () => {
      runner.dispose();

      await tickPast(INTERVAL_TIMEOUT_MS);

      sinon.assert.notCalled(task);
    });

    it("aborts in flight tasks when disposed", async () => {
      const onDidAbort: sinon.SinonStub<[Event], void> = sinon.stub();
      task.onFirstCall().callsFake(async (signal) => {
        signal.addEventListener("abort", onDidAbort);
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        return new Promise(() => {});
      });
      await tickPast(INTERVAL_TIMEOUT_MS);

      runner.dispose();

      sinon.assert.calledOnce(task);
      sinon.assert.calledOnce(onDidAbort);
    });
  });

  describe("each interval", () => {
    let task: sinon.SinonStub<[signal: AbortSignal], Promise<void>>;

    beforeEach(() => {
      task = sinon.stub();
    });

    it("runs the task", async () => {
      const runner = buildRunner(task, OverrunPolicy.AllowToComplete);

      await tickPast(INTERVAL_TIMEOUT_MS);
      await tickPast(INTERVAL_TIMEOUT_MS);
      await tickPast(INTERVAL_TIMEOUT_MS);

      sinon.assert.calledThrice(task);
      runner.dispose();
    });

    it("allows in flight overrun tasks to run when configured", async () => {
      task.onFirstCall().callsFake(ABORTING_TASK);
      const runner = buildRunner(task, OverrunPolicy.AllowToComplete, {
        intervalTimeoutMs: INTERVAL_TIMEOUT_MS,
        taskTimeoutMs: INTERVAL_TIMEOUT_MS * 2,
      });

      await tickPast(INTERVAL_TIMEOUT_MS);
      await tickPast(INTERVAL_TIMEOUT_MS);

      sinon.assert.calledOnce(task);
      runner.dispose();
    });

    it("abandons in flight overrun tasks and runs again when configured", async () => {
      task.onFirstCall().callsFake(ABORTING_TASK);
      const runner = buildRunner(task, OverrunPolicy.AbandonAndRun, {
        intervalTimeoutMs: INTERVAL_TIMEOUT_MS,
        taskTimeoutMs: INTERVAL_TIMEOUT_MS * 2,
      });

      await tickPast(INTERVAL_TIMEOUT_MS);
      await tickPast(INTERVAL_TIMEOUT_MS);

      sinon.assert.calledTwice(task);
      runner.dispose();
    });

    it("aborts timed out tasks", async () => {
      const onDidAbort: sinon.SinonStub<[Event], void> = sinon.stub();
      task.callsFake(async (signal) => {
        signal.addEventListener("abort", onDidAbort);
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        return new Promise(() => {});
      });
      const runner = buildRunner(task, OverrunPolicy.AllowToComplete);

      await tickPast(INTERVAL_TIMEOUT_MS);
      await tickPast(TASK_TIMEOUT_MS);

      sinon.assert.calledOnce(task);
      sinon.assert.calledOnce(onDidAbort);
      runner.dispose();
    });
  });
});
