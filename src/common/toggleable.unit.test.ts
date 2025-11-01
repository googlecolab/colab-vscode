/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from "chai";
import sinon from "sinon";
import { Disposable } from "vscode";
import { ColabLogWatcher } from "../test/helpers/logging";
import { newVsCodeStub } from "../test/helpers/vscode";
import { LogLevel } from "./logging";
import { AsyncToggleable } from "./toggleable";

interface TestInitialization {
  started: Promise<void>;
  resolve: (disposable: Disposable) => void;
  reject: (reason: unknown) => void;
  aborted: Promise<void>;
}

class TestToggleable extends AsyncToggleable<Disposable> {
  readonly initializeStub = sinon.stub<[AbortSignal], Promise<Disposable>>();
  // Promote to public for async hooks in tests.
  declare initializationComplete;

  nextInitialization(): TestInitialization {
    let abortResolver: () => void;
    const aborted = new Promise<void>((resolve) => {
      abortResolver = resolve;
    });

    const callIndex = this.initializeStub.callCount;
    let resolveInit: (disposable: Disposable) => void = () => {
      throw new Error("Test setup error: cannot resolve before start");
    };
    let rejectInit: (reason: unknown) => void = () => {
      throw new Error("Test setup error: cannot reject before start");
    };

    const started = new Promise<void>((resolveStarted) => {
      this.initializeStub.onCall(callIndex).callsFake((signal) => {
        signal.addEventListener("abort", () => {
          abortResolver();
        });

        return new Promise<Disposable>((res, rej) => {
          resolveInit = res;
          rejectInit = rej;
          resolveStarted();
        });
      });
    });

    return {
      started,
      resolve: (disposable) => {
        resolveInit(disposable);
      },
      reject: (reason) => {
        rejectInit(reason);
      },
      aborted,
    };
  }

  protected initialize(signal: AbortSignal): Promise<Disposable> {
    return this.initializeStub(signal);
  }
}

describe("AsyncToggleable", () => {
  let logs: ColabLogWatcher;
  let toggleable: TestToggleable;
  let stubResource: { dispose: sinon.SinonStub<[]> };

  beforeEach(() => {
    logs = new ColabLogWatcher(newVsCodeStub(), LogLevel.Trace);
    toggleable = new TestToggleable();
    stubResource = {
      dispose: sinon.stub(),
    };
  });

  afterEach(() => {
    toggleable.dispose();
    logs.dispose();
  });

  describe("on", () => {
    it("should initialize the resource when called", async () => {
      const init = toggleable.nextInitialization();

      toggleable.on();

      await expect(init.started).to.eventually.be.fulfilled;
      init.resolve(stubResource);
      await expect(toggleable.initializationComplete).to.eventually.be
        .fulfilled;
    });

    it("should not re-initialize if called while already turning on", async () => {
      const init = toggleable.nextInitialization();
      toggleable.on();
      await expect(init.started).to.eventually.be.fulfilled;

      toggleable.on();

      sinon.assert.calledOnce(toggleable.initializeStub);
      init.resolve(stubResource);
      await expect(toggleable.initializationComplete).to.eventually.be
        .fulfilled;
    });

    it("should cancel initialization if off is called", async () => {
      const init = toggleable.nextInitialization();
      toggleable.on();
      await expect(init.started).to.eventually.be.fulfilled;

      toggleable.off();

      await expect(init.aborted).to.eventually.be.fulfilled;
      // Resolving the promise should result in the resource being disposed.
      init.resolve(stubResource);
      await expect(toggleable.initializationComplete).to.eventually.be
        .fulfilled;
      sinon.assert.calledOnce(stubResource.dispose);
    });

    it("should handle initialization failure gracefully", async () => {
      const init = toggleable.nextInitialization();
      toggleable.on();
      await expect(init.started).to.eventually.be.fulfilled;

      init.reject(new Error("🤮"));

      await expect(toggleable.initializationComplete).to.eventually.be.rejected;
      expect(logs.output).to.match(/initialize/);
      // Verify it can be turned on again
      const secondInit = toggleable.nextInitialization();
      toggleable.on();
      await expect(secondInit.started).to.eventually.be.fulfilled;
    });

    it("should handle cancellation before a failure", async () => {
      const init = toggleable.nextInitialization();
      toggleable.on();
      await expect(init.started).to.eventually.be.fulfilled;

      toggleable.off();
      await expect(init.aborted).to.eventually.be.fulfilled;

      init.reject(new Error("🤮"));

      await expect(toggleable.initializationComplete).to.eventually.be.rejected;
      // It should be treated as an abort, not an error
      expect(logs.output).to.match(/Initialization.+aborted/);
      expect(logs.output).to.not.match(/Unable to initialize/);
    });
  });

  describe("off", () => {
    it("should dispose the resource when called", async () => {
      const init = toggleable.nextInitialization();
      toggleable.on();
      await expect(init.started).to.eventually.be.fulfilled;
      init.resolve(stubResource);
      await expect(toggleable.initializationComplete).to.eventually.be
        .fulfilled;
      sinon.assert.notCalled(stubResource.dispose);

      toggleable.off();

      sinon.assert.calledOnce(stubResource.dispose);
    });

    it("should abort in-flight initialization if called when toggling on", async () => {
      const init = toggleable.nextInitialization();
      toggleable.on();
      await expect(init.started).to.eventually.be.fulfilled;

      toggleable.off();

      await expect(init.aborted).to.eventually.be.fulfilled;
    });
  });

  describe("dispose", () => {
    it("should dispose the resource", async () => {
      const init = toggleable.nextInitialization();
      toggleable.on();
      await expect(init.started).to.eventually.be.fulfilled;
      init.resolve(stubResource);
      await expect(toggleable.initializationComplete).to.eventually.be
        .fulfilled;

      toggleable.off();

      sinon.assert.calledOnce(stubResource.dispose);
    });
  });
});
