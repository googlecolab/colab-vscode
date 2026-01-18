/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import sinon, { SinonStubbedInstance } from 'sinon';
import { NotebookEditor, Uri } from 'vscode';
import WebSocket from 'ws';
import { ColabClient } from '../colab/client';
import { TestUri } from '../test/helpers/uri';
import { newVsCodeStub, VsCodeStub } from '../test/helpers/vscode';
import { handleDriveFsAuth } from './drive';

describe('handleDriveFsAuth', () => {
  const testEndpoint = 'test-endpoint';
  const testRequestMessageId = 1;
  const testFileId = 'test-file-id';
  let vsCodeStub: VsCodeStub;
  let colabClientStub: SinonStubbedInstance<ColabClient>;
  let webSocketStub: SinonStubbedInstance<WebSocket>;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    vsCodeStub.window.activeNotebookEditor = {
      notebook: {
        uri: TestUri.from({ scheme: '', path: testFileId }),
      },
    } as SinonStubbedInstance<NotebookEditor>;

    colabClientStub = sinon.createStubInstance(ColabClient);
    colabClientStub.propagateDriveCredentials
      .withArgs(testEndpoint, {
        dryRun: false,
        authType: 'dfs_ephemeral',
        fileId: testFileId,
      })
      .resolves({ success: true, unauthorizedRedirectUri: undefined });

    webSocketStub = sinon.createStubInstance(WebSocket);
  });

  describe('with no existing authorization', () => {
    const testUnauthorizedRedirectUri = 'http://test-oauth-uri';

    beforeEach(() => {
      colabClientStub.propagateDriveCredentials
        .withArgs(testEndpoint, {
          dryRun: true,
          authType: 'dfs_ephemeral',
          fileId: testFileId,
        })
        .resolves({
          success: false,
          unauthorizedRedirectUri: testUnauthorizedRedirectUri,
        });
    });

    it('shows consent prompt', async () => {
      await handleDriveFsAuth(
        vsCodeStub.asVsCode(),
        webSocketStub,
        colabClientStub,
        testEndpoint,
        testRequestMessageId,
      );

      sinon.assert.calledOnceWithMatch(
        vsCodeStub.window.showInformationMessage,
        sinon.match('Permit this notebook to access your Google Drive files'),
      );
    });

    it('opens unauthorized redirect URI and shows "continue" dialog if consented', async () => {
      (vsCodeStub.window.showInformationMessage as sinon.SinonStub)
        .withArgs(
          sinon.match('Permit this notebook to access your Google Drive files'),
        )
        .resolves('Connect to Google Drive');

      await handleDriveFsAuth(
        vsCodeStub.asVsCode(),
        webSocketStub,
        colabClientStub,
        testEndpoint,
        testRequestMessageId,
      );

      sinon.assert.calledOnceWithMatch(
        vsCodeStub.env.openExternal,
        sinon.match(function (url: Uri) {
          return url.toString().startsWith(testUnauthorizedRedirectUri);
        }),
      );
      sinon.assert.calledWithMatch(
        vsCodeStub.window.showInformationMessage,
        sinon.match(
          'Please complete the authorization in your browser. If done, click "Continue"',
        ),
      );
    });

    it('sends error reply if not consented', async () => {
      (vsCodeStub.window.showInformationMessage as sinon.SinonStub)
        .withArgs(
          sinon.match('Permit this notebook to access your Google Drive files'),
        )
        .resolves(undefined);

      await handleDriveFsAuth(
        vsCodeStub.asVsCode(),
        webSocketStub,
        colabClientStub,
        testEndpoint,
        testRequestMessageId,
      );

      sinon.assert.notCalled(vsCodeStub.env.openExternal);
      sinon.assert.calledOnceWithMatch(
        webSocketStub.send,
        sinon.match(function (data: string) {
          return (
            data.includes('error') &&
            data.includes('User cancelled Google Drive authorization')
          );
        }),
      );
    });

    it('propagates credentials and sends reply if continued', async () => {
      (vsCodeStub.window.showInformationMessage as sinon.SinonStub)
        .withArgs(
          sinon.match('Permit this notebook to access your Google Drive files'),
        )
        .resolves('Connect to Google Drive');
      (vsCodeStub.window.showInformationMessage as sinon.SinonStub)
        .withArgs(
          sinon.match('Please complete the authorization in your browser'),
        )
        .resolves('Continue');

      await handleDriveFsAuth(
        vsCodeStub.asVsCode(),
        webSocketStub,
        colabClientStub,
        testEndpoint,
        testRequestMessageId,
      );

      sinon.assert.calledWithExactly(
        colabClientStub.propagateDriveCredentials,
        testEndpoint,
        {
          dryRun: false,
          authType: 'dfs_ephemeral',
          fileId: testFileId,
        },
      );
      sinon.assert.calledOnceWithMatch(
        webSocketStub.send,
        sinon.match(function (data: string) {
          return (
            data.includes('input_reply') &&
            data.includes('colab_reply') &&
            data.includes(`"colab_msg_id":${String(testRequestMessageId)}`) &&
            !data.includes('error')
          );
        }),
      );
    });

    it('sends error reply if not continued', async () => {
      (vsCodeStub.window.showInformationMessage as sinon.SinonStub)
        .withArgs(
          sinon.match('Permit this notebook to access your Google Drive files'),
        )
        .resolves('Connect to Google Drive');
      (vsCodeStub.window.showInformationMessage as sinon.SinonStub)
        .withArgs(
          sinon.match('Please complete the authorization in your browser'),
        )
        .resolves(undefined);

      await handleDriveFsAuth(
        vsCodeStub.asVsCode(),
        webSocketStub,
        colabClientStub,
        testEndpoint,
        testRequestMessageId,
      );

      sinon.assert.calledOnceWithMatch(
        webSocketStub.send,
        sinon.match(function (data: string) {
          return (
            data.includes('error') &&
            data.includes('User cancelled Google Drive authorization')
          );
        }),
      );
    });
  });

  describe('with existing authorization', () => {
    beforeEach(() => {
      colabClientStub.propagateDriveCredentials
        .withArgs(testEndpoint, {
          dryRun: true,
          authType: 'dfs_ephemeral',
          fileId: testFileId,
        })
        .resolves({
          success: true,
          unauthorizedRedirectUri: undefined,
        });
    });

    it('skips prompt and sends reply', async () => {
      await handleDriveFsAuth(
        vsCodeStub.asVsCode(),
        webSocketStub,
        colabClientStub,
        testEndpoint,
        testRequestMessageId,
      );

      sinon.assert.notCalled(vsCodeStub.window.showInformationMessage);
      sinon.assert.notCalled(vsCodeStub.env.openExternal);
      sinon.assert.calledWithExactly(
        colabClientStub.propagateDriveCredentials,
        testEndpoint,
        {
          dryRun: false,
          authType: 'dfs_ephemeral',
          fileId: testFileId,
        },
      );
      sinon.assert.calledOnceWithMatch(
        webSocketStub.send,
        sinon.match(function (data: string) {
          return (
            data.includes('input_reply') &&
            data.includes('colab_reply') &&
            data.includes(`"colab_msg_id":${String(testRequestMessageId)}`) &&
            !data.includes('error')
          );
        }),
      );
    });

    it('sends error reply if credentials propagation API failed', async () => {
      colabClientStub.propagateDriveCredentials
        .withArgs(testEndpoint, {
          dryRun: false,
          authType: 'dfs_ephemeral',
          fileId: testFileId,
        })
        .rejects(new Error('Credentials propagation failed'));

      await handleDriveFsAuth(
        vsCodeStub.asVsCode(),
        webSocketStub,
        colabClientStub,
        testEndpoint,
        testRequestMessageId,
      );

      sinon.assert.calledOnceWithMatch(
        webSocketStub.send,
        sinon.match(function (data: string) {
          return (
            data.includes('error') &&
            data.includes('Credentials propagation failed')
          );
        }),
      );
    });

    it('sends error reply if credentials propagation returns unsuccessful', async () => {
      colabClientStub.propagateDriveCredentials
        .withArgs(testEndpoint, {
          dryRun: false,
          authType: 'dfs_ephemeral',
          fileId: testFileId,
        })
        .resolves({ success: false, unauthorizedRedirectUri: undefined });

      await handleDriveFsAuth(
        vsCodeStub.asVsCode(),
        webSocketStub,
        colabClientStub,
        testEndpoint,
        testRequestMessageId,
      );

      sinon.assert.calledOnceWithMatch(
        webSocketStub.send,
        sinon.match(function (data: string) {
          return (
            data.includes('error') &&
            data.includes('Credentials propagation unsuccessful')
          );
        }),
      );
    });
  });
});
