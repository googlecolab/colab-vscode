/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from 'vscode';
import { telemetry } from '../../telemetry';
import { CommandSource } from '../../telemetry/api';

/** Opens Colab in the browser. */
export function openColabWeb(vs: typeof vscode, source: CommandSource) {
  telemetry.logOpenColabWeb(source);
  vs.env.openExternal(vs.Uri.parse('https://colab.research.google.com'));
}

/** Opens the Colab signup page in the browser. */
export function openColabSignup(vs: typeof vscode, source: CommandSource) {
  telemetry.logUpgradeToPro(source);
  vs.env.openExternal(vs.Uri.parse('https://colab.research.google.com/signup'));
}
