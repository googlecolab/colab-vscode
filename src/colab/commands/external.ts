/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from "vscode";

/** Opens Colab in the browser. */
export function openColabWeb(vs: typeof vscode) {
  vs.env.openExternal(vs.Uri.parse("https://colab.research.google.com"));
}

/** Opens the Colab signup page in the browser. */
export function openColabSignup(vs: typeof vscode) {
  vs.env.openExternal(vs.Uri.parse("https://colab.research.google.com/signup"));
}
