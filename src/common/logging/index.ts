/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode';
import { Disposable, ExtensionMode } from 'vscode';
import { ConsoleLogger } from './console';
import { OutputChannelLogger } from './output-channel';

/**
 * Supports logging a message at varying severity levels.
 */
export interface Logger {
  /**
   * Emits an error log.
   *
   * @param msg - The log text.
   * @param args - The arguments to include.
   */
  error(msg: string, ...args: unknown[]): void;

  /**
   * Emits a warning log.
   *
   * @param msg - The log text.
   * @param args - The arguments to include.
   */
  warn(msg: string, ...args: unknown[]): void;

  /**
   * Emits an info log.
   *
   * @param msg - The log text.
   * @param args - The arguments to include.
   */
  info(msg: string, ...args: unknown[]): void;

  /**
   * Emits a debug log.
   *
   * @param msg - The log text.
   * @param args - The arguments to include.
   */
  debug(msg: string, ...args: unknown[]): void;

  /**
   * Emits a trace log.
   *
   * @param msg - The message text.
   * @param args - The arguments to include.
   */
  trace(msg: string, ...args: unknown[]): void;
}

/**
 * The various log levels.
 */
export enum LogLevel {
  /** Nothing is logged. */
  Off = 0,
  /** Trace logs and higher (debug, info, warning, error). */
  Trace = 1,
  /** Debug logs and higher (info, warning, error). */
  Debug = 2,
  /** Info logs and higher (warning, error). */
  Info = 3,
  /** Warning logs and higher (error). */
  Warning = 4,
  /** Error logs. */
  Error = 5,
}

/**
 * The various log levels which emit logs.
 */
export type ActionableLogLevel = Exclude<LogLevel, LogLevel.Off>;

/** The configured log level. */
let level: LogLevel = LogLevel.Info;

const loggers: Logger[] = [];

/**
 * Initializes the global logger with the appropriate loggers based on the
 * extension mode.
 *
 * @param vs - The VS Code API instance.
 * @param mode - The operation mode.
 * @returns A disposable to clean up resources when the logger is no longer
 * needed.
 */
export function initializeLogger(
  vs: typeof vscode,
  mode: ExtensionMode,
): Disposable {
  if (loggers.length > 0) {
    throw new Error('Loggers have already been initialized.');
  }

  level = getConfiguredLogLevel(vs);
  const configListener = vs.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('colab.logging')) {
      level = getConfiguredLogLevel(vs);
    }
  });

  // Create the output channel once.
  const outputChannel = vs.window.createOutputChannel('Colab');
  loggers.push(new OutputChannelLogger(outputChannel));

  if (mode === vs.ExtensionMode.Development) {
    outputChannel.show(true);
    loggers.push(new ConsoleLogger());
  }

  return {
    dispose: () => {
      configListener.dispose();
      outputChannel.dispose();
      loggers.length = 0;
    },
  };
}

/**
 * Gets the current configured log level.
 *
 * @returns The current {@link LogLevel}.
 */
export function getLevel(): LogLevel {
  return level;
}

/**
 * The global logger instance.
 *
 * Can be used directly after calling `initializeLogger()`.
 */
export const log: Logger = {
  error: (msg: string, ...args: unknown[]) => {
    doLog(LogLevel.Error, 'error', msg, ...args);
  },
  warn: (msg: string, ...args: unknown[]) => {
    doLog(LogLevel.Warning, 'warn', msg, ...args);
  },
  info: (msg: string, ...args: unknown[]) => {
    doLog(LogLevel.Info, 'info', msg, ...args);
  },
  debug: (msg: string, ...args: unknown[]) => {
    doLog(LogLevel.Debug, 'debug', msg, ...args);
  },
  trace: (msg: string, ...args: unknown[]) => {
    doLog(LogLevel.Trace, 'trace', msg, ...args);
  },
};

function doLog(
  threshold: LogLevel,
  method: keyof Logger,
  msg: string,
  ...args: unknown[]
): void {
  if (loggers.length === 0) {
    return;
  }
  if (level === LogLevel.Off || level > threshold) {
    return;
  }
  for (const l of loggers) {
    l[method](msg, ...args);
  }
}

const LOG_CONFIG_TO_LEVEL: Record<
  Lowercase<keyof typeof LogLevel>,
  LogLevel
> = {
  off: LogLevel.Off,
  trace: LogLevel.Trace,
  debug: LogLevel.Debug,
  info: LogLevel.Info,
  warning: LogLevel.Warning,
  error: LogLevel.Error,
};

function getConfiguredLogLevel(vs: typeof vscode): LogLevel {
  const configLevel = vs.workspace
    .getConfiguration('colab.logging')
    .get<Lowercase<keyof typeof LogLevel>>('level', 'info');

  return LOG_CONFIG_TO_LEVEL[configLevel];
}
