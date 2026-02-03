/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon, { SinonStubbedInstance } from 'sinon';
import { Uri } from 'vscode';
import { AuthType } from '../colab/api';
import { ColabClient } from '../colab/client';
import { ColabAssignedServer } from '../jupyter/servers';
import { newVsCodeStub, VsCodeStub } from '../test/helpers/vscode';
import { handleEphemeralAuth } from './ephemeral';

describe('handleEphemeralAuth', () => {
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
      .withArgs(
        testServer.endpoint,
        sinon.match(({ dryRun }) => !dryRun),
      )
      .resolves({
        success: true,
        unauthorizedRedirectUri: undefined,
      });
  });

  afterEach(() => {
    sinon.restore();
  });

  const tests: {
    authType: AuthType;
    consentMessage: string;
    consentAllowText: string;
  }[] = [
    {
      authType: 'dfs_ephemeral',
      consentMessage: `Permit "${testServer.label}" to access your Google Drive files?`,
      consentAllowText: 'Connect to Google Drive',
    },
    {
      authType: 'auth_user_ephemeral',
      consentMessage: `Allow "${testServer.label}" to access your Google credentials?`,
      consentAllowText: 'Allow',
    },
  ];

  tests.forEach(({ authType, consentMessage, consentAllowText }) => {
    it(`throws an error if ${authType} credentials propagation dry run failed`, async () => {
      const errMsg = `[${authType}] Credentials propagation dry run failed`;
      colabClientStub.propagateCredentials
        .withArgs(testServer.endpoint, {
          dryRun: true,
          authType,
        })
        .rejects(new Error(errMsg));

      const promise = handleEphemeralAuth(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        authType,
      );

      await expect(promise).to.be.rejectedWith(errMsg);
    });

    it(`throws an error if ${authType} credentials propagation dry run returned unexpected results`, async () => {
      colabClientStub.propagateCredentials
        .withArgs(testServer.endpoint, {
          dryRun: true,
          authType,
        })
        .resolves({
          success: false,
          unauthorizedRedirectUri: undefined,
        });

      const promise = handleEphemeralAuth(
        vsCodeStub.asVsCode(),
        colabClientStub,
        testServer,
        authType,
      );

      await expect(promise).to.be.rejectedWith(
        /Credentials propagation dry run returned unexpected results/,
      );
    });

    describe(`with no existing ${authType} authorization`, () => {
      const testUnauthorizedRedirectUri = 'http://test-oauth-uri';

      beforeEach(() => {
        colabClientStub.propagateCredentials
          .withArgs(testServer.endpoint, {
            dryRun: true,
            authType,
          })
          .resolves({
            success: false,
            unauthorizedRedirectUri: testUnauthorizedRedirectUri,
          });
      });

      it(`shows ${authType} consent prompt and throws an error if user not consented`, async () => {
        const promise = handleEphemeralAuth(
          vsCodeStub.asVsCode(),
          colabClientStub,
          testServer,
          authType,
        );

        await expect(promise).to.be.rejectedWith(
          `User cancelled ${authType} authorization`,
        );
        sinon.assert.calledOnceWithMatch(
          vsCodeStub.window.showInformationMessage,
          sinon.match(consentMessage),
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
            .withArgs(sinon.match(consentMessage))
            .resolves(consentAllowText);
        });

        it(`opens unauthorized redirect URI, shows "continue" dialog, and propagates ${authType} credentials if user continued`, async () => {
          (vsCodeStub.window.showInformationMessage as sinon.SinonStub)
            .withArgs(
              sinon.match('Please complete the authorization in your browser'),
            )
            .resolves('Continue');

          await handleEphemeralAuth(
            vsCodeStub.asVsCode(),
            colabClientStub,
            testServer,
            authType,
          );

          sinon.assert.calledOnceWithMatch(
            vsCodeStub.env.openExternal,
            sinon.match((url: Uri) =>
              url.toString().startsWith(testUnauthorizedRedirectUri),
            ),
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

        it(`throws an error if user not continued with ${authType}`, async () => {
          const promise = handleEphemeralAuth(
            vsCodeStub.asVsCode(),
            colabClientStub,
            testServer,
            authType,
          );

          await expect(promise).to.be.rejectedWith(
            `User cancelled ${authType} authorization`,
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

    describe(`with existing ${authType} authorization`, () => {
      beforeEach(() => {
        colabClientStub.propagateCredentials
          .withArgs(testServer.endpoint, {
            dryRun: true,
            authType,
          })
          .resolves({
            success: true,
            unauthorizedRedirectUri: undefined,
          });
      });

      it(`skips prompt and propagates ${authType} credentials`, async () => {
        await handleEphemeralAuth(
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

      it(`throws an error if ${authType} credentials propagation API failed`, async () => {
        const errMsg = `[${authType}] Credentials propagation failed`;
        colabClientStub.propagateCredentials
          .withArgs(testServer.endpoint, {
            dryRun: false,
            authType,
          })
          .rejects(new Error(errMsg));

        const promise = handleEphemeralAuth(
          vsCodeStub.asVsCode(),
          colabClientStub,
          testServer,
          authType,
        );

        await expect(promise).to.be.rejectedWith(errMsg);
      });

      it(`throws an error if ${authType} credentials propagation returns unsuccessful`, async () => {
        colabClientStub.propagateCredentials
          .withArgs(testServer.endpoint, {
            dryRun: false,
            authType,
          })
          .resolves({
            success: false,
            unauthorizedRedirectUri: undefined,
          });

        const promise = handleEphemeralAuth(
          vsCodeStub.asVsCode(),
          colabClientStub,
          testServer,
          authType,
        );

        await expect(promise).to.be.rejectedWith(
          `[${authType}] Credentials propagation unsuccessful`,
        );
      });
    });
  });
});
