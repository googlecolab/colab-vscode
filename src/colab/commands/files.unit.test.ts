/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'crypto';
import sinon, { SinonStubbedInstance } from 'sinon';
import { QuickPickItem } from 'vscode';
import { AssignmentManager } from '../../jupyter/assignments';
import { TestCancellationTokenSource } from '../../test/helpers/cancellation';
import { TestUri } from '../../test/helpers/uri';
import { newVsCodeStub, VsCodeStub } from '../../test/helpers/vscode';
import { Variant } from '../api';
import { upload } from './files';

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

describe('File Commands', () => {
  let vsCodeStub: VsCodeStub;
  let assignmentManagerStub: SinonStubbedInstance<AssignmentManager>;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    assignmentManagerStub = sinon.createStubInstance(AssignmentManager);

    // Invoke the progress callback immediately.
    vsCodeStub.window.withProgress.callsFake(async (_options, task) => {
      return task(
        {
          report: () => {
            // No-op.
          },
        },
        new TestCancellationTokenSource().token,
      );
    });

    // Default stat to File for simple tests.
    vsCodeStub.workspace.fs.stat.resolves({
      type: vsCodeStub.FileType.File,
      ctime: 0,
      mtime: 0,
      size: 0,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('upload', () => {
    const fileUri = TestUri.parse('file:///local/path/to/my-file.txt');

    it('shows a warning when no servers are assigned', async () => {
      (assignmentManagerStub.getServers as sinon.SinonStub)
        .withArgs('extension')
        .resolves([]);

      await upload(vsCodeStub.asVsCode(), assignmentManagerStub, fileUri);

      sinon.assert.calledWith(
        vsCodeStub.window.showWarningMessage,
        'No Colab servers found.',
      );
      sinon.assert.notCalled(vsCodeStub.workspace.fs.readFile);
    });

    it('auto-selects the server when only one is assigned', async () => {
      (assignmentManagerStub.getServers as sinon.SinonStub)
        .withArgs('extension')
        .resolves([DEFAULT_SERVER]);
      const fileContent = new Uint8Array([1, 2, 3]);
      vsCodeStub.workspace.fs.readFile.resolves(fileContent);

      await upload(vsCodeStub.asVsCode(), assignmentManagerStub, fileUri);

      sinon.assert.notCalled(vsCodeStub.window.showQuickPick);
      sinon.assert.calledWith(
        vsCodeStub.workspace.fs.writeFile,
        TestUri.parse('colab://m-s-foo/my-file.txt'),
        fileContent,
      );
      sinon.assert.calledWith(
        vsCodeStub.window.showInformationMessage,
        'Successfully uploaded 1 item to foo',
      );
    });

    it('prompts user to select a server when multiple are assigned', async () => {
      const otherServer = {
        ...DEFAULT_SERVER,
        id: randomUUID(),
        endpoint: 'm-s-bar',
        label: 'bar',
      };
      (assignmentManagerStub.getServers as sinon.SinonStub)
        .withArgs('extension')
        .resolves([DEFAULT_SERVER, otherServer]);
      vsCodeStub.window.showQuickPick.resolves({
        label: otherServer.label,
        value: otherServer,
      } as QuickPickItem);
      const fileContent = new Uint8Array([4, 5, 6]);
      vsCodeStub.workspace.fs.readFile.resolves(fileContent);

      await upload(vsCodeStub.asVsCode(), assignmentManagerStub, fileUri);

      sinon.assert.calledWith(
        vsCodeStub.workspace.fs.writeFile,
        TestUri.parse('colab://m-s-bar/my-file.txt'),
        fileContent,
      );
      sinon.assert.calledWith(
        vsCodeStub.window.showInformationMessage,
        'Successfully uploaded 1 item to bar',
      );
    });

    it('does nothing if server selection is cancelled', async () => {
      const otherServer = {
        ...DEFAULT_SERVER,
        id: randomUUID(),
        endpoint: 'm-s-bar',
        label: 'bar',
      };
      (assignmentManagerStub.getServers as sinon.SinonStub)
        .withArgs('extension')
        .resolves([DEFAULT_SERVER, otherServer]);
      vsCodeStub.window.showQuickPick.resolves(undefined);

      await upload(vsCodeStub.asVsCode(), assignmentManagerStub, fileUri);

      sinon.assert.calledOnce(vsCodeStub.window.showQuickPick);
      sinon.assert.notCalled(vsCodeStub.workspace.fs.readFile);
      sinon.assert.notCalled(vsCodeStub.workspace.fs.writeFile);
    });

    it('handles multiple files and reports correct progress', async () => {
      (assignmentManagerStub.getServers as sinon.SinonStub)
        .withArgs('extension')
        .resolves([DEFAULT_SERVER]);
      const fileUri2 = TestUri.parse('file:///local/path/to/other.txt');
      const content1 = new Uint8Array([1]);
      const content2 = new Uint8Array([2]);

      vsCodeStub.workspace.fs.readFile
        .withArgs(fileUri)
        .resolves(content1)
        .withArgs(fileUri2)
        .resolves(content2);

      const progressSpy = sinon.spy();
      vsCodeStub.window.withProgress.callsFake(async (_options, task) => {
        return task(
          { report: progressSpy },
          new TestCancellationTokenSource().token,
        );
      });

      await upload(vsCodeStub.asVsCode(), assignmentManagerStub, fileUri, [
        fileUri,
        fileUri2,
      ]);

      sinon.assert.calledWith(
        vsCodeStub.workspace.fs.writeFile,
        TestUri.parse('colab://m-s-foo/my-file.txt'),
        content1,
      );
      sinon.assert.calledWith(
        vsCodeStub.workspace.fs.writeFile,
        TestUri.parse('colab://m-s-foo/other.txt'),
        content2,
      );
      sinon.assert.calledWith(progressSpy, {
        message: 'Importing my-file.txt...',
        increment: 50,
      });
      sinon.assert.calledWith(progressSpy, {
        message: 'Importing other.txt...',
        increment: 50,
      });
      sinon.assert.calledWith(
        vsCodeStub.window.showInformationMessage,
        'Successfully uploaded 2 items to foo',
      );
    });

    it('uploads directory recursively', async () => {
      (assignmentManagerStub.getServers as sinon.SinonStub)
        .withArgs('extension')
        .resolves([DEFAULT_SERVER]);
      const dirUri = TestUri.parse('file:///local/path/to/dir');
      const subFileUri = TestUri.parse('file:///local/path/to/dir/sub.txt');
      const subContent = new Uint8Array([9]);

      vsCodeStub.workspace.fs.stat
        .withArgs(dirUri)
        .resolves({
          type: vsCodeStub.FileType.Directory,
          ctime: 0,
          mtime: 0,
          size: 0,
        })
        .withArgs(subFileUri)
        .resolves({
          type: vsCodeStub.FileType.File,
          ctime: 0,
          mtime: 0,
          size: 0,
        });
      vsCodeStub.workspace.fs.readDirectory
        .withArgs(dirUri)
        .resolves([['sub.txt', vsCodeStub.FileType.File]]);
      vsCodeStub.workspace.fs.readFile
        .withArgs(subFileUri)
        .resolves(subContent);

      await upload(vsCodeStub.asVsCode(), assignmentManagerStub, dirUri);

      sinon.assert.calledWith(
        vsCodeStub.workspace.fs.createDirectory,
        TestUri.parse('colab://m-s-foo/dir'),
      );
      sinon.assert.calledWith(
        vsCodeStub.workspace.fs.writeFile,
        TestUri.parse('colab://m-s-foo/dir/sub.txt'),
        subContent,
      );
      sinon.assert.calledWith(
        vsCodeStub.window.showInformationMessage,
        'Successfully uploaded 1 item to foo',
      );
    });

    it('handles mixed success and failure', async () => {
      (assignmentManagerStub.getServers as sinon.SinonStub)
        .withArgs('extension')
        .resolves([DEFAULT_SERVER]);
      const goodFile = TestUri.parse('file:///local/good.txt');
      const badFile = TestUri.parse('file:///local/bad.txt');

      vsCodeStub.workspace.fs.readFile
        .withArgs(goodFile)
        .resolves(new Uint8Array([]))
        .withArgs(badFile)
        .rejects(new Error('Read failed'));

      await upload(vsCodeStub.asVsCode(), assignmentManagerStub, goodFile, [
        goodFile,
        badFile,
      ]);

      sinon.assert.calledWith(
        vsCodeStub.window.showInformationMessage,
        'Successfully uploaded 1 item to foo',
      );
      sinon.assert.calledWith(
        vsCodeStub.window.showErrorMessage,
        'Failed to upload 1 item. Check logs for details.',
      );
    });

    it('reports total failure', async () => {
      (assignmentManagerStub.getServers as sinon.SinonStub)
        .withArgs('extension')
        .resolves([DEFAULT_SERVER]);
      const badFile = TestUri.parse('file:///local/bad.txt');
      vsCodeStub.workspace.fs.readFile.rejects(new Error('Fail'));

      await upload(vsCodeStub.asVsCode(), assignmentManagerStub, badFile);

      sinon.assert.notCalled(vsCodeStub.window.showInformationMessage);
      sinon.assert.calledWith(
        vsCodeStub.window.showErrorMessage,
        'Failed to upload 1 item. Check logs for details.',
      );
    });

    it('swallows FileExists error when creating directory', async () => {
      (assignmentManagerStub.getServers as sinon.SinonStub)
        .withArgs('extension')
        .resolves([DEFAULT_SERVER]);
      const dirUri = TestUri.parse('file:///local/dir');
      const subFileUri = TestUri.parse('file:///local/dir/file.txt');
      vsCodeStub.workspace.fs.stat
        .withArgs(dirUri)
        .resolves({
          type: vsCodeStub.FileType.Directory,
          ctime: 0,
          mtime: 0,
          size: 0,
        })
        .withArgs(subFileUri)
        .resolves({
          type: vsCodeStub.FileType.File,
          ctime: 0,
          mtime: 0,
          size: 0,
        });
      vsCodeStub.workspace.fs.readDirectory.resolves([
        ['file.txt', vsCodeStub.FileType.File],
      ]);
      vsCodeStub.workspace.fs.readFile.resolves(new Uint8Array([]));
      const fileExistsError = vsCodeStub.FileSystemError.FileExists('Exists');
      vsCodeStub.workspace.fs.createDirectory.rejects(fileExistsError);

      await upload(vsCodeStub.asVsCode(), assignmentManagerStub, dirUri);

      sinon.assert.calledWith(
        vsCodeStub.window.showInformationMessage,
        'Successfully uploaded 1 item to foo',
      );
      sinon.assert.notCalled(vsCodeStub.window.showErrorMessage);
    });

    it('handles error during planning phase', async () => {
      (assignmentManagerStub.getServers as sinon.SinonStub)
        .withArgs('extension')
        .resolves([DEFAULT_SERVER]);
      const dirUri = TestUri.parse('file:///local/dir');
      vsCodeStub.workspace.fs.stat.withArgs(dirUri).resolves({
        type: vsCodeStub.FileType.Directory,
        ctime: 0,
        mtime: 0,
        size: 0,
      });
      vsCodeStub.workspace.fs.readDirectory.rejects(
        new Error('Permission denied'),
      );

      await upload(vsCodeStub.asVsCode(), assignmentManagerStub, dirUri);

      sinon.assert.calledWith(
        vsCodeStub.window.showErrorMessage,
        'Failed to upload 1 item. Check logs for details.',
      );
    });
  });
});
