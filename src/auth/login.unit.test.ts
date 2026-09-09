/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import { gaxios, OAuth2Client } from 'google-auth-library';
import { GetTokenResponse } from 'google-auth-library/build/src/auth/oauth2client';
import sinon from 'sinon';
import vscode from 'vscode';
import { isCancellation, UserCancelledError } from '../common/cancellation';
import { telemetry } from '../telemetry';
import { newVsCodeStub, VsCodeStub } from '../test/helpers/vscode';
import { OAuth2Flow } from './flows/flows';
import { login } from './login';
import { RefreshableAuthenticationSession } from './storage';

const CODE = '123';
const REDIRECT = 'http://example.com/redirect';
const SCOPES = ['scope1', 'scope2'];
const ACCESS_TOKEN = '42';
const REFRESH_SESSION: RefreshableAuthenticationSession = {
  id: '1',
  refreshToken: '1//23',
  account: {
    label: 'Foo Bar',
    id: 'foo@example.com',
  },
  scopes: SCOPES,
};

const NOW = Date.now();
const HOUR_MS = 60 * 60 * 1000;
const CREDENTIALS = {
  refresh_token: REFRESH_SESSION.refreshToken,
  access_token: ACCESS_TOKEN,
  expiry_date: NOW + HOUR_MS,
  id_token: 'eh',
  scope: SCOPES.join(' '),
};
const GET_TOKEN_RESPONSE: GetTokenResponse = {
  res: { status: 200 } as gaxios.GaxiosResponse,
  tokens: CREDENTIALS,
};

function buildStubFlow(): sinon.SinonStubbedInstance<OAuth2Flow> {
  return {
    trigger: sinon.stub(),
  };
}

/**
 * Awaits a promise expected to reject and returns the rejection reason.
 *
 * @param promise - The promise expected to reject.
 * @returns The rejection reason.
 */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err: unknown) {
    return err;
  }
  throw new Error('Expected the promise to reject, but it resolved.');
}

/**
 * Returns the messages of the errors an {@link AggregateError} carries.
 *
 * @param err - The rejection reason, expected to be an {@link AggregateError}.
 * @returns The message of each aggregated error.
 */
function aggregatedMessages(err: unknown): string[] {
  expect(err).to.be.instanceOf(AggregateError);
  if (!(err instanceof AggregateError)) {
    return [];
  }
  const errors: unknown[] = err.errors;
  return errors.map((e) => (e instanceof Error ? e.message : String(e)));
}

