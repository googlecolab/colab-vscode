/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from "chai";
import sinon from "sinon";
import { Deferred } from "../test/helpers/async";
import { ColabLogWatcher } from "../test/helpers/logging";
import { newVsCodeStub } from "../test/helpers/vscode";
import { LatestCancelable } from "./async";
import { LogLevel } from "./logging";

describe("LatestCancelable", () => {
  let logs: ColabLogWatcher;
  let worker: sinon.SinonStub<[...unknown[], AbortSignal], Promise<void>>;
  let cancelable: LatestCancelable<unknown[]>;

  beforeEach(() => {
    logs = new ColabLogWatcher(newVsCodeStub(), LogLevel.Trace);
    worker = sinon.stub();
    cancelable = new LatestCancelable("test-worker", worker);
  });

  afterEach(() => {
    logs.dispose();
  });

  it("should run the worker", async () => {
    worker.resolves();

    await cancelable.run();
    sinon.assert.calledOnce(worker);
  });

  it("should cancel previous worker and not affect the running state of a new task", async () => {
    const firstRunStarted = new Deferred<void>();
    const firstRunCompleter = new Deferred<void>();
    const secondRunStarted = new Deferred<void>();
    const secondRunCompleter = new Deferred<void>();

    worker
      .onFirstCall()
      .callsFake(async (...args: [...unknown[], AbortSignal]) => {
        firstRunStarted.resolve();
        const signal = args.pop() as AbortSignal;
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            resolve();
          });
        });
        await firstRunCompleter.promise;
      });

    worker.onSecondCall().callsFake(async () => {
      secondRunStarted.resolve();
      await secondRunCompleter.promise;
    });

    const firstPromise = cancelable.run();
    await firstRunStarted.promise;

    const secondPromise = cancelable.run();
    await secondRunStarted.promise;

    expect(cancelable.isRunning()).to.be.true;

    firstRunCompleter.resolve();
    await firstPromise;

    expect(cancelable.isRunning()).to.be.true;

    secondRunCompleter.resolve();
    await secondPromise;

    expect(cancelable.isRunning()).to.be.false;
    sinon.assert.calledTwice(worker);
    const firstSignal = worker.firstCall.args[0] as AbortSignal;
    expect(firstSignal.aborted).to.be.true;
  });

  it("should be a no-op when cancelling and no task is running", () => {
    expect(() => {
      cancelable.cancel();
    }).to.not.throw();
  });

  it("should forward arguments to the worker", async () => {
    worker.resolves();
    await cancelable.run("foo", 123);
    sinon.assert.calledOnceWithExactly(worker, "foo", 123, sinon.match.any);
  });

  it("should report running state correctly", async () => {
    const d = new Deferred<void>();
    const workerStarted = new Deferred<void>();
    worker.callsFake(async () => {
      workerStarted.resolve();
      await d.promise;
    });

    expect(cancelable.isRunning()).to.be.false;

    const promise = cancelable.run();

    await workerStarted.promise;
    expect(cancelable.isRunning()).to.be.true;

    d.resolve();
    await promise;

    expect(cancelable.isRunning()).to.be.false;
  });

  it("should cancel in-flight work", async () => {
    const d = new Deferred<void>();
    const workerStarted = new Deferred<void>();
    worker.callsFake(async (...args) => {
      workerStarted.resolve();
      const signal = args.pop() as AbortSignal;
      signal.addEventListener("abort", () => {
        d.resolve();
      });
      await d.promise;
    });

    const promise = cancelable.run();
    await workerStarted.promise;
    expect(cancelable.isRunning()).to.be.true;

    cancelable.cancel();

    await d.promise;
    await promise;

    const signal = worker.firstCall.args[0] as AbortSignal;
    expect(signal.aborted).to.be.true;
    expect(cancelable.isRunning()).to.be.false;
  });

  it("should handle errors gracefully", async () => {
    worker.rejects(new Error("🤮"));
    await cancelable.run();
    expect(logs.output).to.match(/LatestCancelable worker error/);
  });

  it("should ignore abort errors", async () => {
    worker.callsFake((...args) => {
      const signal = args.pop() as AbortSignal;
      return new Promise((_resolve, reject) => {
        const err = new Error("AbortError");
        err.name = "AbortError";
        signal.addEventListener("abort", () => {
          reject(err);
        });
      });
    });

    const promise = cancelable.run();
    cancelable.cancel();

    await promise;
    expect(logs.output).to.not.match(/LatestCancelable worker error/);
  });
});
