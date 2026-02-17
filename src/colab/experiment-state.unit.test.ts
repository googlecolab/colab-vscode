/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon, { SinonFakeTimers, SinonStubbedInstance } from 'sinon';
import { ExperimentFlag } from './api';
import { ColabClient } from './client';
import {
  ExperimentStateProvider,
  getFlag,
  TEST_ONLY,
} from './experiment-state';

/**
 * Test subclass to expose protected methods for testing.
 */
class TestExperimentStateProvider extends ExperimentStateProvider {
  override async turnOn(signal: AbortSignal): Promise<void> {
    return super.turnOn(signal);
  }

  override async turnOff(signal: AbortSignal): Promise<void> {
    return super.turnOff(signal);
  }
}

describe('ExperimentStateProvider', () => {
  let colabClientStub: SinonStubbedInstance<ColabClient>;
  let provider: TestExperimentStateProvider;
  let clock: SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    colabClientStub = sinon.createStubInstance(ColabClient);
    provider = new TestExperimentStateProvider(colabClientStub);
  });

  afterEach(() => {
    provider.dispose();
    clock.restore();
    sinon.restore();
  });

  it('initializes with default flag values', () => {
    expect(getFlag(ExperimentFlag.RuntimeVersionNames)).to.deep.equal([]);
  });

  it('fetches experiment state with auth when turned on', async () => {
    const experiments = new Map([[ExperimentFlag.RuntimeVersionNames, true]]);
    colabClientStub.getExperimentState.resolves({ experiments });

    await provider.turnOn(new AbortController().signal);

    sinon.assert.calledOnceWithExactly(
      colabClientStub.getExperimentState,
      true,
      sinon.match.any,
    );
    expect(getFlag(ExperimentFlag.RuntimeVersionNames)).to.be.true;
  });

  it('fetches experiment state without auth when turned off', async () => {
    const experiments = new Map([[ExperimentFlag.RuntimeVersionNames, false]]);
    colabClientStub.getExperimentState.resolves({ experiments });

    await provider.turnOff(new AbortController().signal);

    sinon.assert.calledOnceWithExactly(
      colabClientStub.getExperimentState,
      false,
      sinon.match.any,
    );
    expect(getFlag(ExperimentFlag.RuntimeVersionNames)).to.be.false;
  });

  it('handles errors when fetching experiment state', async () => {
    colabClientStub.getExperimentState.rejects(new Error('Network error'));

    // Should not throw
    await provider.turnOn(new AbortController().signal);

    sinon.assert.calledOnce(colabClientStub.getExperimentState);
  });

  it('returns default value when flag is missing', async () => {
    // Ensure flags are empty
    colabClientStub.getExperimentState.resolves({ experiments: new Map() });
    await provider.turnOn(new AbortController().signal);

    expect(getFlag(ExperimentFlag.RuntimeVersionNames)).to.deep.equal([]);
  });

  it('updates flags when state changes', async () => {
    // Set to true
    colabClientStub.getExperimentState.resolves({
      experiments: new Map([[ExperimentFlag.RuntimeVersionNames, true]]),
    });
    await provider.turnOn(new AbortController().signal);
    expect(getFlag(ExperimentFlag.RuntimeVersionNames)).to.be.true;

    // Set to false
    colabClientStub.getExperimentState.resolves({
      experiments: new Map([[ExperimentFlag.RuntimeVersionNames, false]]),
    });
    await provider.turnOn(new AbortController().signal);
    expect(getFlag(ExperimentFlag.RuntimeVersionNames)).to.be.false;
  });

  it('does not update flags if response is empty', async () => {
    // Set initial state
    colabClientStub.getExperimentState.resolves({
      experiments: new Map([[ExperimentFlag.RuntimeVersionNames, true]]),
    });
    await provider.turnOn(new AbortController().signal);
    expect(getFlag(ExperimentFlag.RuntimeVersionNames)).to.be.true;

    // Return empty experiments (undefined)
    colabClientStub.getExperimentState.resolves({});
    await provider.turnOn(new AbortController().signal);

    // Should still be true (previous state preserved)
    expect(getFlag(ExperimentFlag.RuntimeVersionNames)).to.be.true;
  });

  it('polls for experiment state updates', async () => {
    colabClientStub.getExperimentState.resolves({});
    await provider.turnOn(new AbortController().signal);
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
    await provider.turnOn(new AbortController().signal);
    provider.dispose();

    await clock.tickAsync(TEST_ONLY.REFRESH_INTERVAL_MS);

    sinon.assert.calledOnce(colabClientStub.getExperimentState);
  });

  it('updates polling authorization state when turned off', async () => {
    colabClientStub.getExperimentState.resolves({});
    await provider.turnOn(new AbortController().signal);
    await provider.turnOff(new AbortController().signal);

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
