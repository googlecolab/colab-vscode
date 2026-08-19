/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon, { SinonFakeTimers, SinonStubbedInstance } from 'sinon';
import { Deferred } from '../test/helpers/async';
import { ColabClient } from './client/v1';
import { ExperimentFlag, ExperimentFlagValue } from './client/v1/api';
import {
  ExperimentStateProvider,
  getExperimentIds,
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

  it('initializes with no experiment IDs', () => {
    expect(getExperimentIds()).to.be.empty;
  });

  const TEST_FLAG_NAME = ExperimentFlag.RuntimeVersionNames;
  const authStates = [
    {
      withAuth: true,
      trigger: (provider: ExperimentStateProvider) => {
        provider.on();
      },
    },
    {
      withAuth: false,
      trigger: (provider: ExperimentStateProvider) => {
        provider.off();
      },
    },
  ];
  const tests = [
    {
      name: 'fetches flags with undefined selected IDs',
      experiments: new Map([[TEST_FLAG_NAME, true]]),
      expectedFlagValue: true,
      expectedExperimentIds: [],
    },
    {
      name: 'fetches experiment IDs and defaults flags with undefined experiments',
      selectedIds: [1, 2, 3],
      expectedFlagValue: [],
      expectedExperimentIds: [1, 2, 3],
    },
    {
      name: 'fetches flags and experiment IDs with both defined',
      experiments: new Map([[TEST_FLAG_NAME, true]]),
      selectedIds: [1, 2, 3],
      expectedFlagValue: true,
      expectedExperimentIds: [1, 2, 3],
    },
    {
      name: 'defaults flags and experiment IDs with both undefined',
      expectedFlagValue: [],
      expectedExperimentIds: [],
    },
    {
      name: 'defaults flags with flag missing in experiments map',
      experiments: new Map(),
      expectedFlagValue: [],
      expectedExperimentIds: [],
    },
  ];

  authStates.forEach(({ withAuth, trigger }) => {
    describe(`when auth turned ${withAuth ? 'on' : 'off'}`, () => {
      tests.forEach((t) => {
        it(t.name, async () => {
          const getExperimentStateRanPromise = stubGetExperimentStateResponse(
            t.experiments,
            t.selectedIds,
          );

          trigger(provider);

          await expect(getExperimentStateRanPromise).to.eventually.be.fulfilled;
          sinon.assert.calledOnceWithExactly(
            colabClientStub.getExperimentState,
            withAuth,
            sinon.match.any,
          );
          expect(getFlag(TEST_FLAG_NAME)).to.deep.equal(t.expectedFlagValue);
          expect(getExperimentIds()).to.deep.equal(t.expectedExperimentIds);
        });
      });
    });
  });

  it('handles errors when fetching experiment state', async () => {
    const getExperimentStateRun = new Deferred<void>();
    colabClientStub.getExperimentState.callsFake(async () => {
      getExperimentStateRun.resolve();
      return Promise.reject(new Error('Network error'));
    });

    // Should not throw
    provider.on();

    await expect(getExperimentStateRun.promise).to.eventually.be.fulfilled;
    sinon.assert.calledOnce(colabClientStub.getExperimentState);
  });

  it('updates flags when state changes', async () => {
    const firstCall = new Deferred<void>();
    const secondCall = new Deferred<void>();
    colabClientStub.getExperimentState
      .onFirstCall()
      .callsFake(async () => {
        firstCall.resolve();
        return Promise.resolve({
          // Set to true
          experiments: new Map([[ExperimentFlag.RuntimeVersionNames, true]]),
        });
      })
      .onSecondCall()
      .callsFake(async () => {
        secondCall.resolve();
        return Promise.resolve({
          // Set to false
          experiments: new Map([[ExperimentFlag.RuntimeVersionNames, false]]),
        });
      });

    // Trigger first call by turning on the provider
    provider.on();

    await expect(firstCall.promise).to.eventually.be.fulfilled;
    expect(getFlag(ExperimentFlag.RuntimeVersionNames)).to.be.true;

    // Trigger second call by fast-forwarding time to the next refresh interval
    await clock.tickAsync(TEST_ONLY.REFRESH_INTERVAL_MS);

    await expect(secondCall.promise).to.eventually.be.fulfilled;
    expect(getFlag(ExperimentFlag.RuntimeVersionNames)).to.be.false;
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

  function stubGetExperimentStateResponse(
    experiments?: Map<ExperimentFlag, ExperimentFlagValue>,
    selectedIds?: number[],
  ): Promise<void> {
    const runGetExperimentState = new Deferred<void>();
    colabClientStub.getExperimentState.callsFake(async () => {
      runGetExperimentState.resolve();
      return Promise.resolve({ experiments, selectedIds });
    });
    return runGetExperimentState.promise;
  }
});
