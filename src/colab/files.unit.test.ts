/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import { describe } from 'mocha';
import { TestUri } from '../test/helpers/uri';
import { newVsCodeStub, VsCodeStub } from '../test/helpers/vscode';
import { buildColabFileUri } from './files';
import { Variant } from './types';

const DEFAULT_SERVER = {
  id: 'r-abc123',
  label: 'foo',
  variant: Variant.DEFAULT,
  accelerator: undefined,
  endpoint: 'm-s-foo',
  connectionInformation: {
    baseUrl: TestUri.parse('https://example.com'),
    token: '123',
    tokenExpiry: new Date(Date.now() + 1000 * 60 * 60),
    headers: { foo: 'bar' },
  },
  dateAssigned: new Date(),
};

describe('files', () => {
  describe('buildColabFileUri', () => {
    let vs: VsCodeStub;

    beforeEach(() => {
      vs = newVsCodeStub();
    });

    it('builds root URIs when no file path is provided', () => {
      expect(
        buildColabFileUri(vs.asVsCode(), DEFAULT_SERVER).toString(),
      ).to.equal('colab://r-abc123/');
    });

    it('builds file URIs', () => {
      expect(
        buildColabFileUri(vs.asVsCode(), DEFAULT_SERVER, 'foo.txt').toString(),
      ).to.equal('colab://r-abc123/foo.txt');
    });

    it('builds relative file URIs', () => {
      expect(
        buildColabFileUri(
          vs.asVsCode(),
          DEFAULT_SERVER,
          'foo/../bar.txt',
        ).toString(),
      ).to.equal('colab://r-abc123/bar.txt');
    });
  });
});
