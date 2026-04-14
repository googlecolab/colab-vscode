/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import { describe, it } from 'mocha';
import { TestUri } from './uri';

describe('TestUri', () => {
  describe('joinPath', () => {
    it('uses forward slashes for URI paths', () => {
      const base = TestUri.parse('colab://m-s-foo/content');

      expect(TestUri.joinPath(base, 'foo', 'bar.txt').toString()).to.equal(
        'colab://m-s-foo/content/foo/bar.txt',
      );
    });

    it('normalizes backslashes in segments', () => {
      const base = TestUri.parse('colab://m-s-foo/content');

      expect(
        TestUri.joinPath(base, 'nested\\child\\file.txt').toString(),
      ).to.equal('colab://m-s-foo/content/nested/child/file.txt');
    });

    it('preserves parent traversal with POSIX semantics', () => {
      const base = TestUri.parse('colab://m-s-foo/content/folder');

      expect(TestUri.joinPath(base, '..', 'other.txt').toString()).to.equal(
        'colab://m-s-foo/content/other.txt',
      );
    });
  });
});
