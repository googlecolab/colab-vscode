/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { MochaOptions } from 'vscode-extension-tester';

const isDebugMode = process.argv.includes('--debug');

const options: MochaOptions = {
  timeout: isDebugMode ? 0 : 120000 / 4, // 2 minutes
};

export = options;
