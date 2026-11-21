/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { expect } from 'chai';
import { Response } from 'node-fetch';
import sinon from 'sinon';
import { AssignmentManager } from '../../jupyter/assignments';
import { ColabAssignedServer } from '../../jupyter/servers';
import { TestFileSystemError } from '../../test/helpers/errors';
import { TestUri } from '../../test/helpers/uri';
import { FileType, newVsCodeStub, VsCodeStub } from '../../test/helpers/vscode';
import { Variant } from '../types';
import { StreamingFileDownloader } from './file-downloader';

describe('StreamingFileDownloader', () => {
  let assignments: sinon.SinonStubbedInstance<AssignmentManager>;
  let fetchFile: sinon.SinonStub;
  let server: ColabAssignedServer;
  let temporaryDirectory: string;
  let vsStub: VsCodeStub;

  beforeEach(async () => {
    assignments = sinon.createStubInstance(AssignmentManager);
    fetchFile = sinon.stub();
    server = {
      id: 'r-abc123',
      label: 'Colab CPU',
      variant: Variant.DEFAULT,
      endpoint: 'm-s-foo',
      connectionInformation: {
        baseUrl: TestUri.parse('https://example.com/'),
        token: '123',
        tokenExpiry: new Date(Date.now() + 1000),
        headers: {},
        fetch: fetchFile,
      },
      dateAssigned: new Date(),
    };
    (assignments.getServers as sinon.SinonStub)
      .withArgs('extension')
      .resolves([server]);
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'colab-download-'));
    vsStub = newVsCodeStub();
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { force: true, recursive: true });
    sinon.restore();
  });

  it('streams a remote file to the local filesystem', async () => {
    const content = Buffer.from([1, 2, 3, 4, 5]);
    fetchFile.resolves(new Response(content));
    const source = new TestUri(
      'colab',
      'r-abc123',
      '/content/folder/file name.bin',
      '',
      '',
    );
    const destinationPath = join(temporaryDirectory, 'file name.bin');
    const destination = TestUri.file(destinationPath);
    const downloader = new StreamingFileDownloader(
      vsStub.asVsCode(),
      assignments,
    );

    const downloadedBytes = await downloader.download(source, destination);

    expect(downloadedBytes).to.equal(content.byteLength);
    expect(await readFile(destinationPath)).to.deep.equal(content);
    sinon.assert.calledOnceWithExactly(
      fetchFile,
      'https://example.com/files/content/folder/file%20name.bin',
    );
    expect(await readdir(temporaryDirectory)).to.deep.equal(['file name.bin']);
  });

  it('fails without leaving a partial file when the server rejects the request', async () => {
    fetchFile.resolves(
      new Response(undefined, { status: 404, statusText: 'Not Found' }),
    );
    const downloader = new StreamingFileDownloader(
      vsStub.asVsCode(),
      assignments,
    );

    await expect(
      downloader.download(
        TestUri.parse('colab://r-abc123/content/missing.bin'),
        TestUri.file(join(temporaryDirectory, 'missing.bin')),
      ),
    ).to.be.rejectedWith('Download request failed: 404 Not Found');

    expect(await readdir(temporaryDirectory)).to.be.empty;
  });

  it('fails when the source server is unavailable', async () => {
    (assignments.getServers as sinon.SinonStub)
      .withArgs('extension')
      .resolves([]);
    const downloader = new StreamingFileDownloader(
      vsStub.asVsCode(),
      assignments,
    );

    await expect(
      downloader.download(
        TestUri.parse('colab://r-abc123/content/foo.bin'),
        TestUri.file(join(temporaryDirectory, 'foo.bin')),
      ),
    ).to.be.rejectedWith('Colab server "r-abc123" is not available');
  });

  it('streams multiple chunks and replaces an existing file', async () => {
    const destinationPath = join(temporaryDirectory, 'existing.bin');
    await writeFile(destinationPath, 'original');
    fetchFile.resolves(
      new Response(
        Readable.from([Buffer.from('new '), Buffer.from('content')]),
      ),
    );

    const downloadedBytes = await new StreamingFileDownloader(
      vsStub.asVsCode(),
      assignments,
    ).download(
      TestUri.parse('colab://r-abc123/content/existing.bin'),
      TestUri.file(destinationPath),
    );

    expect(downloadedBytes).to.equal(11);
    expect(await readFile(destinationPath, 'utf8')).to.equal('new content');
    expect(await readdir(temporaryDirectory)).to.deep.equal(['existing.bin']);
  });

  it('preserves an existing file when the response stream fails', async () => {
    const destinationPath = join(temporaryDirectory, 'existing.bin');
    await writeFile(destinationPath, 'original');
    fetchFile.resolves(
      new Response(
        Readable.from(
          (function* () {
            yield Buffer.from('partial');
            throw new Error('connection interrupted');
          })(),
        ),
      ),
    );

    await expect(
      new StreamingFileDownloader(vsStub.asVsCode(), assignments).download(
        TestUri.parse('colab://r-abc123/content/existing.bin'),
        TestUri.file(destinationPath),
      ),
    ).to.be.rejectedWith('connection interrupted');

    expect(await readFile(destinationPath, 'utf8')).to.equal('original');
    expect(await readdir(temporaryDirectory)).to.deep.equal(['existing.bin']);
  });

  it('supports a destination with a long basename', async () => {
    const destinationPath = join(temporaryDirectory, `${'a'.repeat(224)}.bin`);
    fetchFile.resolves(new Response('content'));

    await new StreamingFileDownloader(vsStub.asVsCode(), assignments).download(
      TestUri.parse('colab://r-abc123/content/file.bin'),
      TestUri.file(destinationPath),
    );

    expect(await readFile(destinationPath, 'utf8')).to.equal('content');
    expect(await readdir(temporaryDirectory)).to.deep.equal([
      `${'a'.repeat(224)}.bin`,
    ]);
  });

  it('copies to a provider sibling before committing the destination', async () => {
    fetchFile.resolves(new Response('content'));
    vsStub.workspace.fs.stat.rejects(TestFileSystemError.FileNotFound());
    const destination = TestUri.parse('vscode-local:/downloads/file.bin');

    await new StreamingFileDownloader(vsStub.asVsCode(), assignments).download(
      TestUri.parse('colab://r-abc123/content/file.bin'),
      destination,
    );

    sinon.assert.calledOnce(vsStub.workspace.fs.copy);
    const [source, temporary, options] =
      vsStub.workspace.fs.copy.firstCall.args;
    expect(source.scheme).to.equal('file');
    expect(temporary.scheme).to.equal('vscode-local');
    expect(temporary.path).to.match(/^\/downloads\/\.colab-.*\.tmp$/);
    expect(options).to.deep.equal({ overwrite: false });
    sinon.assert.calledOnceWithExactly(
      vsStub.workspace.fs.rename,
      temporary,
      destination,
      { overwrite: false },
    );
  });

  it('restores an existing provider destination if finalization fails', async () => {
    fetchFile.resolves(new Response('content'));
    const destination = TestUri.parse('vscode-local:/downloads/file.bin');
    vsStub.workspace.fs.stat.resolves({
      type: FileType.File,
      ctime: 0,
      mtime: 0,
      size: 8,
    });
    vsStub.workspace.fs.rename
      .onSecondCall()
      .rejects(new Error('commit failed'));

    await expect(
      new StreamingFileDownloader(vsStub.asVsCode(), assignments).download(
        TestUri.parse('colab://r-abc123/content/file.bin'),
        destination,
      ),
    ).to.be.rejectedWith('commit failed');

    sinon.assert.callCount(vsStub.workspace.fs.rename, 3);
    expect(vsStub.workspace.fs.rename.firstCall.args[0]).to.equal(destination);
    expect(vsStub.workspace.fs.rename.thirdCall.args[1]).to.equal(destination);
    expect(vsStub.workspace.fs.rename.thirdCall.args[2]).to.deep.equal({
      overwrite: false,
    });
  });

  it('does not replace a provider directory with a file', async () => {
    fetchFile.resolves(new Response('content'));
    vsStub.workspace.fs.stat.resolves({
      type: FileType.Directory,
      ctime: 0,
      mtime: 0,
      size: 0,
    });

    await expect(
      new StreamingFileDownloader(vsStub.asVsCode(), assignments).download(
        TestUri.parse('colab://r-abc123/content/file.bin'),
        TestUri.parse('vscode-local:/downloads/target'),
      ),
    ).to.be.rejectedWith('FileIsADirectory');

    sinon.assert.notCalled(vsStub.workspace.fs.rename);
  });
});
