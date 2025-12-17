/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import { FileType, newVsCodeStub, VsCodeStub } from '../../test/helpers/vscode';
import { isDirectoryContents, toFileStat, toFileType } from './converters';
import { Contents, ContentsTypeEnum } from './generated';

describe('converters', () => {
  let vs: VsCodeStub;

  beforeEach(() => {
    vs = newVsCodeStub();
  });

  describe('toFileType', () => {
    it('converts directory type', () => {
      expect(toFileType(vs.asVsCode(), 'directory')).to.equal(
        FileType.Directory,
      );
    });

    it('converts file type', () => {
      expect(toFileType(vs.asVsCode(), 'file')).to.equal(FileType.File);
    });

    it('converts notebook type to file', () => {
      expect(toFileType(vs.asVsCode(), 'notebook')).to.equal(FileType.File);
    });
  });

  describe('toFileStat', () => {
    it('converts contents to file stat', () => {
      const created = '2025-12-16T14:30:53.932129Z';
      const lastModified = '2025-12-11T14:34:40Z';
      const contents: Contents = {
        name: 'foo.txt',
        path: 'foo.txt',
        type: ContentsTypeEnum.File,
        writable: true,
        created,
        lastModified,
        size: 123,
        mimetype: 'text/plain',
        content: '',
        format: 'text',
      };

      const stat = toFileStat(vs.asVsCode(), contents);

      expect(stat.type).to.equal(FileType.File);
      expect(stat.ctime).to.equal(new Date(created).getTime());
      expect(stat.mtime).to.equal(new Date(lastModified).getTime());
      expect(stat.size).to.equal(123);
    });

    it('handles missing size by defaulting to 0', () => {
      const contents: Contents = {
        name: 'foo.txt',
        path: 'foo.txt',
        type: ContentsTypeEnum.File,
        writable: true,
        created: '2025-12-16T14:30:53.932129Z',
        lastModified: '2025-12-11T14:34:40Z',
        mimetype: 'text/plain',
        content: '',
        format: 'text',
      };

      const stat = toFileStat(vs.asVsCode(), contents);

      expect(stat.size).to.equal(0);
    });

    it('handles missing timestamps by defaulting to 0', () => {
      const contents: Contents = {
        name: 'foo.txt',
        path: 'foo.txt',
        type: ContentsTypeEnum.File,
        writable: true,
        created: '',
        lastModified: '',
        size: 123,
        mimetype: 'text/plain',
        content: '',
        format: 'text',
      };

      const stat = toFileStat(vs.asVsCode(), contents);

      expect(stat.ctime).to.equal(0);
      expect(stat.mtime).to.equal(0);
    });
  });

  describe('isDirectoryContents', () => {
    it('returns true for a directory with contents', () => {
      const contents: Contents = {
        name: 'dir',
        path: 'dir',
        type: ContentsTypeEnum.Directory,
        content: [],
        writable: true,
        created: '',
        lastModified: '',
        mimetype: '',
        format: '',
      };

      expect(isDirectoryContents(contents)).to.be.true;
    });

    it('returns false for a file', () => {
      const contents: Contents = {
        name: 'foo.txt',
        path: 'foo.txt',
        type: ContentsTypeEnum.File,
        content: '',
        writable: true,
        created: '',
        lastModified: '',
        mimetype: '',
        format: '',
      };

      expect(isDirectoryContents(contents)).to.be.false;
    });

    it('returns false for directory without contents', () => {
      const contents: Contents = {
        name: 'dir',
        path: 'dir',
        type: ContentsTypeEnum.Directory,
        content: '',
        writable: true,
        created: '',
        lastModified: '',
        mimetype: '',
        format: '',
      };

      expect(isDirectoryContents(contents)).to.be.false;
    });
  });
});
