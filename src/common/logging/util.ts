/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ActionableLogLevel, LogLevel } from ".";

/**
 * Builds a log prefix containing a timestamp and log level.
 *
 * @param level - The log level to include in the prefix.
 * @returns The formatted prefix string, e.g.
 *          "[2025-10-22T19:22:35.375Z] [Warning]".
 */
export function buildTimestampLevelPrefix(level: ActionableLogLevel): string {
  const timestamp = new Date().toISOString();
  const levelStr = getLogLevelString(level);
  return `[${timestamp}] [${levelStr}]`;
}

const LOG_LEVEL_STRING_MAP: Record<ActionableLogLevel, string> = {
  [LogLevel.Trace]: "Trace",
  [LogLevel.Debug]: "Debug",
  [LogLevel.Info]: "Info",
  [LogLevel.Warning]: "Warning",
  [LogLevel.Error]: "Error",
};

/**
 * Gets the string representation for a {@link LogLevel}.
 */
function getLogLevelString(level: ActionableLogLevel): string {
  return LOG_LEVEL_STRING_MAP[level];
}
