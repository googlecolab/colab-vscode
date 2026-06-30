/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';

/**
 * Finds all TypeScript files under a directory recursively.
 *
 * @param dir - Directory path.
 * @returns a list of TypeScript file paths under the directory.
 */
export function findTsFiles(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return [];

  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      results = results.concat(findTsFiles(filePath));
    } else if (file.endsWith('.ts')) {
      results.push(filePath);
    }
  }
  return results;
}
