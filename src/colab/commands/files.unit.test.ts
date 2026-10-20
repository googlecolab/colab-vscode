/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'crypto';
import { expect } from 'chai';
import sinon, { SinonStubbedFunction, SinonStubbedInstance } from 'sinon';
import { FileType, QuickPickItem } from 'vscode';
import { AssignmentManager } from '../../jupyter/assignments';
import { telemetry } from '../../telemetry';
import { CommandSource, Outcome } from '../../telemetry/api';
import { TestCancellationTokenSource } from '../../test/helpers/cancellation';
import { TestUri } from '../../test/helpers/uri';
import { newVsCodeStub, VsCodeStub } from '../../test/helpers/vscode';
import { Variant } from '../types';
import {
  MAX_CONCURRENT_FILES_UPLOAD,
  MAX_IN_FLIGHT_UPLOAD_BYTES,
  upload,
} from './files';

const DEFAULT_SERVER = {
  id: `r-${randomUUID()}`,
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

      await upload(
        vsCodeStub.asVsCode(),
        assignmentManagerStub,
        CommandSource.COMMAND_SOURCE_EXPLORER_CONTEXT,
        fileUri,
      );

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

      await upload(
        vsCodeStub.asVsCode(),
        assignmentManagerStub,
        CommandSource.COMMAND_SOURCE_EXPLORER_CONTEXT,
        fileUri,
      );

      sinon.assert.notCalled(vsCodeStub.window.showQuickPick);
      sinon.assert.calledWith(
        vsCodeStub.workspace.fs.writeFile,
        TestUri.parse(`colab://${DEFAULT_SERVER.id}/content/my-file.txt`),
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
        id: `r-${randomUUID()}`,
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

      await upload(
        vsCodeStub.asVsCode(),
        assignmentManagerStub,
        CommandSource.COMMAND_SOURCE_EXPLORER_CONTEXT,
        fileUri,
      );

      sinon.assert.calledWith(
        vsCodeStub.workspace.fs.writeFile,
        TestUri.parse(`colab://${otherServer.id}/content/my-file.txt`),
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
        id: `r-${randomUUID()}`,
        label: 'bar',
      };
      (assignmentManagerStub.getServers as sinon.SinonStub)
        .withArgs('extension')
        .resolves([DEFAULT_SERVER, otherServer]);
      vsCodeStub.window.showQuickPick.resolves(undefined);

      await upload(
        vsCodeStub.asVsCode(),
        assignmentManagerStub,
        CommandSource.COMMAND_SOURCE_EXPLORER_CONTEXT,
        fileUri,
      );

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

      await upload(
        vsCodeStub.asVsCode(),
        assignmentManagerStub,
        CommandSource.COMMAND_SOURCE_EXPLORER_CONTEXT,
        fileUri,
        [fileUri, fileUri2],
      );

      sinon.assert.calledWith(
        vsCodeStub.workspace.fs.writeFile,
        TestUri.parse(`colab://${DEFAULT_SERVER.id}/content/my-file.txt`),
        content1,
      );
      sinon.assert.calledWith(
        vsCodeStub.workspace.fs.writeFile,
        TestUri.parse(`colab://${DEFAULT_SERVER.id}/content/other.txt`),
        content2,
      );
      sinon.assert.calledWith(progressSpy, {
        message: 'Importing 1 of 2 files',
        increment: 50,
      });
      sinon.assert.calledWith(progressSpy, {
        message: 'Importing 2 of 2 files',
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

      await upload(
        vsCodeStub.asVsCode(),
        assignmentManagerStub,
        CommandSource.COMMAND_SOURCE_EXPLORER_CONTEXT,
        dirUri,
      );

      // `workspace.fs.writeFile` creates the parent directory.
      sinon.assert.notCalled(vsCodeStub.workspace.fs.createDirectory);
      sinon.assert.calledWith(
        vsCodeStub.workspace.fs.writeFile,
        TestUri.parse(`colab://${DEFAULT_SERVER.id}/content/dir/sub.txt`),
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

      await upload(
        vsCodeStub.asVsCode(),
        assignmentManagerStub,
        CommandSource.COMMAND_SOURCE_EXPLORER_CONTEXT,
        goodFile,
        [goodFile, badFile],
      );

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

      await upload(
        vsCodeStub.asVsCode(),
        assignmentManagerStub,
        CommandSource.COMMAND_SOURCE_EXPLORER_CONTEXT,
        badFile,
      );

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
      const emptyDirUri = TestUri.parse('file:///local/dir/empty');
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
        })
        .withArgs(emptyDirUri)
        .resolves({
          type: vsCodeStub.FileType.Directory,
          ctime: 0,
          mtime: 0,
          size: 0,
        });
      vsCodeStub.workspace.fs.readDirectory
        .withArgs(dirUri)
        .resolves([
          ['file.txt', vsCodeStub.FileType.File],
          ['empty', vsCodeStub.FileType.Directory],
        ])
        .withArgs(emptyDirUri)
        .resolves([]);
      vsCodeStub.workspace.fs.readFile.resolves(new Uint8Array([]));
      const fileExistsError = vsCodeStub.FileSystemError.FileExists('Exists');
      vsCodeStub.workspace.fs.createDirectory.rejects(fileExistsError);

      await upload(
        vsCodeStub.asVsCode(),
        assignmentManagerStub,
        CommandSource.COMMAND_SOURCE_EXPLORER_CONTEXT,
        dirUri,
      );

      sinon.assert.calledOnceWithExactly(
        vsCodeStub.workspace.fs.createDirectory,
        TestUri.parse(`colab://${DEFAULT_SERVER.id}/content/dir/empty`),
      );
      sinon.assert.calledWith(
        vsCodeStub.window.showInformationMessage,
        'Successfully uploaded 1 item to foo',
      );
      sinon.assert.notCalled(vsCodeStub.window.showErrorMessage);
    });

    const repeat = (n: number, value: number) =>
      Array.from({ length: n }, () => value);

    // Uploads a flat directory of files with the given sizes and returns the
    // most files that were being written at once.
    //
    // Each write yields a single microtask. All workers run the same code, so
    // they reach `writeFile` in lockstep and every write that the limits admit
    // overlaps deterministically, without timers.
    async function uploadFiles(
      sizes: number[],
      { failWrites = false } = {},
    ): Promise<number> {
      (assignmentManagerStub.getServers as sinon.SinonStub)
        .withArgs('extension')
        .resolves([DEFAULT_SERVER]);
      const dirUri = TestUri.parse('file:///local/dir');
      const names = sizes.map((_, i) => `${i.toString()}.txt`);
      const sizeByPath = new Map(
        names.map((name, i) => [`${dirUri.path}/${name}`, sizes[i]]),
      );
      vsCodeStub.workspace.fs.stat.callsFake((uri) =>
        Promise.resolve({
          type: sizeByPath.has(uri.path)
            ? vsCodeStub.FileType.File
            : vsCodeStub.FileType.Directory,
          ctime: 0,
          mtime: 0,
          size: sizeByPath.get(uri.path) ?? 0,
        }),
      );
      vsCodeStub.workspace.fs.readDirectory
        .withArgs(dirUri)
        .resolves(
          names.map((name): [string, FileType] => [
            name,
            vsCodeStub.FileType.File,
          ]),
        );
      vsCodeStub.workspace.fs.readFile.resolves(new Uint8Array([1]));
      let inFlight = 0;
      let maxInFlight = 0;
      vsCodeStub.workspace.fs.writeFile.callsFake(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight--;
        if (failWrites) {
          throw new Error('Write failed');
        }
      });

      await upload(
        vsCodeStub.asVsCode(),
        assignmentManagerStub,
        CommandSource.COMMAND_SOURCE_EXPLORER_CONTEXT,
        dirUri,
      );

      sinon.assert.callCount(vsCodeStub.workspace.fs.writeFile, sizes.length);
      return maxInFlight;
    }

    it('uploads files concurrently up to the limit', async () => {
      const maxInFlight = await uploadFiles(repeat(200, 0));

      expect(maxInFlight).to.equal(MAX_CONCURRENT_FILES_UPLOAD);
      sinon.assert.notCalled(vsCodeStub.window.showErrorMessage);
    });

    describe('in-flight byte limit', () => {
      const limit = MAX_IN_FLIGHT_UPLOAD_BYTES;
      const cases: { name: string; sizes: number[]; expected: number }[] = [
        {
          name: 'holds back files that would exceed the limit',
          sizes: repeat(5, limit * 0.4),
          expected: 2,
        },
        {
          name: 'admits files that add up to exactly the limit',
          sizes: repeat(3, limit / 2),
          expected: 2,
        },
        {
          name: 'uploads a file larger than the limit on its own',
          sizes: repeat(3, limit * 2),
          expected: 1,
        },
        {
          name: 'admits every waiting file that fits once room frees up',
          sizes: [limit, ...repeat(5, limit / 10)],
          expected: 5,
        },
      ];
      for (const { name, sizes, expected } of cases) {
        it(name, async () => {
          const maxInFlight = await uploadFiles(sizes);

          expect(maxInFlight).to.equal(expected);
          sinon.assert.notCalled(vsCodeStub.window.showErrorMessage);
        });
      }

      it('frees the budget of files that fail to upload', async () => {
        await uploadFiles(repeat(3, limit), { failWrites: true });

        sinon.assert.calledWith(
          vsCodeStub.window.showErrorMessage,
          'Failed to upload 3 items. Check logs for details.',
        );
      });
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

      await upload(
        vsCodeStub.asVsCode(),
        assignmentManagerStub,
        CommandSource.COMMAND_SOURCE_EXPLORER_CONTEXT,
        dirUri,
      );

      sinon.assert.calledWith(
        vsCodeStub.window.showErrorMessage,
        'Failed to upload 1 item. Check logs for details.',
      );
    });

    describe('telemetry', () => {
      let logStub: SinonStubbedFunction<typeof telemetry.logUpload>;

      beforeEach(() => {
        logStub = sinon.stub(telemetry, 'logUpload');
      });

      it('logs OUTCOME_CANCELLED when no servers are assigned', async () => {
        (assignmentManagerStub.getServers as sinon.SinonStub)
          .withArgs('extension')
          .resolves([]);

        await upload(
          vsCodeStub.asVsCode(),
          assignmentManagerStub,
          CommandSource.COMMAND_SOURCE_EXPLORER_CONTEXT,
          fileUri,
        );

        sinon.assert.calledOnceWithExactly(
          logStub,
          CommandSource.COMMAND_SOURCE_EXPLORER_CONTEXT,
          Outcome.OUTCOME_CANCELLED,
          {
            successCount: 0,
            failCount: 0,
            fileCount: 0,
            directoryCount: 0,
            uploadedBytes: 0,
          },
        );
      });

      it('logs OUTCOME_CANCELLED when the user dismisses the server picker', async () => {
        const otherServer = {
          ...DEFAULT_SERVER,
          id: `r-${randomUUID()}`,
          label: 'bar',
        };
        (assignmentManagerStub.getServers as sinon.SinonStub)
          .withArgs('extension')
          .resolves([DEFAULT_SERVER, otherServer]);
        vsCodeStub.window.showQuickPick.resolves(undefined);

        await upload(
          vsCodeStub.asVsCode(),
          assignmentManagerStub,
          CommandSource.COMMAND_SOURCE_EXPLORER_CONTEXT,
          fileUri,
        );

        sinon.assert.calledOnceWithExactly(
          logStub,
          CommandSource.COMMAND_SOURCE_EXPLORER_CONTEXT,
          Outcome.OUTCOME_CANCELLED,
          {
            successCount: 0,
            failCount: 0,
            fileCount: 0,
            directoryCount: 0,
            uploadedBytes: 0,
          },
        );
      });

      it('logs OUTCOME_SUCCEEDED with counts and bytes for a successful single-file upload', async () => {
        (assignmentManagerStub.getServers as sinon.SinonStub)
          .withArgs('extension')
          .resolves([DEFAULT_SERVER]);
        const fileContent = new Uint8Array([1, 2, 3, 4, 5]);
        vsCodeStub.workspace.fs.readFile.resolves(fileContent);

        await upload(
          vsCodeStub.asVsCode(),
          assignmentManagerStub,
          CommandSource.COMMAND_SOURCE_EXPLORER_CONTEXT,
          fileUri,
        );

        sinon.assert.calledOnceWithExactly(
          logStub,
          CommandSource.COMMAND_SOURCE_EXPLORER_CONTEXT,
          Outcome.OUTCOME_SUCCEEDED,
          {
            successCount: 1,
            failCount: 0,
            fileCount: 1,
            directoryCount: 0,
            uploadedBytes: 5,
          },
        );
      });

      it('logs OUTCOME_PARTIAL_SUCCESS for mixed success and failure', async () => {
        (assignmentManagerStub.getServers as sinon.SinonStub)
          .withArgs('extension')
          .resolves([DEFAULT_SERVER]);
        const goodFile = TestUri.parse('file:///local/good.txt');
        const badFile = TestUri.parse('file:///local/bad.txt');
        vsCodeStub.workspace.fs.readFile
          .withArgs(goodFile)
          .resolves(new Uint8Array([1, 2, 3]))
          .withArgs(badFile)
          .rejects(new Error('Read failed'));

        await upload(
          vsCodeStub.asVsCode(),
          assignmentManagerStub,
          CommandSource.COMMAND_SOURCE_EXPLORER_CONTEXT,
          goodFile,
          [goodFile, badFile],
        );

        sinon.assert.calledOnceWithExactly(
          logStub,
          CommandSource.COMMAND_SOURCE_EXPLORER_CONTEXT,
          Outcome.OUTCOME_PARTIAL_SUCCESS,
          {
            successCount: 1,
            failCount: 1,
            fileCount: 2,
            directoryCount: 0,
            uploadedBytes: 3,
          },
        );
      });

      it('logs OUTCOME_FAILED when every attempted upload fails', async () => {
        (assignmentManagerStub.getServers as sinon.SinonStub)
          .withArgs('extension')
          .resolves([DEFAULT_SERVER]);
        const badFile = TestUri.parse('file:///local/bad.txt');
        vsCodeStub.workspace.fs.readFile.rejects(new Error('Read failed'));

        await upload(
          vsCodeStub.asVsCode(),
          assignmentManagerStub,
          CommandSource.COMMAND_SOURCE_EXPLORER_CONTEXT,
          badFile,
        );

        sinon.assert.calledOnceWithExactly(
          logStub,
          CommandSource.COMMAND_SOURCE_EXPLORER_CONTEXT,
          Outcome.OUTCOME_FAILED,
          {
            successCount: 0,
            failCount: 1,
            fileCount: 1,
            directoryCount: 0,
            uploadedBytes: 0,
          },
        );
      });

      it('logs directory count when uploading a directory', async () => {
        (assignmentManagerStub.getServers as sinon.SinonStub)
          .withArgs('extension')
          .resolves([DEFAULT_SERVER]);
        const dirUri = TestUri.parse('file:///local/path/to/dir');
        const subFileUri = TestUri.parse('file:///local/path/to/dir/sub.txt');
        const subContent = new Uint8Array([9, 9]);
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

        await upload(
          vsCodeStub.asVsCode(),
          assignmentManagerStub,
          CommandSource.COMMAND_SOURCE_EXPLORER_CONTEXT,
          dirUri,
        );

        sinon.assert.calledOnceWithExactly(
          logStub,
          CommandSource.COMMAND_SOURCE_EXPLORER_CONTEXT,
          Outcome.OUTCOME_SUCCEEDED,
          {
            successCount: 1,
            failCount: 0,
            fileCount: 1,
            directoryCount: 1,
            uploadedBytes: 2,
          },
        );
      });
    });
  });
});
