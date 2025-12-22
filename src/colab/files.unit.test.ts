/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'crypto';
import { expect } from 'chai';
import { describe } from 'mocha';
import { TestUri } from '../test/helpers/uri';
import { newVsCodeStub, VsCodeStub } from '../test/helpers/vscode';
import { Variant } from './api';
import { buildColabFileUri } from './files';

const DEFAULT_SERVER = {
  id: randomUUID(),
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
      ).to.equal('colab://m-s-foo/');
    });

    it('builds file URIs', () => {
      expect(
        buildColabFileUri(vs.asVsCode(), DEFAULT_SERVER, 'foo.txt').toString(),
      ).to.equal('colab://m-s-foo/foo.txt');
    });
  });
});
