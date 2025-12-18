/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Uri } from 'vscode';

export class TestFileSystemError extends Error {
  static FileExists(messageOrUri?: string | Uri): TestFileSystemError {
    return new TestFileSystemError('FileExists', messageOrUri);
  }
  static FileNotFound(messageOrUri?: string | Uri): TestFileSystemError {
    return new TestFileSystemError('FileNotFound', messageOrUri);
  }
  static FileNotADirectory(messageOrUri?: string | Uri): TestFileSystemError {
    return new TestFileSystemError('FileNotADirectory', messageOrUri);
  }
  static FileIsADirectory(messageOrUri?: string | Uri): TestFileSystemError {
    return new TestFileSystemError('FileIsADirectory', messageOrUri);
  }
  static NoPermissions(messageOrUri?: string | Uri): TestFileSystemError {
    return new TestFileSystemError('NoPermissions', messageOrUri);
  }
  static Unavailable(messageOrUri?: string | Uri): TestFileSystemError {
    return new TestFileSystemError('Unavailable', messageOrUri);
  }

  constructor(
    readonly code: string,
    uriOrMessage?: string | Uri,
  ) {
    uriOrMessage ??= 'Unknown';
    const message =
      typeof uriOrMessage === 'string' ? uriOrMessage : uriOrMessage.toString();
    super(`${code}: ${message}`);

    this.name = code;
  }
}
