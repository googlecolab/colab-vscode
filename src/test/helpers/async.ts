/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AsyncToggle } from '../../common/toggleable';

/**
 * Flushes any pending microtasks, allowing any pending async operations to
 * complete.
 */
export async function flush() {
  await Promise.resolve();
}

/**
 * A simple Deferred promise helper.
 *
 * This is useful for testing async code, allowing you to create a promise and
 * control when it resolves or rejects
 */
export class Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;

  /**
   * Initializes a new instance.
   */
  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

/**
 * A handle for an individual call.
 */
export interface ControllableCall {
  /**
   * Wait for the method to start.
   */
  waitForStart(): Promise<void>;

  /**
   * Wait for the method to complete.
   */
  waitForCompletion(): Promise<void>;
}

/**
 * A spy for a method whose lifecycle of handled calls can be controlled.
 */
export interface ControllableMethod {
  /**
   * Get the handle for a specific invocation.
   *
   * Creates it if it doesn't exist yet (allowing you to pre-fetch handles)
   *
   * @param index - The (0-based) index of the call to get when spying on a
   * method.
   */
  call(index: number): ControllableCall;

  /**
   * Get the call count for the method.
   */
  get callCount(): number;
}

/**
 * Simplifies testing {@link AsyncToggle}s by wrapping the protected methods to
 * turn on and off which enables tests to easily wait for the corresponding
 * execution lifecycle.
 */
export class ControllableAsyncToggle {
  private _turnOn: ControllableMethod;
  private _turnOff: ControllableMethod;
  private openInstance: PublicToggle;

  /**
   * Initializes a new instance.
   *
   * @param instance - The Instance.
   */
  constructor(instance: AsyncToggle) {
    // Cast to be able to wrap protected member so the async toggles are
    // controllable.
    this.openInstance = instance as PublicToggle;
    this._turnOn = this.wrap('turnOn');
    this._turnOff = this.wrap('turnOff');
  }

  /**
   * Get the handle to turn on to controllable.
   *
   * @returns The controllable method for the turn on operation.
   */
  get turnOn(): ControllableMethod {
    return this._turnOn;
  }

  /**
   * Get the handle to turn off to controllable.
   *
   * @returns The controllable method for the turn off operation.
   */
  get turnOff(): ControllableMethod {
    return this._turnOff;
  }

  private wrap(methodName: 'turnOn' | 'turnOff'): ControllableMethod {
    const originalMethod = this.openInstance[methodName].bind(
      this.openInstance,
    );
    const spy = new MethodSpyImpl();

    this.openInstance[methodName] = async (signal) => {
      // The handle for this invocation.
      const handle = spy.next();

      // The async method has been invoked.
      handle.started.resolve();

      try {
        await originalMethod(signal);
      } finally {
        // In both success and failure cases, mark the method as completed.
        handle.completed.resolve();
      }
    };
    return spy;
  }
}

/**
 * Lift the protected methods tests need to control to public, to enable safer
 * stubbing over the protected members.
 */
abstract class PublicToggle extends AsyncToggle {
  abstract override turnOn(signal: AbortSignal): Promise<void>;
  abstract override turnOff(signal: AbortSignal): Promise<void>;
}

/**
 * A handle for an individual call.
 */
class CallHandleImpl implements ControllableCall {
  started = new Deferred<void>();
  completed = new Deferred<void>();

  /**
   * Wait for the method to start.
   *
   * @returns A promise that resolves when the method starts.
   */
  async waitForStart() {
    return this.started.promise;
  }

  /**
   * Wait for the method to complete.
   *
   * @returns A promise that resolves when the method completes.
   */
  async waitForCompletion() {
    return this.completed.promise;
  }
}

/**
 * The spy for all calls to a method.
 */
class MethodSpyImpl implements ControllableMethod {
  private calls: CallHandleImpl[] = [];
  private count = 0;

  // Get the handle for a specific invocation (0-based index)
  // Creates it if it doesn't exist yet (allowing you to pre-fetch handles)
  call(index: number): CallHandleImpl {
    if (!this.calls[index]) {
      this.calls[index] = new CallHandleImpl();
    }
    return this.calls[index];
  }

  get callCount(): number {
    return this.count;
  }

  next(): CallHandleImpl {
    return this.call(this.count++);
  }
}
