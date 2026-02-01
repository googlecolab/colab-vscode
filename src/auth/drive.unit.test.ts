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

    colabClientStub.propagateCredentials
      .withArgs(testServer.endpoint, {
        dryRun: false,
        authType: 'dfs_ephemeral',
      })
      .resolves({
        success: true,
        unauthorizedRedirectUri: undefined,
      });
  });

  afterEach(() => {
    sinon.restore();
  });

  it('throws an error if credentials propagation dry run failed', async () => {
    const errMsg = 'Credentials propagation dry run failed';
    const authType = 'dfs_ephemeral';
    colabClientStub.propagateCredentials
      .withArgs(testServer.endpoint, {
        dryRun: true,
        authType,
      })
      .rejects(new Error(errMsg));

    const promise = handleDriveFsAuth(
      vsCodeStub.asVsCode(),
      colabClientStub,
      testServer,
      authType,
    );

    await expect(promise).to.be.rejectedWith(errMsg);
  });

  it('throws an error if credentials propagation dry run returned unexpected results', async () => {
    const authType = 'dfs_ephemeral';
    colabClientStub.propagateCredentials
      .withArgs(testServer.endpoint, {
        dryRun: true,
        authType,
      })
      .resolves({
        success: false,
        unauthorizedRedirectUri: undefined,
      });

    const promise = handleDriveFsAuth(
      vsCodeStub.asVsCode(),
      colabClientStub,
      testServer,
      authType,
    );

    await expect(promise).to.be.rejectedWith(
      /Credentials propagation dry run returned unexpected results/,
    );
  });

  describe('with no existing authorization', () => {
    const testUnauthorizedRedirectUri = 'http://test-oauth-uri';

    beforeEach(() => {
      colabClientStub.propagateCredentials
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
      const authType = 'dfs_ephemeral';
      const promise = handleDriveFsAuth(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        authType,
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
        colabClientStub.propagateCredentials,
        testServer.endpoint,
        {
          dryRun: false,
          authType,
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
        const authType = 'dfs_ephemeral';
        (vsCodeStub.window.showInformationMessage as sinon.SinonStub)
          .withArgs(
            sinon.match('Please complete the authorization in your browser'),
          )
          .resolves('Continue');

        await handleDriveFsAuth(
          vsCodeStub.asVsCode(),
          colabClientStub,
          testServer,
          authType,
        );

        sinon.assert.calledOnceWithMatch(
          vsCodeStub.env.openExternal,
          sinon.match(function (url: Uri) {
            return url.toString().startsWith(testUnauthorizedRedirectUri);
          }),
        );
        sinon.assert.calledWithExactly(
          colabClientStub.propagateCredentials,
          testServer.endpoint,
          {
            dryRun: false,
            authType,
          },
        );
      });

      it('throws an error if user not continued', async () => {
        const authType = 'dfs_ephemeral';

        const promise = handleDriveFsAuth(
          vsCodeStub.asVsCode(),
          colabClientStub,
          testServer,
          authType,
        );

        await expect(promise).to.be.rejectedWith(
          'User cancelled Google Drive authorization',
        );
        sinon.assert.neverCalledWith(
          colabClientStub.propagateCredentials,
          testServer.endpoint,
          {
            dryRun: false,
            authType,
          },
        );
      });
    });
  });

  describe('with existing authorization', () => {
    beforeEach(() => {
      colabClientStub.propagateCredentials
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
      const authType = 'dfs_ephemeral';

      await handleDriveFsAuth(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        authType,
      );

      sinon.assert.notCalled(vsCodeStub.window.showInformationMessage);
      sinon.assert.notCalled(vsCodeStub.env.openExternal);
      sinon.assert.calledWithExactly(
        colabClientStub.propagateCredentials,
        testServer.endpoint,
        {
          dryRun: false,
          authType,
        },
      );
    });

    it('throws an error if credentials propagation API failed', async () => {
      const errMsg = 'Credentials propagation failed';
      const authType = 'dfs_ephemeral';
      colabClientStub.propagateCredentials
        .withArgs(testServer.endpoint, {
          dryRun: false,
          authType,
        })
        .rejects(new Error(errMsg));

      const promise = handleDriveFsAuth(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        authType,
      );

      await expect(promise).to.be.rejectedWith(errMsg);
    });

    it('throws an error if credentials propagation returns unsuccessful', async () => {
      const authType = 'dfs_ephemeral';
      colabClientStub.propagateCredentials
        .withArgs(testServer.endpoint, {
          dryRun: false,
          authType,
        })
        .resolves({
          success: false,
          unauthorizedRedirectUri: undefined,
        });

      const promise = handleDriveFsAuth(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        authType,
      );

      await expect(promise).to.be.rejectedWith(
        'Credentials propagation unsuccessful',
      );
    });
  });
});
