/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CancellationToken, CancellationTokenSource, Event } from 'vscode';
import { TestEventEmitter } from './events';

/**
 * A test fake for {@link CancellationToken}.
 */
export class TestCancellationToken implements CancellationToken {
  private _isCancellationRequested = false;
  private eventEmitter: TestEventEmitter<void>;

  /**
   * Initializes a new instance.
   *
   * @param eventEmitter - The event emitter instance.
   */
  constructor(eventEmitter: TestEventEmitter<void>) {
    this.eventEmitter = eventEmitter;
  }

  /**
   * Get whether cancellation has been requested.
   *
   * @returns Whether cancellation has been requested.
   */
  get isCancellationRequested(): boolean {
    return this._isCancellationRequested;
  }

  /**
   * Get the event that fires when cancellation is requested.
   *
   * @returns The event that fires when cancellation is requested.
   */
  get onCancellationRequested(): Event<unknown> {
    return this.eventEmitter.event;
  }

  /**
   * Cancels the token.
   */
  cancel(): void {
    if (!this._isCancellationRequested) {
      this._isCancellationRequested = true;
      this.eventEmitter.fire();
    }
  }

  /**
   * Disposes the token.
   */
  dispose(): void {
    this.eventEmitter.dispose();
  }
}

/**
 * A test fake for {@link CancellationTokenSource}.
 */
export class TestCancellationTokenSource implements CancellationTokenSource {
  private _token: TestCancellationToken;
  private disposed = false;

  /**
   * Initializes a new instance.
   */
  constructor() {
    const eventEmitter = new TestEventEmitter<void>();
    this._token = new TestCancellationToken(eventEmitter);
  }

  /**
   * Get the cancellation token.
   *
   * @returns The cancellation token.
   */
  get token(): TestCancellationToken {
    if (this.disposed) {
      throw new Error('CancellationTokenSource has been disposed');
    }
    return this._token;
  }

  /**
   * Requests cancellation on the token.
   */
  cancel(): void {
    if (this.disposed) {
      throw new Error('CancellationTokenSource has been disposed');
    }
    this._token.cancel();
  }

  /**
   * Disposes the token source.
   */
  dispose(): void {
    if (!this.disposed) {
      this._token.dispose();
      this.disposed = true;
    }
  }
}
