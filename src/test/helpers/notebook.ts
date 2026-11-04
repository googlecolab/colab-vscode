/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable jsdoc/require-jsdoc */

import vscode, { NotebookCellData, NotebookEdit, NotebookRange } from 'vscode';

enum FakeNotebookCellKind {
  Markup = 1,
  Code = 2,
}

// The fake mirrors the real enum's values (the `vscode` module has no runtime
// outside the extension host) but is a distinct type to TypeScript, so it is
// presented as the real enum. `object` is the common supertype of the two.
export const NotebookCellKind =
  FakeNotebookCellKind as object as typeof vscode.NotebookCellKind;

/**
 * A test fake for {@link NotebookCellData}.
 */
export class TestNotebookCellData implements NotebookCellData {
  kind: vscode.NotebookCellKind;
  value: string;
  languageId: string;

  constructor(
    kind: vscode.NotebookCellKind,
    value: string,
    languageId: string,
  ) {
    this.kind = kind;
    this.value = value;
    this.languageId = languageId;
  }
}

/**
 * A test fake for {@link NotebookEdit}.
 */
export class TestNotebookEdit implements NotebookEdit {
  range: TestNotebookRange;
  newCells: TestNotebookCellData[];

  constructor(range: TestNotebookRange, newCells: TestNotebookCellData[]) {
    this.range = range;
    this.newCells = newCells;
  }
}

/**
 * A test fake for {@link NotebookRange}.
 */
export class TestNotebookRange implements NotebookRange {
  start: number;
  end: number;

  get isEmpty(): boolean {
    return this.start === this.end;
  }

  constructor(start: number, end: number) {
    this.start = start;
    this.end = end;
  }

  with(change: { start?: number; end?: number }): NotebookRange {
    return new TestNotebookRange(
      change.start ?? this.start,
      change.end ?? this.end,
    );
  }
}
