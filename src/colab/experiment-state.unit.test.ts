/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon, { SinonStubbedInstance } from 'sinon';
import { ExperimentFlag } from './api';
import { ColabClient } from './client';
import { ExperimentStateProvider, getFlag } from './experiment-state';

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

  beforeEach(() => {
    colabClientStub = sinon.createStubInstance(ColabClient);
    provider = new TestExperimentStateProvider(colabClientStub);

    // Default value of the flag
    expect(getFlag(ExperimentFlag.RuntimeVersionNames)).to.be.deep.equal([]);
  });

  afterEach(() => {
    sinon.restore();
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
});
