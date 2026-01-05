/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode, { FileStat, FileType } from 'vscode';
import { Contents, ContentsTypeEnum } from './generated';

/**
 * Convert from a Jupyter contents type to the VS Code {@link FileType}.
 *
 * @param vs - The vscode module.
 * @param type - the Jupyter contents type to convert.
 * @returns A {@link FileType.Directory} for a Jupyter 'directory', otherwise a
 * {@link FileType.File}.
 */
export function toFileType(
  vs: typeof vscode,
  type: ContentsTypeEnum,
): FileType {
  switch (type) {
    case 'directory':
      return vs.FileType.Directory;
    case 'notebook':
    case 'file':
    default:
      return vs.FileType.File;
  }
}

/**
 * Convert from Jupyter {@link Contents} to a VS Code {@link FileStat}.
 *
 * @param vs - The vscode module.
 * @param contents - the Jupyter contents to convert.
 * @returns A {@link FileStat} for the {@link Contents}, with missing values
 * converted to their equivalent defaults.
 */
export function toFileStat(vs: typeof vscode, contents: Contents): FileStat {
  return {
    type: toFileType(vs, contents.type),
    ctime: contents.created ? new Date(contents.created).getTime() : 0,
    mtime: contents.lastModified
      ? new Date(contents.lastModified).getTime()
      : 0,
    size: contents.size ?? 0,
  };
}

/**
 * A subtype of {@link Contents} which represents a directory. Has the `type` of
 * 'directory' and `contents` is an array of {@link Contents}.
 */
export type DirectoryContents = Omit<Contents, 'content' | 'type'> & {
  content: Contents[];
  type: 'directory';
};

/**
 * A type-guard to determine if the provided contents represent a directory.
 *
 * @param contents - the Jupyter contents to evaluate.
 * @returns a type-guard asserting the provided {@link Contents} are
 * {@link DirectoryContents}.
 */
export function isDirectoryContents(
  contents: Contents,
): contents is DirectoryContents {
  return (
    contents.type === ContentsTypeEnum.Directory &&
    Array.isArray(contents.content)
  );
}
