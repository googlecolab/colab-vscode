/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon, { SinonStubbedInstance } from 'sinon';
import { Uri } from 'vscode';
import { ColabClient } from '../colab/client';
import { ColabAssignedServer } from '../jupyter/servers';
import { newVsCodeStub, VsCodeStub } from '../test/helpers/vscode';
import { handleDriveFsAuth } from './drive';

describe('handleDriveFsAuth', () => {
  const testServer = {
    label: 'Test Server',
    endpoint: 'test-endpoint',
  } as ColabAssignedServer;
  let vsCodeStub: VsCodeStub;
  let colabClientStub: SinonStubbedInstance<ColabClient>;

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
  });

  it('throws an error if credentials propagation dry run failed', async () => {
    const errMsg = 'Credentials propagation dry run failed';
    colabClientStub.propagateDriveCredentials
      .withArgs(testServer.endpoint, {
        dryRun: true,
        authType: 'dfs_ephemeral',
      })
      .rejects(new Error(errMsg));

    const promise = handleDriveFsAuth(
      vsCodeStub.asVsCode(),
      colabClientStub,
      testServer,
    );

    await expect(promise).to.be.rejectedWith(errMsg);
  });

  it('throws an error if credentials propagation dry run returned unexpected results', async () => {
    colabClientStub.propagateDriveCredentials
      .withArgs(testServer.endpoint, {
        dryRun: true,
        authType: 'dfs_ephemeral',
      })
      .resolves({
        success: false,
        unauthorizedRedirectUri: undefined,
      });

    const promise = handleDriveFsAuth(
      vsCodeStub.asVsCode(),
      colabClientStub,
      testServer,
    );

    await expect(promise).to.be.rejectedWith(
      /Credentials propagation dry run returned unexpected results/,
    );
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

    it('shows consent prompt and throws an error if user not consented', async () => {
      const promise = handleDriveFsAuth(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
      );

      await expect(promise).to.be.rejectedWith(
        'User cancelled Google Drive authorization',
      );
      sinon.assert.calledOnceWithMatch(
        vsCodeStub.window.showInformationMessage,
        sinon.match(
          `Permit "${testServer.label}" to access your Google Drive files`,
        ),
      );
      sinon.assert.notCalled(vsCodeStub.env.openExternal);
      sinon.assert.neverCalledWith(
        colabClientStub.propagateDriveCredentials,
        testServer.endpoint,
        {
          dryRun: false,
          authType: 'dfs_ephemeral',
        },
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

      it('opens unauthorized redirect URI, shows "continue" dialog, and propagates credentials if user continued', async () => {
        (vsCodeStub.window.showInformationMessage as sinon.SinonStub)
          .withArgs(
            sinon.match('Please complete the authorization in your browser'),
          )
          .resolves('Continue');

        await handleDriveFsAuth(
          vsCodeStub.asVsCode(),
          colabClientStub,
          testServer,
        );

        sinon.assert.calledOnceWithMatch(
          vsCodeStub.env.openExternal,
          sinon.match(function (url: Uri) {
            return url.toString().startsWith(testUnauthorizedRedirectUri);
          }),
        );
        sinon.assert.calledWithExactly(
          colabClientStub.propagateDriveCredentials,
          testServer.endpoint,
          {
            dryRun: false,
            authType: 'dfs_ephemeral',
          },
        );
      });

      it('throws an error if user not continued', async () => {
        const promise = handleDriveFsAuth(
          vsCodeStub.asVsCode(),
          colabClientStub,
          testServer,
        );

        await expect(promise).to.be.rejectedWith(
          'User cancelled Google Drive authorization',
        );
        sinon.assert.neverCalledWith(
          colabClientStub.propagateDriveCredentials,
          testServer.endpoint,
          {
            dryRun: false,
            authType: 'dfs_ephemeral',
          },
        );
      });
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

    it('skips prompt and propagates credentials', async () => {
      await handleDriveFsAuth(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
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
    });

    it('throws an error if credentials propagation API failed', async () => {
      const errMsg = 'Credentials propagation failed';
      colabClientStub.propagateDriveCredentials
        .withArgs(testServer.endpoint, {
          dryRun: false,
          authType: 'dfs_ephemeral',
        })
        .rejects(new Error(errMsg));

      const promise = handleDriveFsAuth(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
      );

      await expect(promise).to.be.rejectedWith(errMsg);
    });

    it('throws an error if credentials propagation returns unsuccessful', async () => {
      colabClientStub.propagateDriveCredentials
        .withArgs(testServer.endpoint, {
          dryRun: false,
          authType: 'dfs_ephemeral',
        })
        .resolves({
          success: false,
          unauthorizedRedirectUri: undefined,
        });

      const promise = handleDriveFsAuth(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
      );

      await expect(promise).to.be.rejectedWith(
        'Credentials propagation unsuccessful',
      );
    });
  });
});
