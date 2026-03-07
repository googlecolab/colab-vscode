/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon, { SinonStubbedInstance } from 'sinon';
import { ColabClient } from './client';
import { DriveProvider } from './drive-provider';

describe('DriveProvider', () => {
  let colabClientStub: SinonStubbedInstance<ColabClient>;
  let provider: DriveProvider;

  beforeEach(() => {
    colabClientStub = sinon.createStubInstance(ColabClient);
    provider = new DriveProvider(colabClientStub);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('getDriveFileName', () => {
    it('should return the file name from metadata', async () => {
      const fileId = 'test-file-id';
      const fileName = 'test-notebook.ipynb';
      colabClientStub.getDriveFileMetadata
        .withArgs(fileId)
        .resolves({ name: fileName });

      const result = await provider.getDriveFileName(fileId);

      expect(result).to.equal(fileName);
      sinon.assert.calledOnceWithExactly(
        colabClientStub.getDriveFileMetadata,
        fileId,
      );
    });

    it('should propagate errors from the client', async () => {
      const fileId = 'test-file-id';
      const error = new Error('API error');
      colabClientStub.getDriveFileMetadata.withArgs(fileId).rejects(error);

      await expect(provider.getDriveFileName(fileId)).to.be.rejectedWith(error);
    });
  });

  describe('getDriveFileContent', () => {
    it('should return the file content from the client', async () => {
      const fileId = 'test-file-id';
      const fileContent = new Uint8Array([1, 2, 3]);
      colabClientStub.fetchDriveFileContent
        .withArgs(fileId)
        .resolves(fileContent);

      const result = await provider.getDriveFileContent(fileId);

      expect(result).to.deep.equal(fileContent);
      sinon.assert.calledOnceWithExactly(
        colabClientStub.fetchDriveFileContent,
        fileId,
      );
    });

    it('should propagate errors from the client', async () => {
      const fileId = 'test-file-id';
      const error = new Error('Fetch error');
      colabClientStub.fetchDriveFileContent.withArgs(fileId).rejects(error);

      await expect(provider.getDriveFileContent(fileId)).to.be.rejectedWith(
        error,
      );
    });
  });
});
