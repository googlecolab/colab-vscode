/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'crypto';
import sinon, { SinonStubbedInstance } from 'sinon';
import { QuickPickItem } from 'vscode';
import { AssignmentManager } from '../../jupyter/assignments';
import { TestUri } from '../../test/helpers/uri';
import { newVsCodeStub, VsCodeStub } from '../../test/helpers/vscode';
import { Variant } from '../api';
import { uploadFile } from './files';

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
        vsCodeStub.CancellationTokenSource.prototype.token,
      );
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('uploadFile', () => {
    const fileUri = TestUri.parse('file:///local/path/to/my-file.txt');

    it('shows a warning when no servers are assigned', async () => {
      // Type assertion needed due to overloading.
      (assignmentManagerStub.getServers as sinon.SinonStub)
        .withArgs('extension')
        .resolves([]);

      await uploadFile(vsCodeStub.asVsCode(), assignmentManagerStub, fileUri);

      sinon.assert.calledWith(
        vsCodeStub.window.showWarningMessage,
        'No Colab servers found.',
      );
      sinon.assert.notCalled(vsCodeStub.workspace.fs.readFile);
    });

    it('auto-selects the server when only one is assigned', async () => {
      // Type assertion needed due to overloading.
      (assignmentManagerStub.getServers as sinon.SinonStub)
        .withArgs('extension')
        .resolves([DEFAULT_SERVER]);
      const fileContent = new Uint8Array([1, 2, 3]);
      vsCodeStub.workspace.fs.readFile.resolves(fileContent);

      await uploadFile(vsCodeStub.asVsCode(), assignmentManagerStub, fileUri);

      sinon.assert.notCalled(vsCodeStub.window.showQuickPick);
      sinon.assert.calledWith(
        vsCodeStub.workspace.fs.writeFile,
        TestUri.parse('colab://m-s-foo/my-file.txt'),
        fileContent,
      );
      sinon.assert.calledWithMatch(
        vsCodeStub.window.showInformationMessage,
        sinon.match(/Successfully imported/),
      );
    });

    it('prompts user to select a server when multiple are assigned', async () => {
      const otherServer = { ...DEFAULT_SERVER, id: randomUUID(), label: 'bar' };
      // Type assertion needed due to overloading.
      (assignmentManagerStub.getServers as sinon.SinonStub)
        .withArgs('extension')
        .resolves([DEFAULT_SERVER, otherServer]);
      vsCodeStub.window.showQuickPick.resolves({
        label: otherServer.label,
        value: otherServer,
      } as QuickPickItem);
      const fileContent = new Uint8Array([4, 5, 6]);
      vsCodeStub.workspace.fs.readFile.resolves(fileContent);

      await uploadFile(vsCodeStub.asVsCode(), assignmentManagerStub, fileUri);

      sinon.assert.calledWith(
        vsCodeStub.workspace.fs.writeFile,
        TestUri.parse('colab://m-s-foo/my-file.txt'),
        fileContent,
      );
      sinon.assert.calledWithMatch(
        vsCodeStub.window.showInformationMessage,
        sinon.match(/Successfully imported/),
      );
    });

    it('does nothing if server selection is cancelled', async () => {
      const otherServer = { ...DEFAULT_SERVER, id: randomUUID(), label: 'bar' };
      // Type assertion needed due to overloading.
      (assignmentManagerStub.getServers as sinon.SinonStub)
        .withArgs('extension')
        .resolves([DEFAULT_SERVER, otherServer]);
      vsCodeStub.window.showQuickPick.resolves(undefined);

      await uploadFile(vsCodeStub.asVsCode(), assignmentManagerStub, fileUri);

      sinon.assert.calledOnce(vsCodeStub.window.showQuickPick);
      sinon.assert.notCalled(vsCodeStub.workspace.fs.readFile);
      sinon.assert.notCalled(vsCodeStub.workspace.fs.writeFile);
    });

    it('shows error message if file operation fails', async () => {
      // Type assertion needed due to overloading.
      (assignmentManagerStub.getServers as sinon.SinonStub)
        .withArgs('extension')
        .resolves([DEFAULT_SERVER]);
      const error = new Error('🤮');
      vsCodeStub.workspace.fs.readFile.rejects(error);

      await uploadFile(vsCodeStub.asVsCode(), assignmentManagerStub, fileUri);

      sinon.assert.calledWithMatch(
        vsCodeStub.window.showErrorMessage,
        sinon.match(/🤮/),
      );
    });
  });
});