describe('login', () => {
  let vs: VsCodeStub;
  let oauth2Client: OAuth2Client;
  const flowCancellationSources: vscode.CancellationTokenSource[] = [];

  beforeEach(() => {
    vs = newVsCodeStub();
    oauth2Client = new OAuth2Client('testClientId', 'testClientSecret');

    vs.window.withProgress
      .withArgs(
        sinon.match({
          location: vs.ProgressLocation.Notification,
          title: sinon.match(/Signing in/),
          cancellable: true,
        }),
        sinon.match.any,
      )
      .callsFake(async (_, task) => {
        // Kick off the flow and capture a reference to the cancellation token
        // source.
        flowCancellationSources.push(new vs.CancellationTokenSource());
        return await task(
          { report: sinon.stub() },
          flowCancellationSources[flowCancellationSources.length - 1].token,
        );
      });
  });

  afterEach(() => {
    sinon.restore();
  });

  it('throws an error if no flows are available', async () => {
    await expect(
      login(vs.asVsCode(), [], oauth2Client, SCOPES),
    ).to.be.rejectedWith('No authentication flows available.');
  });

  describe('with a flow', () => {
    let flow: sinon.SinonStubbedInstance<OAuth2Flow>;
    beforeEach(() => {
      flow = buildStubFlow();
    });

    it('signals cancellation to the flow when the user chooses to cancel', async () => {
      let cancelCalled = false;
      flow.trigger.callsFake(async (options) => {
        return new Promise<never>((_, reject) => {
          options.cancel.onCancellationRequested(() => {
            cancelCalled = true;
            reject(new Error('Cancellation signaled to flow'));
          });
          flowCancellationSources[0].cancel();
        });
      });

      await expect(
        login(vs.asVsCode(), [flow], oauth2Client, SCOPES),
      ).to.be.rejectedWith('Authentication failed.');
      expect(cancelCalled).to.be.true;
    });

    it('throws an error if the flow fails', async () => {
      flow.trigger.rejects(new Error('Flow failed'));

      await expect(
        login(vs.asVsCode(), [flow], oauth2Client, SCOPES),
      ).to.be.rejectedWith('Authentication failed.');

      sinon.assert.notCalled(vs.window.showErrorMessage);
    });

    it('carries the underlying flow error on the thrown failure', async () => {
      flow.trigger.rejects(new Error('Flow failed'));

      const err = await rejectionOf(
        login(vs.asVsCode(), [flow], oauth2Client, SCOPES),
      );

      expect(aggregatedMessages(err)).to.deep.equal(['Flow failed']);
    });

    it('reports a user cancellation as a cancellation, not a failure', async () => {
      flow.trigger.rejects(new UserCancelledError('Cancelled by the user'));

      const err = await rejectionOf(
        login(vs.asVsCode(), [flow], oauth2Client, SCOPES),
      );

      expect(isCancellation(err)).to.be.true;
      expect(err)
        .to.have.property('cause')
        .that.has.property('message', 'Cancelled by the user');
    });

    it('does not show a failure toast when the user cancels', async () => {
      flow.trigger.rejects(new UserCancelledError('Cancelled by the user'));

      await expect(login(vs.asVsCode(), [flow], oauth2Client, SCOPES)).to.be
        .rejected;

      sinon.assert.notCalled(vs.window.showErrorMessage);
    });

    it('throws an error if a token cannot be obtained', async () => {
      flow.trigger.resolves({
        code: CODE,
        redirectUri: REDIRECT,
      });
      sinon.stub(oauth2Client, 'getToken').resolves({
        res: { status: 500 },
        tokens: {},
      } as GetTokenResponse);

      const err = await rejectionOf(
        login(vs.asVsCode(), [flow], oauth2Client, SCOPES),
      );

      expect(err).to.have.property('message', 'Authentication failed.');
      expect(aggregatedMessages(err).join()).to.match(/Failed to get token/);
    });

    it('throws an error if the token is missing credential information', async () => {
      flow.trigger.resolves({
        code: CODE,
        redirectUri: REDIRECT,
      });
      sinon.stub(oauth2Client, 'getToken').resolves({
        res: { status: 200 },
        tokens: {},
      } as GetTokenResponse);

      const err = await rejectionOf(
        login(vs.asVsCode(), [flow], oauth2Client, SCOPES),
      );

      expect(err).to.have.property('message', 'Authentication failed.');
      expect(aggregatedMessages(err)).to.deep.equal([
        'Missing credential information.',
      ]);
    });

    it('returns credentials from a successful login flow', async () => {
      flow.trigger.resolves({
        code: CODE,
        redirectUri: REDIRECT,
      });
      sinon
        .stub(oauth2Client, 'getToken')
        .withArgs({
          code: CODE,
          codeVerifier: sinon.match.string,
          redirect_uri: REDIRECT,
        })
        .resolves(GET_TOKEN_RESPONSE);

      await expect(
        login(vs.asVsCode(), [flow], oauth2Client, SCOPES),
      ).to.eventually.deep.equal(CREDENTIALS);
    });
  });

  describe('with multiple flows', () => {
    let flow1: sinon.SinonStubbedInstance<OAuth2Flow>;
    let flow2: sinon.SinonStubbedInstance<OAuth2Flow>;

    function stubTryAnotherFlow() {
      // Type assertions needed due to overloading on the message functions.
      (vs.window.showErrorMessage as sinon.SinonStub)
        .withArgs(sinon.match(/try a different/))
        .resolves('Yes');
      (vs.window.showInformationMessage as sinon.SinonStub)
        .withArgs(sinon.match(/try a different/))
        .resolves('Yes');
    }

    beforeEach(() => {
      flow1 = buildStubFlow();
      flow2 = buildStubFlow();
    });

    it('throws an error if multiple flows fail', async () => {
      flow1.trigger.rejects(new Error('Barf'));
      flow2.trigger.rejects(new Error('Yack'));
      stubTryAnotherFlow();

      await expect(
        login(vs.asVsCode(), [flow1, flow2], oauth2Client, SCOPES),
      ).to.be.rejectedWith(/All .+ failed/);

      sinon.assert.calledOnceWithMatch(
        vs.window.showErrorMessage,
        sinon.match(/try a different/),
      );
    });

    it('successfully completes a flow after failing a first attempt', async () => {
      flow1.trigger.rejects(new Error('Burp'));
      stubTryAnotherFlow();
      flow2.trigger.resolves({
        code: CODE,
        redirectUri: REDIRECT,
      });
      sinon
        .stub(oauth2Client, 'getToken')
        .withArgs({
          code: CODE,
          codeVerifier: sinon.match.string,
          redirect_uri: REDIRECT,
        })
        .resolves(GET_TOKEN_RESPONSE);

      await expect(
        login(vs.asVsCode(), [flow1, flow2], oauth2Client, SCOPES),
      ).to.eventually.deep.equal(CREDENTIALS);

      sinon.assert.calledOnceWithMatch(
        vs.window.showErrorMessage,
        sinon.match(/try a different/),
      );
      sinon.assert.neverCalledWithMatch(
        vs.window.showErrorMessage,
        sinon.match(/Burp/),
      );
    });

    it("carries every attempt's error on the thrown failure", async () => {
      flow1.trigger.rejects(new Error('Barf'));
      flow2.trigger.rejects(new Error('Yack'));
      stubTryAnotherFlow();

      const err = await rejectionOf(
        login(vs.asVsCode(), [flow1, flow2], oauth2Client, SCOPES),
      );

      expect(aggregatedMessages(err)).to.deep.equal(['Barf', 'Yack']);
    });

    it('reports cancelling out of every flow as a cancellation', async () => {
      flow1.trigger.rejects(new UserCancelledError('Cancelled the first'));
      flow2.trigger.rejects(new UserCancelledError('Cancelled the second'));
      stubTryAnotherFlow();

      const err = await rejectionOf(
        login(vs.asVsCode(), [flow1, flow2], oauth2Client, SCOPES),
      );

      expect(isCancellation(err)).to.be.true;
      sinon.assert.notCalled(vs.window.showErrorMessage);
      sinon.assert.calledOnceWithMatch(
        vs.window.showInformationMessage,
        sinon.match(/try a different/),
      );
    });

    it('claims a failure in the fallback offer after a genuine one', async () => {
      flow1.trigger.rejects(new Error('Barf'));
      flow2.trigger.rejects(new UserCancelledError('Gave up'));
      stubTryAnotherFlow();

      await expect(login(vs.asVsCode(), [flow1, flow2], oauth2Client, SCOPES))
        .to.be.rejected;

      sinon.assert.calledWithMatch(
        vs.window.showErrorMessage,
        sinon.match(/Failed to authenticate.+try a different/),
      );
      sinon.assert.notCalled(vs.window.showInformationMessage);
    });

    it('still reports a failure when a cancellation follows a genuine one', async () => {
      flow1.trigger.rejects(new Error('Barf'));
      flow2.trigger.rejects(new UserCancelledError('Gave up'));
      stubTryAnotherFlow();

      const err = await rejectionOf(
        login(vs.asVsCode(), [flow1, flow2], oauth2Client, SCOPES),
      );

      expect(isCancellation(err)).to.be.false;
      expect(aggregatedMessages(err)).to.deep.equal(['Barf', 'Gave up']);
    });

    it('still reports a failure when the user declines another method', async () => {
      flow1.trigger.rejects(new Error('Barf'));
      // `showErrorMessage` resolves undefined by default, e.g. "No".

      const err = await rejectionOf(
        login(vs.asVsCode(), [flow1, flow2], oauth2Client, SCOPES),
      );

      expect(isCancellation(err)).to.be.false;
      expect(aggregatedMessages(err)).to.deep.equal(['Barf']);
      // One flow was offered but never run, so "all methods" would overstate
      // what was tried.
      expect(err).to.have.property('message', 'Authentication failed.');
      sinon.assert.notCalled(flow2.trigger);
    });

    it('does not record a sign-in for a flow that was never tried', async () => {
      const logSignIn = sinon.stub(telemetry, 'logSignIn');
      flow1.trigger.rejects(new Error('Barf'));
      // `showErrorMessage` resolves undefined by default, e.g. "No".

      await expect(login(vs.asVsCode(), [flow1, flow2], oauth2Client, SCOPES))
        .to.be.rejected;

      sinon.assert.calledOnce(logSignIn);
    });
  });
});
