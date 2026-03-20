/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon, { SinonStubbedInstance, match } from 'sinon';
import { DRIVE_SCOPES } from '../auth/scopes';
import { DriveClient } from './drive-client';
import { Transport } from './transport';

describe('DriveClient', () => {
  let transportStub: SinonStubbedInstance<Transport>;
  let client: DriveClient;

  beforeEach(() => {
    transportStub = sinon.createStubInstance(Transport);
    client = new DriveClient(transportStub);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('getDriveFileName', () => {
    it('should return the file name from metadata', async () => {
      const fileId = 'test-file-id';
      const fileName = 'test-notebook.ipynb';
      const mockMetadata = { name: fileName };
      transportStub.issueRequestAndParse.resolves(mockMetadata);

      const result = await client.getDriveFileName(fileId);

      expect(result).to.equal(fileName);
      sinon.assert.calledOnce(transportStub.issueRequestAndParse);
      sinon.assert.calledWith(
        transportStub.issueRequestAndParse,
        match(
          (url: URL) =>
            url.href.includes(fileId) &&
            url.searchParams.get('fields') === 'name',
        ),
        match({ method: 'GET' }),
        match.any,
        match({ scopes: DRIVE_SCOPES }),
      );
    });

    it('should propagate errors from the transport', async () => {
      const fileId = 'test-file-id';
      const error = new Error('API error');
      transportStub.issueRequestAndParse.rejects(error);

      await expect(client.getDriveFileName(fileId)).to.be.rejectedWith(error);
    });
  });

  describe('getDriveFileContent', () => {
    it('should return the file content from the transport', async () => {
      const fileId = 'test-file-id';
      const fileContent = { cells: [], metadata: {} };
      const expectedContent = new TextEncoder().encode(
        JSON.stringify(fileContent),
      );
      transportStub.issueRequestAndParse.resolves(fileContent);

      const result = await client.getDriveFileContent(fileId);

      expect(result).to.deep.equal(expectedContent);
      sinon.assert.calledOnce(transportStub.issueRequestAndParse);
      sinon.assert.calledWith(
        transportStub.issueRequestAndParse,
        match(
          (url: URL) =>
            url.href.includes(fileId) &&
            url.searchParams.get('alt') === 'media',
        ),
        match({ method: 'GET' }),
        match.any,
        match({ scopes: DRIVE_SCOPES }),
      );
    });

    it('should propagate errors from the transport', async () => {
      const fileId = 'test-file-id';
      const error = new Error('Fetch error');
      transportStub.issueRequestAndParse.rejects(error);

      await expect(client.getDriveFileContent(fileId)).to.be.rejectedWith(
        error,
      );
    });
  });

  describe('getDriveFileMetadata', () => {
    it('should return the file metadata from the transport', async () => {
      const fileId = 'test-file-id';
      const mockMetadata = { name: 'my-notebook.ipynb' };
      transportStub.issueRequestAndParse.resolves(mockMetadata);

      const result = await client.getDriveFileMetadata(fileId);

      expect(result).to.deep.equal(mockMetadata);
      sinon.assert.calledOnce(transportStub.issueRequestAndParse);
      sinon.assert.calledWith(
        transportStub.issueRequestAndParse,
        match(
          (url: URL) =>
            url.href.includes(fileId) &&
            url.searchParams.get('fields') === 'name',
        ),
        match({ method: 'GET' }),
        match.any,
        match({ scopes: DRIVE_SCOPES }),
      );
    });

    it('should propagate errors from the transport', async () => {
      const fileId = 'test-file-id';
      const error = new Error('Metadata error');
      transportStub.issueRequestAndParse.rejects(error);

      await expect(client.getDriveFileMetadata(fileId)).to.be.rejectedWith(
        error,
      );
    });
  });
});
