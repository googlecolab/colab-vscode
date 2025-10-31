/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Disposable } from "vscode";
import { log } from "./logging";

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

/**
 * Manages a resource that is created asynchronously and can be turned on and
 * off. It handles the race condition between initialization and toggling on and
 * off.
 */
export abstract class AsyncToggleable<T extends Disposable>
  implements Toggleable, Disposable
{
  private resource: T | undefined = undefined;
  private inFlightTurnOn: AbortController | undefined;
  protected initializationComplete: Promise<void> | undefined;

  /**
   * The asynchronous operation that creates and initializes the resource.
   * @param signal - Aborts if off is called during initialization.
   */
  protected abstract initialize(signal: AbortSignal): Promise<T>;

  /**
   * Toggles the component on by initializing the resource.
   * No-ops if already on.
   * If `off()` is called during initialization, it is aborted.
   */
  on() {
    if (this.inFlightTurnOn) {
      return;
    }
    this.inFlightTurnOn = new AbortController();
    this.initializationComplete = this.initialize(this.inFlightTurnOn.signal)
      .then((resource) => {
        if (!this.inFlightTurnOn || this.inFlightTurnOn.signal.aborted) {
          log.trace("Initialization aborted, disposing resource");
          resource.dispose();
          return;
        }
        this.resource = resource;
      })
      .catch((err: unknown) => {
        if (!this.inFlightTurnOn || this.inFlightTurnOn.signal.aborted) {
          log.trace("Initialization aborted by error");
        } else {
          log.error(`Unable to initialize ${this.constructor.name}`, err);
        }
        throw err;
      })
      .finally(() => {
        this.inFlightTurnOn = undefined;
      });
  }

  /**
   * Turns the component off.
   * If initialization is in progress, it aborts it.
   * Any existing resource is disposed.
   */
  off() {
    if (this.inFlightTurnOn) {
      this.inFlightTurnOn.abort(
        new Error(
          `${this.constructor.name} turned off while it was turning on`,
        ),
      );
      this.inFlightTurnOn = undefined;
    }
    this.resource?.dispose();
    this.resource = undefined;
  }

  /**
   * Disposes the component by turning it off.
   */
  dispose() {
    this.off();
  }
}
