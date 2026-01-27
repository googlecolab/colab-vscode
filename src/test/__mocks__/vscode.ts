/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Mock vscode module for unit tests.
 * This provides minimal implementations of vscode types used in the codebase.
 */

export class EventEmitter<T> {
  private listeners = new Set<(data: T) => void>();
  private disposed = false;

  constructor() {
    this.event = (listener: (data: T) => void) => {
      if (this.disposed) {
        throw new Error('EventEmitter has been disposed');
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
      throw new Error('EventEmitter has been disposed');
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

export interface Disposable {
  dispose(): void;
}

export interface TerminalDimensions {
  columns: number;
  rows: number;
}

export interface Pseudoterminal {
  onDidWrite: (listener: (data: string) => void) => { dispose: () => void };
  onDidClose?: (listener: (exitCode: number | void) => void) => { dispose: () => void };
  open(initialDimensions: TerminalDimensions | undefined): void;
  close(): void;
  handleInput?(data: string): void;
  setDimensions?(dimensions: TerminalDimensions): void;
}
