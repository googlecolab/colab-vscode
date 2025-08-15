/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const isDebugMode = process.argv.includes("--debug");
module.exports = {
  timeout: isDebugMode ? 99999999 : "2m",
};
