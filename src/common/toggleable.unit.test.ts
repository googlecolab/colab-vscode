/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import sinon from "sinon";
import { ControllableAsyncToggle, Deferred } from "../test/helpers/async";
import { ColabLogWatcher } from "../test/helpers/logging";
import { newVsCodeStub } from "../test/helpers/vscode";
import { LogLevel } from "./logging";
import { AsyncToggle } from "./toggleable";

/**
 * A derived class with the abstract methods of the SUT (AsyncToggle) stubbed.
 */
class TestToggle extends AsyncToggle {
  readonly turnOnStub: sinon.SinonStub<[AbortSignal], Promise<void>> =
    sinon.stub();
  readonly turnOffStub: sinon.SinonStub<[AbortSignal], Promise<void>> =
    sinon.stub();

  override turnOn = this.turnOnStub;
  override turnOff = this.turnOffStub;

  /**
   * Gate the completion of the asynchronous `turnOn` or `turnOff` method.
   *
   * @param turning - the direction to gate.
   */
  gate(
    turning: "turnOn" | "turnOff",
    call: number,
  ): { resolve: () => void; aborted: Promise<void> } {
    const turn = turning === "turnOn" ? this.turnOnStub : this.turnOffStub;
    const d = new Deferred<void>();
    const aborted = new Deferred<void>();
    turn.onCall(call).callsFake(async (signal: AbortSignal) => {
      signal.addEventListener("abort", () => {
        aborted.resolve();
      });
      if (signal.aborted) {
        aborted.resolve();
      }
      await d.promise;
    });
    return { resolve: d.resolve, aborted: aborted.promise };
  }
}

describe("AsyncToggle", () => {
  let logs: ColabLogWatcher;
  let toggle: TestToggle;
  let toggleSpy: ControllableAsyncToggle;

  beforeEach(() => {
    logs = new ColabLogWatcher(newVsCodeStub(), LogLevel.Trace);
    toggle = new TestToggle();
    toggleSpy = new ControllableAsyncToggle(toggle);
    toggle.turnOnStub.resolves();
    toggle.turnOffStub.resolves();
  });

  afterEach(() => {
    logs.dispose();
  });

  describe("on", () => {
    it("should turn on when called", async () => {
      toggle.on();

      await toggleSpy.turnOn.call(0).waitForCompletion();
    });

    it("should not turn on if already turning on", async () => {
      const first = toggle.gate("turnOn", 0);
      toggle.on();
      await toggleSpy.turnOn.call(0).waitForStart();

      toggle.on();
      await first.aborted;

      sinon.assert.calledOnce(toggle.turnOnStub);
    });

    it("should not turn on if already on", async () => {
      toggle.on();
      await toggleSpy.turnOn.call(0).waitForCompletion();

      toggle.on();
      // Fire a different event and wait for it to complete to ensure
      // the no-op had a chance to run.
      toggle.off();
      await toggleSpy.turnOff.call(0).waitForCompletion();

      sinon.assert.calledOnce(toggle.turnOnStub);
    });

    it("should be cancelled if off is called", async () => {
      const turnOn = toggle.gate("turnOn", 0);
      toggle.on();
      await toggleSpy.turnOn.call(0).waitForStart();

      toggle.off();
      await turnOn.aborted;
      turnOn.resolve();

      await toggleSpy.turnOff.call(0).waitForCompletion();
    });
  });

  describe("off", () => {
    it("should turn off when called", async () => {
      toggle.off();

      await toggleSpy.turnOff.call(0).waitForCompletion();
    });

    it("should not turn off if already turning off", async () => {
      const first = toggle.gate("turnOff", 0);
      toggle.off();
      await toggleSpy.turnOff.call(0).waitForStart();

      toggle.off();
      await first.aborted;

      sinon.assert.calledOnce(toggle.turnOffStub);
    });

    it("should not turn off if already off", async () => {
      toggle.off();
      await toggleSpy.turnOff.call(0).waitForCompletion();

      toggle.off();
      // Fire a different event and wait for it to complete to ensure
      // the no-op had a chance to run.
      toggle.on();
      await toggleSpy.turnOn.call(0).waitForCompletion();

      sinon.assert.calledOnce(toggle.turnOffStub);
    });

    it("should be cancelled if on is called", async () => {
      const turnOff = toggle.gate("turnOff", 0);
      toggle.off();
      await toggleSpy.turnOff.call(0).waitForStart();

      toggle.on();
      await turnOff.aborted;
      turnOff.resolve();

      await toggleSpy.turnOn.call(0).waitForCompletion();
    });
  });

  it("should handle rapid toggling", async () => {
    // Start toggling on but gate it from completing.
    const turnOn1 = toggle.gate("turnOn", 0);
    toggle.on();
    await toggleSpy.turnOn.call(0).waitForStart();

    // Toggle off before on completes.
    const turnOff1 = toggle.gate("turnOff", 0);
    toggle.off();
    await toggleSpy.turnOff.call(0).waitForStart();
    await turnOn1.aborted;
    turnOn1.resolve();

    // Toggle on to completion before off completes.
    const turnOn2 = toggle.gate("turnOn", 1);
    toggle.on();
    await toggleSpy.turnOn.call(1).waitForStart();
    await turnOff1.aborted;
    turnOff1.resolve();

    turnOn2.resolve();
    await toggleSpy.turnOn.call(1).waitForCompletion();
  });
});
