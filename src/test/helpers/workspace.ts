/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  NotebookEdit,
  Position,
  Range,
  SnippetTextEdit,
  TextEdit,
  Uri,
  WorkspaceEdit,
  WorkspaceEditEntryMetadata,
} from 'vscode';
import { TestNotebookEdit } from './notebook';
import { TestUri } from './uri';

export class TestWorkspaceEdit implements WorkspaceEdit {
  uri: TestUri;
  edits: readonly TestNotebookEdit[] = [];

  get size(): number {
    return this.edits.length;
  }

  replace(
    _uri: Uri,
    _range: Range,
    _newText: string,
    _metadata?: WorkspaceEditEntryMetadata,
  ): void {
    throw new Error('Method not implemented.');
  }

  insert(
    _uri: Uri,
    _position: Position,
    _newText: string,
    _metadata?: WorkspaceEditEntryMetadata,
  ): void {
    throw new Error('Method not implemented.');
  }

  delete(
    _uri: Uri,
    _range: Range,
    _metadata?: WorkspaceEditEntryMetadata,
  ): void {
    throw new Error('Method not implemented.');
  }

  has(_uri: Uri): boolean {
    throw new Error('Method not implemented.');
  }

  /* eslint-disable @typescript-eslint/unified-signatures */
  set(uri: Uri, edits: readonly (TextEdit | SnippetTextEdit)[]): void;
  set(
    uri: Uri,
    edits: readonly [
      TextEdit | SnippetTextEdit,
      WorkspaceEditEntryMetadata | undefined,
    ][],
  ): void;
  set(uri: Uri, edits: readonly NotebookEdit[]): void;
  set(
    uri: Uri,
    edits: readonly [NotebookEdit, WorkspaceEditEntryMetadata | undefined][],
  ): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set(uri: Uri, edits: readonly any[]): void {
    this.uri = uri as TestUri;
    this.edits = edits as TestNotebookEdit[];
  }
  /* eslint-enable @typescript-eslint/unified-signatures */

  get(_uri: Uri): TextEdit[] {
    throw new Error('Method not implemented.');
  }

  entries(): [Uri, TextEdit[]][] {
    throw new Error('Method not implemented.');
  }

  createFile(
    _uri: Uri,
    _options?: {
      readonly overwrite?: boolean;
      readonly ignoreIfExists?: boolean;
    },
    _metadata?: WorkspaceEditEntryMetadata,
  ): void {
    throw new Error('Method not implemented.');
  }

  deleteFile(
    _uri: Uri,
    _options?: {
      readonly recursive?: boolean;
      readonly ignoreIfNotExists?: boolean;
    },
    _metadata?: WorkspaceEditEntryMetadata,
  ): void {
    throw new Error('Method not implemented.');
  }

  renameFile(
    _oldUri: Uri,
    _newUri: Uri,
    _options?: {
      readonly overwrite?: boolean;
      readonly ignoreIfExists?: boolean;
    },
    _metadata?: WorkspaceEditEntryMetadata,
  ): void {
    throw new Error('Method not implemented.');
  }

  [Symbol.iterator](): IterableIterator<[Uri, (TextEdit | NotebookEdit)[]]> {
    throw new Error('Method not implemented.');
  }
}
