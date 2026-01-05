/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ThemeColor, ThemeIcon } from 'vscode';

/**
 * A test double for {@link ThemeIcon}.
 */
export class TestThemeIcon implements ThemeIcon {
  constructor(
    readonly id: string,
    readonly color?: ThemeColor,
  ) {}

  static readonly File = new TestThemeIcon('file');
  static readonly Folder = new TestThemeIcon('folder');
}
