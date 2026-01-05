/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const isDebugMode = process.argv.includes('--debug');
module.exports = {
  timeout: isDebugMode ? 99999999 : '2m',
};
