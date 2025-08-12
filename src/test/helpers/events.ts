/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from "vscode";

export class TestEventEmitter<T> implements vscode.EventEmitter<T> {
  private listeners = new Set<(data: T) => void>();
  private disposed = false;

  constructor() {
    this.event = (listener: (data: T) => void) => {
      if (this.disposed) {
        throw new Error("EventEmitter has been disposed");
      }
      this.listeners.add(listener);

      return {
        dispose: () => {
          this.listeners.delete(listener);
        },
      };
    };
  }

  readonly event: (listener: (data: T) => void) => { dispose: () => void };

  fire(data: T): void {
    if (this.disposed) {
      throw new Error("EventEmitter has been disposed");
    }

    for (const listener of this.listeners) {
      listener(data);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
}
