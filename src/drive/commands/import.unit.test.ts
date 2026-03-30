/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon, { SinonStubbedInstance } from 'sinon';
import { NotebookDocument } from 'vscode';
import { TestUri } from '../../test/helpers/uri';
import { newVsCodeStub, VsCodeStub } from '../../test/helpers/vscode';
import { DriveClient } from '../client';
import { importNotebookFromUrl, TEST_ONLY } from './import';

describe('importNotebookFromUrl', () => {
  let vsCodeStub: VsCodeStub;
  let driveClientStub: SinonStubbedInstance<DriveClient>;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    driveClientStub = sinon.createStubInstance(DriveClient);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('does nothing when input is cancelled', async () => {
    vsCodeStub.window.showInputBox.resolves(undefined);

    await importNotebookFromUrl(vsCodeStub.asVsCode(), driveClientStub);

    sinon.assert.notCalled(driveClientStub.getDriveFileName);
  });

  it('shows error for unsupported URL format', async () => {
    vsCodeStub.window.showInputBox.resolves('https://invalid-url.com');

    await importNotebookFromUrl(vsCodeStub.asVsCode(), driveClientStub);

    sinon.assert.calledWithMatch(
      vsCodeStub.window.showErrorMessage,
      sinon.match(/Unsupported Colab link format/),
    );
  });

  it('does nothing when save dialog is cancelled', async () => {
    const url = 'https://colab.research.google.com/drive/123';
    vsCodeStub.window.showInputBox.resolves(url);
    driveClientStub.getDriveFileName.resolves('notebook.ipynb');
    vsCodeStub.window.showSaveDialog.resolves(undefined);

    await importNotebookFromUrl(vsCodeStub.asVsCode(), driveClientStub);

    sinon.assert.calledWith(driveClientStub.getDriveFileName, '123');
    sinon.assert.called(vsCodeStub.window.showSaveDialog);
    sinon.assert.notCalled(driveClientStub.getDriveFileContent);
  });

  for (const { name, url, fileId, inputUrl } of [
    {
      name: 'imports notebook from Colab URL',
      url: 'https://colab.research.google.com/drive/123',
      fileId: '123',
      inputUrl: undefined,
    },
    {
      name: 'imports notebook from sandbox Colab URL',
      url: 'https://colab.sandbox.google.com/drive/123',
      fileId: '123',
      inputUrl: undefined,
    },
    {
      name: 'imports notebook from Drive URL',
      url: 'https://drive.google.com/file/d/456/view',
      fileId: '456',
      inputUrl: undefined,
    },
    {
      name: 'imports notebook from older Drive URL',
      url: 'https://drive.google.com/open?id=456',
      fileId: '456',
      inputUrl: undefined,
    },
    {
      name: 'imports notebook from older Drive URL with multiple query params',
      url: 'https://drive.google.com/open?authuser=1&id=456',
      fileId: '456',
      inputUrl: undefined,
    },
    {
      name: 'uses the provided inputUrl argument and skips the input box prompt',
      url: 'https://colab.research.google.com/drive/789',
      fileId: '789',
      inputUrl: 'https://colab.research.google.com/drive/789',
    },
  ]) {
    it(name, async () => {
      const fileName = 'notebook.ipynb';
      const fileContent = new Uint8Array([1, 2, 3]);
      const saveUri = TestUri.parse('file:///path/to/save/notebook.ipynb');

      if (!inputUrl) {
        vsCodeStub.window.showInputBox.resolves(url);
      }
      driveClientStub.getDriveFileName.withArgs(fileId).resolves(fileName);
      vsCodeStub.window.showSaveDialog.resolves(saveUri);
      driveClientStub.getDriveFileContent
        .withArgs(fileId)
        .resolves(fileContent);
      const doc: Partial<NotebookDocument> = { uri: saveUri };
      vsCodeStub.workspace.openNotebookDocument.resolves(
        doc as NotebookDocument,
      );

      await importNotebookFromUrl(
        vsCodeStub.asVsCode(),
        driveClientStub,
        inputUrl,
      );

      if (inputUrl) {
        sinon.assert.notCalled(vsCodeStub.window.showInputBox);
      } else {
        sinon.assert.called(vsCodeStub.window.showInputBox);
      }

      sinon.assert.calledWith(driveClientStub.getDriveFileName, fileId);
      sinon.assert.calledWith(driveClientStub.getDriveFileContent, fileId);
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
    });
  }

  it('handles known errors', async () => {
    const url = 'https://colab.research.google.com/drive/123';
    vsCodeStub.window.showInputBox.resolves(url);
    driveClientStub.getDriveFileName.rejects(new Error('Network error'));

    await importNotebookFromUrl(vsCodeStub.asVsCode(), driveClientStub);

    sinon.assert.calledWith(
      vsCodeStub.window.showErrorMessage,
      'Failed to import notebook: Network error',
    );
  });

  it('handles unknown errors', async () => {
    const url = 'https://colab.research.google.com/drive/123';
    vsCodeStub.window.showInputBox.resolves(url);
    // To simulate an unknown (non-Error) rejection
    driveClientStub.getDriveFileName.rejects({
      toString: () => 'Unknown error',
    });

    await importNotebookFromUrl(vsCodeStub.asVsCode(), driveClientStub);

    sinon.assert.calledWithMatch(
      vsCodeStub.window.showErrorMessage,
      sinon.match(/An unknown error occurred/),
    );
  });

  describe('validateImportUrl', () => {
    it('returns undefined for empty input', () => {
      expect(TEST_ONLY.validateImportUrl('')).to.be.undefined;
    });

    it('returns undefined for a valid URL', () => {
      expect(TEST_ONLY.validateImportUrl('colab.research.google.com/drive/123'))
        .to.be.undefined;
    });

    it('returns an error message for an unsupported URL format', () => {
      expect(TEST_ONLY.validateImportUrl('https://invalid-url.com')).to.match(
        /Unsupported Colab link format/,
      );
    });

    it('returns an error message for a malformed string', () => {
      expect(TEST_ONLY.validateImportUrl('^not-a-url')).to.equal(
        'Invalid URL string provided.',
      );
    });
  });
});
