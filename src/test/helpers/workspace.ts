/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { TestNotebookEdit } from './notebook';
import { TestUri } from './uri';

export class TestWorkspaceEdit {
  uri: TestUri;
  edits: readonly TestNotebookEdit[] = [];

  set(uri: TestUri, edits: readonly TestNotebookEdit[]): void {
    this.uri = uri;
    this.edits = edits;
  }
}
