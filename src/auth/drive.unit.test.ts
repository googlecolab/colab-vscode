/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import sinon, { SinonStubbedInstance } from 'sinon';
import { Uri } from 'vscode';
import WebSocket from 'ws';
import { ColabClient } from '../colab/client';
import { ColabAssignedServer } from '../jupyter/servers';
import { newVsCodeStub, VsCodeStub } from '../test/helpers/vscode';
import { handleDriveFsAuth } from './drive';

describe('handleDriveFsAuth', () => {
  const testServer = {
    label: 'Test Server',
    endpoint: 'test-endpoint',
  } as ColabAssignedServer;
  const testRequestMessageId = 1;
  let vsCodeStub: VsCodeStub;
  let colabClientStub: SinonStubbedInstance<ColabClient>;
  let webSocketStub: SinonStubbedInstance<WebSocket>;

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();

    colabClientStub = sinon.createStubInstance(ColabClient);
    colabClientStub.propagateDriveCredentials
      .withArgs(testServer.endpoint, {
        dryRun: false,
        authType: 'dfs_ephemeral',
      })
      .resolves({
        success: true,
        unauthorizedRedirectUri: undefined,
      });

    webSocketStub = sinon.createStubInstance(WebSocket);
  });

  describe('with no existing authorization', () => {
    const testUnauthorizedRedirectUri = 'http://test-oauth-uri';

    beforeEach(() => {
      colabClientStub.propagateDriveCredentials
        .withArgs(testServer.endpoint, {
          dryRun: true,
          authType: 'dfs_ephemeral',
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
        testServer,
        testRequestMessageId,
      );

      sinon.assert.calledOnceWithMatch(
        vsCodeStub.window.showInformationMessage,
        sinon.match(
          `Permit "${testServer.label}" to access your Google Drive files`,
        ),
      );
    });

    describe('with user consent to connect', () => {
      beforeEach(() => {
        (vsCodeStub.window.showInformationMessage as sinon.SinonStub)
          .withArgs(
            sinon.match(
              `Permit "${testServer.label}" to access your Google Drive files`,
            ),
          )
          .resolves('Connect to Google Drive');
      });

      it('opens unauthorized redirect URI and shows "continue" dialog', async () => {
        await handleDriveFsAuth(
          vsCodeStub.asVsCode(),
          webSocketStub,
          colabClientStub,
          testServer,
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
            'Please complete the authorization in your browser. Only once done, click "Continue"',
          ),
        );
      });

      it('propagates credentials and sends reply if user continued', async () => {
        (vsCodeStub.window.showInformationMessage as sinon.SinonStub)
          .withArgs(
            sinon.match('Please complete the authorization in your browser'),
          )
          .resolves('Continue');

        await handleDriveFsAuth(
          vsCodeStub.asVsCode(),
          webSocketStub,
          colabClientStub,
          testServer,
          testRequestMessageId,
        );

        sinon.assert.calledWithExactly(
          colabClientStub.propagateDriveCredentials,
          testServer.endpoint,
          {
            dryRun: false,
            authType: 'dfs_ephemeral',
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

      it('sends error reply if user not continued', async () => {
        await handleDriveFsAuth(
          vsCodeStub.asVsCode(),
          webSocketStub,
          colabClientStub,
          testServer,
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

    it('sends error reply if user not consented', async () => {
      await handleDriveFsAuth(
        vsCodeStub.asVsCode(),
        webSocketStub,
        colabClientStub,
        testServer,
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
  });

  describe('with existing authorization', () => {
    beforeEach(() => {
      colabClientStub.propagateDriveCredentials
        .withArgs(testServer.endpoint, {
          dryRun: true,
          authType: 'dfs_ephemeral',
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
        testServer,
        testRequestMessageId,
      );

      sinon.assert.notCalled(vsCodeStub.window.showInformationMessage);
      sinon.assert.notCalled(vsCodeStub.env.openExternal);
      sinon.assert.calledWithExactly(
        colabClientStub.propagateDriveCredentials,
        testServer.endpoint,
        {
          dryRun: false,
          authType: 'dfs_ephemeral',
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
        .withArgs(testServer.endpoint, {
          dryRun: false,
          authType: 'dfs_ephemeral',
        })
        .rejects(new Error('Credentials propagation failed'));

      await handleDriveFsAuth(
        vsCodeStub.asVsCode(),
        webSocketStub,
        colabClientStub,
        testServer,
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
        .withArgs(testServer.endpoint, {
          dryRun: false,
          authType: 'dfs_ephemeral',
        })
        .resolves({
          success: false,
          unauthorizedRedirectUri: undefined,
        });

      await handleDriveFsAuth(
        vsCodeStub.asVsCode(),
        webSocketStub,
        colabClientStub,
        testServer,
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
