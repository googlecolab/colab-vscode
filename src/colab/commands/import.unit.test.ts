/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import sinon, { SinonStubbedInstance } from 'sinon';
import { NotebookDocument } from 'vscode';
import { TestUri } from '../../test/helpers/uri';
import { newVsCodeStub, VsCodeStub } from '../../test/helpers/vscode';
import { DriveProvider } from '../drive-provider';
import { importNotebookFromUrl } from './import';

describe('importNotebookFromUrl', () => {
  let vsCodeStub: VsCodeStub;
  let driveProviderStub: SinonStubbedInstance<DriveProvider>;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    driveProviderStub = sinon.createStubInstance(DriveProvider);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('does nothing when input is cancelled', async () => {
    vsCodeStub.window.showInputBox.resolves(undefined);

    await importNotebookFromUrl(vsCodeStub.asVsCode(), driveProviderStub);

    sinon.assert.notCalled(driveProviderStub.getDriveFileName);
  });

  it('shows error for unsupported URL format', async () => {
    vsCodeStub.window.showInputBox.resolves('https://invalid-url.com');

    await importNotebookFromUrl(vsCodeStub.asVsCode(), driveProviderStub);

    sinon.assert.calledWithMatch(
      vsCodeStub.window.showErrorMessage,
      sinon.match(/Unsupported Colab link format/),
    );
  });

  it('does nothing when save dialog is cancelled', async () => {
    const url = 'https://colab.research.google.com/drive/123';
    vsCodeStub.window.showInputBox.resolves(url);
    driveProviderStub.getDriveFileName.resolves('notebook.ipynb');
    vsCodeStub.window.showSaveDialog.resolves(undefined);

    await importNotebookFromUrl(vsCodeStub.asVsCode(), driveProviderStub);

    sinon.assert.calledWith(driveProviderStub.getDriveFileName, '123');
    sinon.assert.called(vsCodeStub.window.showSaveDialog);
    sinon.assert.notCalled(driveProviderStub.getDriveFileContent);
  });

  it('imports notebook from Colab URL', async () => {
    const url = 'https://colab.research.google.com/drive/123';
    const fileId = '123';
    const fileName = 'notebook.ipynb';
    const fileContent = new Uint8Array([1, 2, 3]);
    const saveUri = TestUri.parse('file:///path/to/save/notebook.ipynb');

    vsCodeStub.window.showInputBox.resolves(url);
    driveProviderStub.getDriveFileName.withArgs(fileId).resolves(fileName);
    vsCodeStub.window.showSaveDialog.resolves(saveUri);
    driveProviderStub.getDriveFileContent
      .withArgs(fileId)
      .resolves(fileContent);
    const doc = { uri: saveUri };
    vsCodeStub.workspace.openNotebookDocument.resolves(
      doc as unknown as NotebookDocument,
    );

    await importNotebookFromUrl(vsCodeStub.asVsCode(), driveProviderStub);

    sinon.assert.calledWith(driveProviderStub.getDriveFileName, fileId);
    sinon.assert.calledWith(driveProviderStub.getDriveFileContent, fileId);
    sinon.assert.calledWith(
      vsCodeStub.workspace.fs.writeFile,
      saveUri,
      fileContent,
    );
    sinon.assert.calledWith(
      vsCodeStub.workspace.openNotebookDocument,
      sinon.match(saveUri),
    );
    sinon.assert.calledWith(vsCodeStub.window.showNotebookDocument, doc);
    sinon.assert.calledWithMatch(
      vsCodeStub.window.showInformationMessage,
      sinon.match(/Successfully saved/),
    );
  });

  it('imports notebook from Drive URL', async () => {
    const url = 'https://drive.google.com/file/d/456/view';
    const fileId = '456';
    const fileName = 'notebook.ipynb';
    const fileContent = new Uint8Array([4, 5, 6]);
    const saveUri = TestUri.parse('file:///path/to/save/notebook.ipynb');

    vsCodeStub.window.showInputBox.resolves(url);
    driveProviderStub.getDriveFileName.withArgs(fileId).resolves(fileName);
    vsCodeStub.window.showSaveDialog.resolves(saveUri);
    driveProviderStub.getDriveFileContent
      .withArgs(fileId)
      .resolves(fileContent);
    const doc = { uri: saveUri };
    vsCodeStub.workspace.openNotebookDocument.resolves(
      doc as unknown as NotebookDocument,
    );

    await importNotebookFromUrl(vsCodeStub.asVsCode(), driveProviderStub);

    sinon.assert.calledWith(driveProviderStub.getDriveFileName, fileId);
    sinon.assert.calledWith(driveProviderStub.getDriveFileContent, fileId);
    sinon.assert.calledWith(
      vsCodeStub.workspace.fs.writeFile,
      saveUri,
      fileContent,
    );
  });

  it('handles known errors', async () => {
    const url = 'https://colab.research.google.com/drive/123';
    vsCodeStub.window.showInputBox.resolves(url);
    driveProviderStub.getDriveFileName.rejects(new Error('Network error'));

    await importNotebookFromUrl(vsCodeStub.asVsCode(), driveProviderStub);

    sinon.assert.calledWith(
      vsCodeStub.window.showErrorMessage,
      'Failed to import notebook: Network error',
    );
  });

  it('handles unknown errors', async () => {
    const url = 'https://colab.research.google.com/drive/123';
    vsCodeStub.window.showInputBox.resolves(url);
    driveProviderStub.getDriveFileName.callsFake(() =>
      // To simulate a non-error thrown
      /* eslint-disable @typescript-eslint/prefer-promise-reject-errors */
      Promise.reject('Unknown error'),
    );

    await importNotebookFromUrl(vsCodeStub.asVsCode(), driveProviderStub);

    sinon.assert.calledWithMatch(
      vsCodeStub.window.showErrorMessage,
      sinon.match(/An unknown error occurred/),
    );
  });
});
