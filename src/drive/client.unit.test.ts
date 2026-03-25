/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import fetch, { Request, Response } from 'node-fetch';
import sinon, { SinonStub } from 'sinon';
import { AUTHORIZATION_HEADER } from '../colab/headers';
import { DriveClient } from './client';

const FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files';
const BEARER_TOKEN = 'mock-token';

describe('DriveClient', () => {
  let fetchStub: sinon.SinonStubbedMember<typeof fetch>;
  let getAccessTokenStub: SinonStub<[], Promise<string>>;
  let onAuthErrorStub: SinonStub<[], Promise<void>>;
  let client: DriveClient;

  beforeEach(() => {
    fetchStub = sinon.stub(fetch, 'default').callsFake(() => {
      throw new Error('Unexpected fetch call');
    });
    getAccessTokenStub = sinon
      .stub<[], Promise<string>>()
      .resolves(BEARER_TOKEN);
    onAuthErrorStub = sinon.stub();
    client = DriveClient.create(getAccessTokenStub, onAuthErrorStub);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('getDriveFileContent', () => {
    it('should return the file content', async () => {
      const fileId = 'test-file-id';
      const fileContent = { cells: [], metadata: {} };
      const expectedContent = new TextEncoder().encode(
        JSON.stringify(fileContent),
      );
      fetchStub.resolves(
        new Response(JSON.stringify(fileContent), { status: 200 }),
      );

      const result = await client.getDriveFileContent(fileId);

      expect(result).to.deep.equal(expectedContent);
      sinon.assert.calledOnce(fetchStub);
      sinon.assert.calledWithMatch(
        fetchStub,
        sinon.match((req: Request) => {
          return (
            req.method === 'GET' &&
            req.url === `${FILES_ENDPOINT}/${fileId}?alt=media` &&
            req.headers.get(AUTHORIZATION_HEADER.key) ===
              `Bearer ${BEARER_TOKEN}`
          );
        }),
      );
    });

    it('should propagate errors', async () => {
      const fileId = 'test-file-id';
      const error = new Error('Fetch error');
      fetchStub.rejects(error);

      await expect(client.getDriveFileContent(fileId)).to.be.rejectedWith(
        error,
      );
    });
  });

  describe('getDriveFileMetadata', () => {
    it('should return the file metadata', async () => {
      const fileId = 'test-file-id';
      const mockMetadata = { name: 'my-notebook.ipynb' };
      fetchStub.resolves(
        new Response(JSON.stringify(mockMetadata), { status: 200 }),
      );

      const result = await client.getDriveFileMetadata(fileId);

      expect(result).to.deep.equal(mockMetadata);
      sinon.assert.calledOnce(fetchStub);
      sinon.assert.calledWithMatch(
        fetchStub,
        sinon.match((req: Request) => {
          return (
            req.method === 'GET' &&
            req.url === `${FILES_ENDPOINT}/${fileId}?fields=name` &&
            req.headers.get(AUTHORIZATION_HEADER.key) ===
              `Bearer ${BEARER_TOKEN}`
          );
        }),
      );
    });

    it('should propagate errors', async () => {
      const fileId = 'test-file-id';
      const error = new Error('Metadata error');
      fetchStub.rejects(error);

      await expect(client.getDriveFileMetadata(fileId)).to.be.rejectedWith(
        error,
      );
    });
  });

  describe('getDriveFileName', () => {
    it('should return the file name from metadata', async () => {
      const fileId = 'test-file-id';
      const fileName = 'test-notebook.ipynb';
      const mockMetadata = { name: fileName };
      fetchStub.resolves(
        new Response(JSON.stringify(mockMetadata), { status: 200 }),
      );

      const result = await client.getDriveFileName(fileId);

      expect(result).to.equal(fileName);
      sinon.assert.calledOnce(fetchStub);
      sinon.assert.calledWithMatch(
        fetchStub,
        sinon.match((req: Request) => {
          return (
            req.method === 'GET' &&
            req.url === `${FILES_ENDPOINT}/${fileId}?fields=name` &&
            req.headers.get(AUTHORIZATION_HEADER.key) ===
              `Bearer ${BEARER_TOKEN}`
          );
        }),
      );
    });

    it('should propagate errors', async () => {
      const fileId = 'test-file-id';
      const error = new Error('API error');
      fetchStub.rejects(error);

      await expect(client.getDriveFileName(fileId)).to.be.rejectedWith(error);
    });
  });
});
