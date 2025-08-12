/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from "vscode";
import { TestEventEmitter } from "./events";

export class TestCancellationToken implements vscode.CancellationToken {
  private _isCancellationRequested = false;
  private eventEmitter: TestEventEmitter<void>;

  constructor(eventEmitter: TestEventEmitter<void>) {
    this.eventEmitter = eventEmitter;
  }

  get isCancellationRequested(): boolean {
    return this._isCancellationRequested;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get onCancellationRequested(): vscode.Event<any> {
    return this.eventEmitter.event;
  }

  cancel(): void {
    if (!this._isCancellationRequested) {
      this._isCancellationRequested = true;
      this.eventEmitter.fire();
    }
  }

  dispose(): void {
    this.eventEmitter.dispose();
  }
}

export class TestCancellationTokenSource
  implements vscode.CancellationTokenSource
{
  private _token: TestCancellationToken;
  private disposed = false;

  constructor() {
    const eventEmitter = new TestEventEmitter<void>();
    this._token = new TestCancellationToken(eventEmitter);
  }

  get token(): TestCancellationToken {
    if (this.disposed) {
      throw new Error("CancellationTokenSource has been disposed");
    }
    return this._token;
  }

  cancel(): void {
    if (this.disposed) {
      throw new Error("CancellationTokenSource has been disposed");
    }
    this._token.cancel();
  }

  dispose(): void {
    if (!this.disposed) {
      this._token.dispose();
      this.disposed = true;
    }
  }
}
