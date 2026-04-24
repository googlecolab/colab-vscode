/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { MochaOptions } from 'vscode-extension-tester';

const isDebugMode = process.argv.includes('--debug');

const options: MochaOptions = {
  // 4 minutes. Generous so cold-start budgets used by individual waits
  // (e.g. CELL_EXECUTION_WAIT_MS=60s, CONNECT_DRIVE_DIALOG_WAIT_MS=90s)
  // can compose without consuming the whole per-test budget.
  timeout: isDebugMode ? 0 : 240000,
};

export = options;
