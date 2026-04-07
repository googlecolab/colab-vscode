/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon, { SinonFakeTimers, SinonStubbedInstance } from 'sinon';
import { Deferred } from '../test/helpers/async';
import { ExperimentFlag } from './api';
import { ColabClient } from './client';
import {
  ExperimentStateProvider,
  getFlag,
  TEST_ONLY,
} from './experiment-state';

describe('ExperimentStateProvider', () => {
  let colabClientStub: SinonStubbedInstance<ColabClient>;
  let provider: ExperimentStateProvider;
  let clock: SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    colabClientStub = sinon.createStubInstance(ColabClient);
    provider = new ExperimentStateProvider(colabClientStub);
  });

  afterEach(() => {
    provider.dispose();
    clock.restore();
    sinon.restore();
  });

  it('throws when used after being disposed', () => {
    provider.dispose();

    expect(() => {
      provider.on();
    }).to.throw(/disposed/);
    expect(() => {
      provider.off();
    }).to.throw(/disposed/);
  });

  it('initializes with default flag values', () => {
    expect(getFlag(ExperimentFlag.RuntimeVersionNames)).to.deep.equal([]);
  });

  it('fetches experiment state with auth when turned on', async () => {
    const experiments = new Map([[ExperimentFlag.RuntimeVersionNames, true]]);
    const runGetExperimentState = new Deferred<void>();
    colabClientStub.getExperimentState.callsFake(async () => {
      runGetExperimentState.resolve();
      return Promise.resolve({ experiments });
    });

    provider.on();

    await expect(runGetExperimentState.promise).to.eventually.be.fulfilled;
    sinon.assert.calledOnceWithExactly(
      colabClientStub.getExperimentState,
      true,
      sinon.match.any,
    );
    expect(getFlag(ExperimentFlag.RuntimeVersionNames)).to.be.true;
  });

  it('fetches experiment state without auth when turned off', async () => {
    const experiments = new Map([[ExperimentFlag.RuntimeVersionNames, false]]);
    const runGetExperimentState = new Deferred<void>();
    colabClientStub.getExperimentState.callsFake(async () => {
      runGetExperimentState.resolve();
      return Promise.resolve({ experiments });
    });

    provider.off();

    await expect(runGetExperimentState.promise).to.eventually.be.fulfilled;
    sinon.assert.calledOnceWithExactly(
      colabClientStub.getExperimentState,
      false,
      sinon.match.any,
    );
    expect(getFlag(ExperimentFlag.RuntimeVersionNames)).to.be.false;
  });

  it('handles errors when fetching experiment state', () => {
    colabClientStub.getExperimentState.rejects(new Error('Network error'));

    // Should not throw
    provider.on();

    sinon.assert.calledOnce(colabClientStub.getExperimentState);
  });

  it('returns default value when flag is missing', () => {
    // Ensure flags are empty
    colabClientStub.getExperimentState.resolves({ experiments: new Map() });
    provider.on();

    expect(getFlag(ExperimentFlag.RuntimeVersionNames)).to.deep.equal([]);
  });

  it('does not update flags if response is empty', async () => {
    const firstCall = new Deferred<void>();
    const secondCall = new Deferred<void>();
    colabClientStub.getExperimentState
      .onFirstCall()
      .callsFake(async () => {
        firstCall.resolve();
        return Promise.resolve({
          experiments: new Map([[ExperimentFlag.RuntimeVersionNames, true]]),
        });
      })
      .onSecondCall()
      .callsFake(async () => {
        secondCall.resolve();
        return Promise.resolve({});
      });
    provider.on();
    await expect(firstCall.promise).to.eventually.be.fulfilled;
    expect(getFlag(ExperimentFlag.RuntimeVersionNames)).to.be.true;

    // Trigger the second refresh call which returns an empty response
    await clock.tickAsync(TEST_ONLY.REFRESH_INTERVAL_MS);
    await expect(secondCall.promise).to.eventually.be.fulfilled;

    // Should still be true (previous state preserved)
    expect(getFlag(ExperimentFlag.RuntimeVersionNames)).to.be.true;
  });

  it('polls for experiment state updates', async () => {
    colabClientStub.getExperimentState.resolves({});
    provider.on();
    sinon.assert.calledOnce(colabClientStub.getExperimentState);

    await clock.tickAsync(TEST_ONLY.REFRESH_INTERVAL_MS);

    sinon.assert.calledTwice(colabClientStub.getExperimentState);
    sinon.assert.calledWith(
      colabClientStub.getExperimentState.secondCall,
      true,
    );
  });

  it('stops polling when disposed', async () => {
    colabClientStub.getExperimentState.resolves({});
    provider.on();
    provider.dispose();

    await clock.tickAsync(TEST_ONLY.REFRESH_INTERVAL_MS);

    sinon.assert.calledOnce(colabClientStub.getExperimentState);
  });

  it('updates polling authorization state when turned off', async () => {
    colabClientStub.getExperimentState.resolves({});
    provider.on();
    provider.off();

    // Advance time to trigger refresh
    await clock.tickAsync(TEST_ONLY.REFRESH_INTERVAL_MS);

    // Called once for turnOn, once for turnOff, and once for the interval.
    sinon.assert.calledThrice(colabClientStub.getExperimentState);
    sinon.assert.calledWith(
      colabClientStub.getExperimentState.thirdCall,
      false,
    );
  });
});
