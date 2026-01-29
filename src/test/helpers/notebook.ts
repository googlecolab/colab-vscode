/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { NotebookCellData, NotebookEdit, NotebookRange } from 'vscode';

export enum NotebookCellKind {
  Markup = 1,
  Code = 2,
}

export class TestNotebookCellData implements NotebookCellData {
  kind: NotebookCellKind;
  value: string;
  languageId: string;

  constructor(kind: NotebookCellKind, value: string, languageId: string) {
    this.kind = kind;
    this.value = value;
    this.languageId = languageId;
  }
}

export class TestNotebookEdit implements NotebookEdit {
  range: TestNotebookRange;
  newCells: TestNotebookCellData[];

  constructor(range: TestNotebookRange, newCells: TestNotebookCellData[]) {
    this.range = range;
    this.newCells = newCells;
  }
}

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
