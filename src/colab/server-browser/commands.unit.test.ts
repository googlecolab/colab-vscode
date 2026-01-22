/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { assert, expect } from 'chai';
import sinon from 'sinon';
import type vscode from 'vscode';
import { FileStat } from 'vscode';
import { TestFileSystemError } from '../../test/helpers/errors';
import { TestUri } from '../../test/helpers/uri';
import { FileType, newVsCodeStub, VsCodeStub } from '../../test/helpers/vscode';
import { newFile, newFolder } from './commands';
import type { ServerItem } from './server-item';

const CONTENT_ROOT = buildServerItem('folder', 'colab://m-s-foo/content');
const FILE_ITEM = buildServerItem('file', 'colab://m-s-foo/content/foo.txt');
const SOME_FILE: FileStat = {
  type: FileType.File,
  ctime: 1,
  mtime: 2,
  size: 3,
};

function buildServerItem(type: 'file' | 'folder', uri: string): ServerItem {
  const u = TestUri.parse(uri);
  return {
    endpoint: u.authority,
    type: type === 'file' ? FileType.File : FileType.Directory,
    contextValue: type,
    uri: u,
  };
}

describe('Server Browser Commands', () => {
  let vsStub: VsCodeStub;
  let vs: typeof vscode;

  beforeEach(() => {
    vsStub = newVsCodeStub();
    vs = vsStub.asVsCode();
  });

  describe('newFile', () => {
    it('creates a new file in a folder and opens it', async () => {
      vsStub.window.showInputBox.resolves('new-file.txt');
      vsStub.workspace.fs.stat.rejects(TestFileSystemError.FileNotFound());

      await newFile(vs, CONTENT_ROOT);

      const expectedUri = TestUri.parse('colab://m-s-foo/content/new-file.txt');
      sinon.assert.calledWith(
        vsStub.workspace.fs.writeFile,
        expectedUri,
        sinon.match.any,
      );
      sinon.assert.calledWith(
        vsStub.commands.executeCommand,
        'vscode.open',
        expectedUri,
      );
    });

    it('creates a new file in the parent folder if context is a file', async () => {
      vsStub.window.showInputBox.resolves('new-file.txt');
      vsStub.workspace.fs.stat.rejects(TestFileSystemError.FileNotFound());

      await newFile(vs, FILE_ITEM);

      sinon.assert.calledWith(
        vsStub.workspace.fs.writeFile,
        TestUri.parse('colab://m-s-foo/content/new-file.txt'),
        sinon.match.any,
      );
    });

    it('creates a directory if name ends with /', async () => {
      vsStub.window.showInputBox.resolves('new-folder/');
      vsStub.workspace.fs.stat.rejects(TestFileSystemError.FileNotFound());

      await newFile(vs, CONTENT_ROOT);

      sinon.assert.calledWith(
        vsStub.workspace.fs.createDirectory,
        TestUri.parse('colab://m-s-foo/content/new-folder/'),
      );
      sinon.assert.notCalled(vsStub.workspace.fs.writeFile);
    });

    it('shows error message if writeFile fails', async () => {
      vsStub.window.showInputBox.resolves('new-file.txt');
      vsStub.workspace.fs.stat.rejects(TestFileSystemError.FileNotFound());
      vsStub.workspace.fs.writeFile.rejects(new Error('fail'));

      await newFile(vs, CONTENT_ROOT);

      sinon.assert.calledWith(
        vsStub.window.showErrorMessage,
        'Failed to create file "new-file.txt": fail',
      );
    });

    it('shows error message if createDirectory fails for a folder name', async () => {
      vsStub.window.showInputBox.resolves('new-folder/');
      vsStub.workspace.fs.stat.rejects(TestFileSystemError.FileNotFound());
      vsStub.workspace.fs.createDirectory.rejects(new Error('fail'));

      await newFile(vs, CONTENT_ROOT);

      sinon.assert.calledWith(
        vsStub.window.showErrorMessage,
        'Failed to create folder "new-folder/": fail',
      );
    });

    it('validates empty names', async () => {
      vsStub.window.showInputBox.resolves('new-file.txt');
      vsStub.workspace.fs.stat.rejects(TestFileSystemError.FileNotFound());

      await newFile(vs, CONTENT_ROOT);

      const validate =
        vsStub.window.showInputBox.firstCall.args[0]?.validateInput;
      assert(validate);
      expect(await validate('')).to.equal('A name must be provided');
      expect(await validate('   ')).to.equal('A name must be provided');
      expect(await validate('/')).to.equal('A name must be provided');
    });

    it('validates invalid characters', async () => {
      vsStub.window.showInputBox.resolves('new-file.txt');
      vsStub.workspace.fs.stat.rejects(TestFileSystemError.FileNotFound());

      await newFile(vs, CONTENT_ROOT);

      const validate =
        vsStub.window.showInputBox.firstCall.args[0]?.validateInput;
      assert(validate);
      expect(await validate('foo\\bar')).to.equal('Name cannot contain \\');
    });

    it('validates existence', async () => {
      vsStub.window.showInputBox.resolves('new-file.txt');
      vsStub.workspace.fs.stat.resolves(SOME_FILE);

      await newFile(vs, CONTENT_ROOT);

      const validate =
        vsStub.window.showInputBox.firstCall.args[0]?.validateInput;
      assert(validate);
      expect(await validate('existing.txt')).to.equal(
        'A file or folder with this name already exists',
      );
    });
  });

  describe('newFolder', () => {
    it('creates a new folder', async () => {
      vsStub.window.showInputBox.resolves('new-folder');
      vsStub.workspace.fs.stat.rejects(TestFileSystemError.FileNotFound());

      await newFolder(vs, CONTENT_ROOT);

      sinon.assert.calledWith(
        vsStub.workspace.fs.createDirectory,
        TestUri.parse('colab://m-s-foo/content/new-folder'),
      );
    });

    it('shows error message if createDirectory fails', async () => {
      vsStub.window.showInputBox.resolves('new-folder');
      vsStub.workspace.fs.stat.rejects(TestFileSystemError.FileNotFound());
      vsStub.workspace.fs.createDirectory.rejects(new Error('fail'));

      await newFolder(vs, CONTENT_ROOT);

      sinon.assert.calledWith(
        vsStub.window.showErrorMessage,
        'Failed to create folder "new-folder": fail',
      );
    });

    it('validates empty names', async () => {
      vsStub.window.showInputBox.resolves('new-file.txt');
      vsStub.workspace.fs.stat.rejects(TestFileSystemError.FileNotFound());

      await newFolder(vs, CONTENT_ROOT);

      const validate =
        vsStub.window.showInputBox.firstCall.args[0]?.validateInput;
      assert(validate);
      expect(await validate('')).to.equal('A name must be provided');
      expect(await validate('   ')).to.equal('A name must be provided');
    });

    it('validates invalid characters', async () => {
      vsStub.window.showInputBox.resolves('new-file.txt');
      vsStub.workspace.fs.stat.rejects(TestFileSystemError.FileNotFound());

      await newFolder(vs, CONTENT_ROOT);

      const validate =
        vsStub.window.showInputBox.firstCall.args[0]?.validateInput;
      assert(validate);
      expect(await validate('foo\\bar')).to.equal('Name cannot contain \\');
      // Trailing / is allowed
      expect(await validate('foo/')).to.be.undefined;
    });

    it('validates existence', async () => {
      vsStub.window.showInputBox.resolves('new-file.txt');
      vsStub.workspace.fs.stat.resolves(SOME_FILE);

      await newFolder(vs, CONTENT_ROOT);

      const validate =
        vsStub.window.showInputBox.firstCall.args[0]?.validateInput;
      assert(validate);
      expect(await validate('existing.txt')).to.equal(
        'A file or folder with this name already exists',
      );
    });
  });
});
