/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildTimestampLevelPrefix } from './util';
import { ActionableLogLevel, Logger, LogLevel } from '.';

/**
 * A logger that emits to the global {@link console}.
 *
 * Leans on the console's built-in rich formatting in the debug console.
 */
export class ConsoleLogger implements Logger {
  /**
   * Emits an error message to the console.
   *
   * @param msg - The message text.
   * @param args - The arguments provided.
   */
  error(msg: string, ...args: unknown[]): void {
    this.log(LogLevel.Error, msg, ...args);
  }
  /**
   * Emits a warning message to the console.
   *
   * @param msg - The message text.
   * @param args - The arguments to include.
   */
  warn(msg: string, ...args: unknown[]): void {
    this.log(LogLevel.Warning, msg, ...args);
  }
  /**
   * Emits an informational message to the console.
   *
   * @param msg - The message text.
   * @param args - The arguments to include.
   */
  info(msg: string, ...args: unknown[]): void {
    this.log(LogLevel.Info, msg, ...args);
  }
  /**
   * Emits a debug message to the console.
   *
   * @param msg - The message text.
   * @param args - The arguments to include.
   */
  debug(msg: string, ...args: unknown[]): void {
    this.log(LogLevel.Debug, msg, ...args);
  }
  /**
   * Emits a trace message to the console.
   *
   * @param msg - The message text.
   * @param args - The arguments to include.
   */
  trace(msg: string, ...args: unknown[]): void {
    this.log(LogLevel.Trace, msg, ...args);
  }

  private log(
    level: ActionableLogLevel,
    msg: string,
    ...args: unknown[]
  ): void {
    const prefix = buildTimestampLevelPrefix(level);
    let consoleLog: typeof console.info;
    switch (level) {
      case LogLevel.Error:
        consoleLog = console.error;
        break;
      case LogLevel.Warning:
        consoleLog = console.warn;
        break;
      case LogLevel.Info:
        consoleLog = console.info;
        break;
      case LogLevel.Debug:
        consoleLog = console.debug;
        break;
      case LogLevel.Trace:
        consoleLog = console.trace;
        break;
    }

    consoleLog(`${prefix} ${msg}`, ...args);
  }
}
