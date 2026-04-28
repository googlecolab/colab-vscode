/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { Disposable } from 'vscode';
import { withErrorTracking } from '../telemetry/decorators';

/**
 * Registers a VS Code command whose handler is wrapped with error tracking.
 *
 * @param vs - The VS Code API instance.
 * @param command - The unique identifier for the command.
 * @param handler - A command handler function.
 * @returns A disposable which deregisters the command on disposal.
 */
export function registerCommand<
  T extends (...args: Parameters<T>) => ReturnType<T>,
>(vs: typeof vscode, command: string, handler: T): Disposable {
  return vs.commands.registerCommand(command, withErrorTracking(handler));
}
