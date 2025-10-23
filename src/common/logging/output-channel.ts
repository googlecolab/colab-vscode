/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OutputChannel } from "vscode";
import { buildTimestampLevelPrefix } from "./util";
import { ActionableLogLevel, Logger, LogLevel } from ".";

/**
 * A logger that appends to the provided VS Code {@link OutputChannel}.
 */
export class OutputChannelLogger implements Logger {
  constructor(private readonly channel: OutputChannel) {}

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
  // TODO: Consider implementing a trace decorator which logs the decorated
  // function call, its args, the return value and optionally the execution
  // time.
  trace(msg: string, ...args: unknown[]): void {
    this.log(LogLevel.Trace, msg, ...args);
  }

  private log(
    level: ActionableLogLevel,
    msg: string,
    ...args: unknown[]
  ): void {
    this.channel.appendLine(format(level, msg, args));
  }
}

function format(
  level: ActionableLogLevel,
  message: string,
  args: unknown[],
): string {
  const prefix = buildTimestampLevelPrefix(level);
  const padding = " ".repeat(prefix.length + 1);

  let res = `${prefix} ${message}`;

  for (const arg of args) {
    let argsStr: string;

    if (arg instanceof Error) {
      argsStr = arg.stack ?? arg.message;
    } else if (typeof arg === "object" && arg !== null) {
      try {
        argsStr = JSON.stringify(arg, null, 2);
      } catch (_: unknown) {
        argsStr = "[Unserializable Object]";
      }
    } else {
      // Simply convert primitives to a string.
      argsStr = String(arg);
    }

    res += `\n${padding}${argsStr.split("\n").join(`\n${padding}`)}`;
  }

  return res;
}
