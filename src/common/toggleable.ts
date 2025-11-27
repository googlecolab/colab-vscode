/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { LatestCancelable } from "./async";

/**
 * An entity which can be turned "on" and "off".
 */
export interface Toggleable {
  /**
   * Turn on the toggle.
   */
  on(): void;

  /**
   * Turn off the toggle.
   */
  off(): void;
}

type ToggleDirection = Lowercase<keyof Toggleable>;

/**
 * Manages toggling on and off asynchronously.
 *
 * Derived classes are responsible for object lifecycle of any resources created
 * when toggling.
 */
export abstract class AsyncToggle implements Toggleable {
  private lastToggle?: "on" | "off";
  private runner = new LatestCancelable<[ToggleDirection]>(
    "AsyncToggle",
    async (to, signal) => {
      if (this.lastToggle === to) {
        return;
      }
      this.lastToggle = to;
      switch (to) {
        case "on":
          await this.turnOn(signal);
          break;
        case "off":
          await this.turnOff(signal);
          break;
      }
    },
  );

  on(): void {
    void this.runner.run("on");
  }
  off(): void {
    void this.runner.run("off");
  }

  protected abstract turnOn(signal: AbortSignal): Promise<void>;
  protected abstract turnOff(signal: AbortSignal): Promise<void>;
}
