/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/**/*vscode.test.js',
  installExtensions: ['ms-toolsai.jupyter'],
  version: 'insiders',
  launchArgs: [
    '--disable-telemetry',
    '--skip-welcome',
    '--skip-release-notes',
    '--install-extension',
    'ms-toolsai.jupyter',
  ],
  mocha: {
    ui: 'bdd',
    timeout: 5000,
    require: ['./out/test/test/test-setup.js'],
  },
});
