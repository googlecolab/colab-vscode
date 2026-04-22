/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { assert, expect } from 'chai';
import sinon, { SinonStubbedFunction } from 'sinon';
import type vscode from 'vscode';
import { FileStat } from 'vscode';
import { telemetry } from '../../telemetry';
import {
  ContentBrowserOperation,
  ContentBrowserTarget,
  Outcome,
} from '../../telemetry/api';
import { TestFileSystemError } from '../../test/helpers/errors';
import { TestUri } from '../../test/helpers/uri';
import { FileType, newVsCodeStub, VsCodeStub } from '../../test/helpers/vscode';
import {
  deleteFile,
  download,
  newFile,
  newFolder,
  renameFile,
} from './commands';
import type { ContentItem } from './content-item';

const CONTENT_ROOT = buildContentItem('folder', 'colab://m-s-foo/content');
const FILE_ITEM = buildContentItem('file', 'colab://m-s-foo/content/foo.txt');
const SOME_FILE: FileStat = {
  type: FileType.File,
  ctime: 1,
  mtime: 2,
  size: 3,
};

function buildContentItem(type: 'file' | 'folder', uri: string): ContentItem {
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

  describe('download', () => {
    beforeEach(() => {
      vsStub.window.withProgress.callsFake((_options, task) => {
        return task(
          { report: sinon.stub() },
          new vsStub.CancellationTokenSource().token,
        );
      });
    });

    it('downloads a file successfully', async () => {
      const localUri = TestUri.file('/local/path/foo.txt');
      vsStub.window.showSaveDialog.resolves(localUri);
      const content = new Uint8Array([1, 2, 3]);
      vsStub.workspace.fs.readFile.resolves(content);

      await download(vs, FILE_ITEM);

      sinon.assert.calledWith(vsStub.workspace.fs.readFile, FILE_ITEM.uri);
      sinon.assert.calledWith(vsStub.workspace.fs.writeFile, localUri, content);
    });

    it('does nothing if user cancels save dialog', async () => {
      vsStub.window.showSaveDialog.resolves(undefined);

      await download(vs, FILE_ITEM);

      sinon.assert.notCalled(vsStub.workspace.fs.readFile);
    });

    it('shows error message if download fails', async () => {
      const localUri = TestUri.file('/local/path/foo.txt');
      vsStub.window.showSaveDialog.resolves(localUri);
      vsStub.workspace.fs.readFile.rejects(new Error('fail'));

      await download(vs, FILE_ITEM);

      sinon.assert.calledWith(
        vsStub.window.showErrorMessage,
        'Failed to download foo.txt: fail',
      );
    });

    it('does nothing if item is not a file', async () => {
      await download(vs, CONTENT_ROOT);

      sinon.assert.notCalled(vsStub.window.showSaveDialog);
    });
  });

  describe('renameFile', () => {
    it('renames a file successfully', async () => {
      vsStub.window.showInputBox.resolves('renamed.txt');
      vsStub.workspace.fs.stat.rejects(TestFileSystemError.FileNotFound());

      await renameFile(vs, FILE_ITEM);

      sinon.assert.calledWith(
        vsStub.workspace.fs.rename,
        FILE_ITEM.uri,
        TestUri.parse('colab://m-s-foo/content/renamed.txt'),
        { overwrite: false },
      );
    });

    it('does nothing if user cancels input box', async () => {
      vsStub.window.showInputBox.resolves(undefined);

      await renameFile(vs, FILE_ITEM);

      sinon.assert.notCalled(vsStub.workspace.fs.rename);
    });

    it('does nothing if name is unchanged', async () => {
      vsStub.window.showInputBox.resolves('foo.txt');

      await renameFile(vs, FILE_ITEM);

      sinon.assert.notCalled(vsStub.workspace.fs.rename);
    });

    it('shows error message if rename fails', async () => {
      vsStub.window.showInputBox.resolves('renamed.txt');
      vsStub.workspace.fs.stat.rejects(TestFileSystemError.FileNotFound());
      vsStub.workspace.fs.rename.rejects(new Error('fail'));

      await renameFile(vs, FILE_ITEM);

      sinon.assert.calledWith(
        vsStub.window.showErrorMessage,
        'Failed to rename "foo.txt" to "renamed.txt": fail',
      );
    });

    it('validates existence of new name', async () => {
      vsStub.window.showInputBox.resolves('renamed.txt');
      vsStub.workspace.fs.stat.resolves(SOME_FILE);

      await renameFile(vs, FILE_ITEM);

      const validate =
        vsStub.window.showInputBox.firstCall.args[0]?.validateInput;
      assert(validate);
      expect(await validate('existing.txt')).to.equal(
        'A file or folder with this name already exists',
      );
    });

    it('allows same name during validation', async () => {
      vsStub.window.showInputBox.resolves('foo.txt');

      await renameFile(vs, FILE_ITEM);

      const validate =
        vsStub.window.showInputBox.firstCall.args[0]?.validateInput;
      assert(validate);
      expect(await validate('foo.txt')).to.be.undefined;
    });
  });

  describe('deleteFile', () => {
    it('deletes a file successfully after confirmation', async () => {
      // Cast necessary due to overloading.
      (vsStub.window.showWarningMessage as sinon.SinonStub).resolves('Delete');

      await deleteFile(vs, FILE_ITEM);

      sinon.assert.calledWith(vsStub.workspace.fs.delete, FILE_ITEM.uri, {
        recursive: true,
      });
    });

    it('does nothing if user cancels confirmation', async () => {
      vsStub.window.showWarningMessage.resolves(undefined);

      await deleteFile(vs, FILE_ITEM);

      sinon.assert.notCalled(vsStub.workspace.fs.delete);
    });

    it('shows error message if deletion fails', async () => {
      // Cast necessary due to overloading.
      (vsStub.window.showWarningMessage as sinon.SinonStub).resolves('Delete');
      vsStub.workspace.fs.delete.rejects(new Error('fail'));

      await deleteFile(vs, FILE_ITEM);

      sinon.assert.calledWith(
        vsStub.window.showErrorMessage,
        'Failed to delete "foo.txt": fail',
      );
    });
  });

  describe('telemetry', () => {
    let logStub: SinonStubbedFunction<
      typeof telemetry.logContentBrowserFileOperation
    >;

    beforeEach(() => {
      logStub = sinon.stub(telemetry, 'logContentBrowserFileOperation');
    });

    afterEach(() => {
      logStub.restore();
    });

    describe('newFile', () => {
      it('logs OUTCOME_SUCCEEDED with TARGET_FILE when a file is created', async () => {
        vsStub.window.showInputBox.resolves('new-file.txt');
        vsStub.workspace.fs.stat.rejects(TestFileSystemError.FileNotFound());

        await newFile(vs, CONTENT_ROOT);

        sinon.assert.calledOnceWithExactly(
          logStub,
          ContentBrowserOperation.OPERATION_NEW_FILE,
          Outcome.OUTCOME_SUCCEEDED,
          ContentBrowserTarget.TARGET_FILE,
        );
      });

      it('logs TARGET_DIRECTORY when name ends with /', async () => {
        vsStub.window.showInputBox.resolves('new-folder/');
        vsStub.workspace.fs.stat.rejects(TestFileSystemError.FileNotFound());

        await newFile(vs, CONTENT_ROOT);

        sinon.assert.calledOnceWithExactly(
          logStub,
          ContentBrowserOperation.OPERATION_NEW_FILE,
          Outcome.OUTCOME_SUCCEEDED,
          ContentBrowserTarget.TARGET_DIRECTORY,
        );
      });

      it('logs OUTCOME_CANCELLED when input is dismissed', async () => {
        vsStub.window.showInputBox.resolves(undefined);

        await newFile(vs, CONTENT_ROOT);

        sinon.assert.calledOnceWithExactly(
          logStub,
          ContentBrowserOperation.OPERATION_NEW_FILE,
          Outcome.OUTCOME_CANCELLED,
          ContentBrowserTarget.TARGET_FILE,
        );
      });

      it('logs OUTCOME_FAILED when writeFile rejects', async () => {
        vsStub.window.showInputBox.resolves('new-file.txt');
        vsStub.workspace.fs.stat.rejects(TestFileSystemError.FileNotFound());
        vsStub.workspace.fs.writeFile.rejects(new Error('fail'));

        await newFile(vs, CONTENT_ROOT);

        sinon.assert.calledOnceWithExactly(
          logStub,
          ContentBrowserOperation.OPERATION_NEW_FILE,
          Outcome.OUTCOME_FAILED,
          ContentBrowserTarget.TARGET_FILE,
        );
      });
    });

    describe('newFolder', () => {
      it('logs OUTCOME_SUCCEEDED when a folder is created', async () => {
        vsStub.window.showInputBox.resolves('new-folder');
        vsStub.workspace.fs.stat.rejects(TestFileSystemError.FileNotFound());

        await newFolder(vs, CONTENT_ROOT);

        sinon.assert.calledOnceWithExactly(
          logStub,
          ContentBrowserOperation.OPERATION_NEW_FOLDER,
          Outcome.OUTCOME_SUCCEEDED,
          ContentBrowserTarget.TARGET_DIRECTORY,
        );
      });

      it('logs OUTCOME_CANCELLED when input is dismissed', async () => {
        vsStub.window.showInputBox.resolves(undefined);

        await newFolder(vs, CONTENT_ROOT);

        sinon.assert.calledOnceWithExactly(
          logStub,
          ContentBrowserOperation.OPERATION_NEW_FOLDER,
          Outcome.OUTCOME_CANCELLED,
          ContentBrowserTarget.TARGET_DIRECTORY,
        );
      });

      it('logs OUTCOME_FAILED when createDirectory rejects', async () => {
        vsStub.window.showInputBox.resolves('new-folder');
        vsStub.workspace.fs.stat.rejects(TestFileSystemError.FileNotFound());
        vsStub.workspace.fs.createDirectory.rejects(new Error('fail'));

        await newFolder(vs, CONTENT_ROOT);

        sinon.assert.calledOnceWithExactly(
          logStub,
          ContentBrowserOperation.OPERATION_NEW_FOLDER,
          Outcome.OUTCOME_FAILED,
          ContentBrowserTarget.TARGET_DIRECTORY,
        );
      });
    });

    describe('renameFile', () => {
      it('logs OUTCOME_SUCCEEDED when a file is renamed', async () => {
        vsStub.window.showInputBox.resolves('renamed.txt');
        vsStub.workspace.fs.stat.rejects(TestFileSystemError.FileNotFound());

        await renameFile(vs, FILE_ITEM);

        sinon.assert.calledOnceWithExactly(
          logStub,
          ContentBrowserOperation.OPERATION_RENAME,
          Outcome.OUTCOME_SUCCEEDED,
          ContentBrowserTarget.TARGET_FILE,
        );
      });

      it('logs OUTCOME_CANCELLED when input is dismissed', async () => {
        vsStub.window.showInputBox.resolves(undefined);

        await renameFile(vs, FILE_ITEM);

        sinon.assert.calledOnceWithExactly(
          logStub,
          ContentBrowserOperation.OPERATION_RENAME,
          Outcome.OUTCOME_CANCELLED,
          ContentBrowserTarget.TARGET_FILE,
        );
      });

      it('logs OUTCOME_CANCELLED when name is unchanged', async () => {
        vsStub.window.showInputBox.resolves('foo.txt');

        await renameFile(vs, FILE_ITEM);

        sinon.assert.calledOnceWithExactly(
          logStub,
          ContentBrowserOperation.OPERATION_RENAME,
          Outcome.OUTCOME_CANCELLED,
          ContentBrowserTarget.TARGET_FILE,
        );
      });

      it('logs OUTCOME_FAILED when rename rejects', async () => {
        vsStub.window.showInputBox.resolves('renamed.txt');
        vsStub.workspace.fs.stat.rejects(TestFileSystemError.FileNotFound());
        vsStub.workspace.fs.rename.rejects(new Error('fail'));

        await renameFile(vs, FILE_ITEM);

        sinon.assert.calledOnceWithExactly(
          logStub,
          ContentBrowserOperation.OPERATION_RENAME,
          Outcome.OUTCOME_FAILED,
          ContentBrowserTarget.TARGET_FILE,
        );
      });

      it('logs TARGET_DIRECTORY when renaming a folder', async () => {
        const folderItem = buildContentItem(
          'folder',
          'colab://m-s-foo/content/some-folder',
        );
        vsStub.window.showInputBox.resolves('renamed-folder');
        vsStub.workspace.fs.stat.rejects(TestFileSystemError.FileNotFound());

        await renameFile(vs, folderItem);

        sinon.assert.calledOnceWithExactly(
          logStub,
          ContentBrowserOperation.OPERATION_RENAME,
          Outcome.OUTCOME_SUCCEEDED,
          ContentBrowserTarget.TARGET_DIRECTORY,
        );
      });
    });

    describe('deleteFile', () => {
      it('logs OUTCOME_SUCCEEDED when a file is deleted', async () => {
        // Cast necessary due to overloading.
        (vsStub.window.showWarningMessage as sinon.SinonStub).resolves(
          'Delete',
        );

        await deleteFile(vs, FILE_ITEM);

        sinon.assert.calledOnceWithExactly(
          logStub,
          ContentBrowserOperation.OPERATION_DELETE,
          Outcome.OUTCOME_SUCCEEDED,
          ContentBrowserTarget.TARGET_FILE,
        );
      });

      it('logs OUTCOME_CANCELLED when confirmation is declined', async () => {
        // Cast necessary due to overloading.
        (vsStub.window.showWarningMessage as sinon.SinonStub).resolves(
          undefined,
        );

        await deleteFile(vs, FILE_ITEM);

        sinon.assert.calledOnceWithExactly(
          logStub,
          ContentBrowserOperation.OPERATION_DELETE,
          Outcome.OUTCOME_CANCELLED,
          ContentBrowserTarget.TARGET_FILE,
        );
      });

      it('logs OUTCOME_FAILED when delete rejects', async () => {
        // Cast necessary due to overloading.
        (vsStub.window.showWarningMessage as sinon.SinonStub).resolves(
          'Delete',
        );
        vsStub.workspace.fs.delete.rejects(new Error('fail'));

        await deleteFile(vs, FILE_ITEM);

        sinon.assert.calledOnceWithExactly(
          logStub,
          ContentBrowserOperation.OPERATION_DELETE,
          Outcome.OUTCOME_FAILED,
          ContentBrowserTarget.TARGET_FILE,
        );
      });

      it('logs TARGET_DIRECTORY when deleting a folder', async () => {
        const folderItem = buildContentItem(
          'folder',
          'colab://m-s-foo/content/some-folder',
        );
        // Cast necessary due to overloading.
        (vsStub.window.showWarningMessage as sinon.SinonStub).resolves(
          'Delete',
        );

        await deleteFile(vs, folderItem);

        sinon.assert.calledOnceWithExactly(
          logStub,
          ContentBrowserOperation.OPERATION_DELETE,
          Outcome.OUTCOME_SUCCEEDED,
          ContentBrowserTarget.TARGET_DIRECTORY,
        );
      });
    });
  });
});
