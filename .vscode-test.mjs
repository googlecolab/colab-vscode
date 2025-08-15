/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// vscode-test looks for a .vscode-test.js/mjs/cjs file relative to the current
// working directory. This file provides the configuration for the test runner,
// and you can find the entire definition here.

import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out/test/**/*vscode.test.js",
  installExtensions: ["google.colab"],
});
