/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { buildTimestampLevelPrefix } from "./util";
import { ActionableLogLevel, Logger, LogLevel } from ".";

/**
 * A logger that emits to the global {@link console}.
 *
 * Leans on the console's built-in rich formatting in the debug console.
 */
export class ConsoleLogger implements Logger {
  error(msg: string, ...args: unknown[]): void {
    this.log(LogLevel.Error, msg, ...args);
  }
  warn(msg: string, ...args: unknown[]): void {
    this.log(LogLevel.Warning, msg, ...args);
  }
  info(msg: string, ...args: unknown[]): void {
    this.log(LogLevel.Info, msg, ...args);
  }
  debug(msg: string, ...args: unknown[]): void {
    this.log(LogLevel.Debug, msg, ...args);
  }
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
