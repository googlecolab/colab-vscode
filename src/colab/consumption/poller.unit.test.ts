/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import * as sinon from 'sinon';
import {
  SinonFakeTimers,
  SinonStubbedInstance,
  createStubInstance,
} from 'sinon';
import { AssignmentChangeEvent } from '../../jupyter/assignments';
import { Deferred } from '../../test/helpers/async';
import { TestEventEmitter } from '../../test/helpers/events';
import { newVsCodeStub, VsCodeStub } from '../../test/helpers/vscode';
import { ColabClient } from '../client/v1';
import { ConsumptionUserInfo } from '../client/v1/api';
import { SubscriptionTier, Variant } from '../types';
import { ConsumptionPoller, TEST_ONLY } from './poller';

const POLL_INTERVAL_MS = TEST_ONLY.POLL_INTERVAL_MS;
const TASK_TIMEOUT_MS = TEST_ONLY.TASK_TIMEOUT_MS;
const DEFAULT_CCU_INFO: ConsumptionUserInfo = {
  subscriptionTier: SubscriptionTier.NONE,
  paidComputeUnitsBalance: 1,
  consumptionRateHourly: 2,
  assignmentsCount: 3,
  eligibleAccelerators: [
    {
      variant: Variant.GPU,
      models: ['T4'],
    },
    {
      variant: Variant.TPU,
      models: ['V6E1', 'V28'],
    },
  ],
  ineligibleAccelerators: [
    {
      variant: Variant.GPU,
      models: ['A100', 'L4'],
    },
    {
      variant: Variant.TPU,
      models: ['V5E1'],
    },
  ],
  freeCcuQuotaInfo: {
    remainingTokens: 4,
    nextRefillTimestampSec: 5,
  },
};

describe('ConsumptionPoller', () => {
  let fakeClock: SinonFakeTimers;
  let vsCodeStub: VsCodeStub;
  let clientStub: SinonStubbedInstance<ColabClient>;
  let assignmentChangeEmitter: TestEventEmitter<AssignmentChangeEvent>;
  let poller: ConsumptionPoller;

  beforeEach(() => {
    fakeClock = sinon.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout'],
    });
    vsCodeStub = newVsCodeStub();
    clientStub = createStubInstance(ColabClient);
    assignmentChangeEmitter = new TestEventEmitter<AssignmentChangeEvent>();
    poller = new ConsumptionPoller(
      vsCodeStub.asVsCode(),
      clientStub,
      assignmentChangeEmitter.event,
    );
  });

  afterEach(() => {
    poller.dispose();
    fakeClock.restore();
    sinon.restore();
  });

  describe('lifecycle', () => {
    beforeEach(() => {
      clientStub.getConsumptionUserInfo.resolves(DEFAULT_CCU_INFO);
      poller.on();
    });

    it('disposes the poll timer', async () => {
      clientStub.getConsumptionUserInfo.resetHistory();

      poller.dispose();

      await fakeClock.tickAsync(POLL_INTERVAL_MS);
      sinon.assert.notCalled(clientStub.getConsumptionUserInfo);
    });

    it('disposes the assignment change listener', () => {
      expect(assignmentChangeEmitter.hasListeners()).to.be.true;

      poller.dispose();

      expect(assignmentChangeEmitter.hasListeners()).to.be.false;
    });

    it('throws when used after being disposed', () => {
      poller.dispose();

      expect(() => {
        poller.on();
      }).to.throw(/disposed/);
      expect(() => {
        poller.off();
      }).to.throw(/disposed/);
    });

    it('aborts slow calls to get CCU info', async () => {
      poller.off(); // Turn off poller to reset first
      clientStub.getConsumptionUserInfo.resetHistory();
      clientStub.getConsumptionUserInfo.callsFake(
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        async () => new Promise(() => {}),
      );
      poller.on();

      await fakeClock.tickAsync(TASK_TIMEOUT_MS + 1);

      sinon.assert.calledOnceWithMatch(
        clientStub.getConsumptionUserInfo,
        sinon.match((signal: AbortSignal) => signal.aborted),
      );
    });
  });

  describe('toggled on', () => {
    beforeEach(async () => {
      clientStub.getConsumptionUserInfo.resolves(DEFAULT_CCU_INFO);
      poller.on();
      // Turning the poller on runs the task immediately. Wait past the task
      // timeout to ensure the immediate invocation runs to completion.
      await fakeClock.tickAsync(TASK_TIMEOUT_MS);
      clientStub.getConsumptionUserInfo.resetHistory();
    });

    describe('when the CCU info does not change', () => {
      let onDidChangeCcuInfo: sinon.SinonStub<[ConsumptionUserInfo]>;

      beforeEach(() => {
        onDidChangeCcuInfo = sinon.stub();
        poller.onDidChangeCcuInfo(onDidChangeCcuInfo);
      });

      it('does not emit an event', async () => {
        await fakeClock.tickAsync(POLL_INTERVAL_MS);

        sinon.assert.calledOnce(clientStub.getConsumptionUserInfo);
        sinon.assert.notCalled(onDidChangeCcuInfo);
      });
    });

    describe('when the CCU info changes', () => {
      const newCcuInfo: ConsumptionUserInfo = {
        ...DEFAULT_CCU_INFO,
        eligibleAccelerators: [],
      };

      let onDidChangeCcuInfo: sinon.SinonStub<[ConsumptionUserInfo]>;

      beforeEach(() => {
        onDidChangeCcuInfo = sinon.stub();
        poller.onDidChangeCcuInfo(onDidChangeCcuInfo);
        clientStub.getConsumptionUserInfo.resolves(newCcuInfo);
      });

      it('emits an event', async () => {
        await fakeClock.tickAsync(POLL_INTERVAL_MS);

        sinon.assert.calledOnce(clientStub.getConsumptionUserInfo);
        sinon.assert.calledOnce(onDidChangeCcuInfo);
      });
    });

    describe('when assignment changes', () => {
      const newCcuInfo: ConsumptionUserInfo = {
        ...DEFAULT_CCU_INFO,
        eligibleAccelerators: [],
      };

      let onDidChangeCcuInfo: sinon.SinonStub<[ConsumptionUserInfo]>;

      beforeEach(() => {
        onDidChangeCcuInfo = sinon.stub();
        poller.onDidChangeCcuInfo(onDidChangeCcuInfo);
      });

      it('triggers a poll and emits an event', async () => {
        const runGetConsumptionUserInfo = new Deferred<void>();
        clientStub.getConsumptionUserInfo.callsFake(() => {
          runGetConsumptionUserInfo.resolve();
          return Promise.resolve(newCcuInfo);
        });

        assignmentChangeEmitter.fire({ added: [], removed: [], changed: [] });

        await expect(runGetConsumptionUserInfo.promise).to.eventually.be
          .fulfilled;
        sinon.assert.calledOnce(onDidChangeCcuInfo);
      });

      it('aborts an in-flight scheduled poll', async () => {
        const ccuInfoChanged = new Deferred<void>();
        onDidChangeCcuInfo.callsFake(() => {
          ccuInfoChanged.resolve();
        });
        const firstCallStarted = new Deferred<void>();
        const firstCallCompleter = new Deferred<void>();
        const secondCallStarted = new Deferred<void>();
        clientStub.getConsumptionUserInfo
          .onFirstCall()
          .callsFake(async () => {
            firstCallStarted.resolve();
            await firstCallCompleter.promise;
            return Promise.reject(new Error('aborted'));
          })
          .onSecondCall()
          .callsFake(async () => {
            secondCallStarted.resolve();
            return Promise.resolve(newCcuInfo);
          });

        // Kick off scheduled poll and let it hang
        await fakeClock.tickAsync(POLL_INTERVAL_MS + 1);
        await firstCallStarted.promise;
        // Fire assignment change to trigger another poll
        assignmentChangeEmitter.fire({ added: [], removed: [], changed: [] });
        await secondCallStarted.promise;
        // Unblock the first poll
        firstCallCompleter.resolve();

        await expect(ccuInfoChanged.promise).to.eventually.be.fulfilled;
        // First call was aborted and second call was not affected.
        sinon.assert.calledWithMatch(
          clientStub.getConsumptionUserInfo.firstCall,
          sinon.match((signal: AbortSignal) => signal.aborted),
        );
        sinon.assert.calledWithMatch(
          clientStub.getConsumptionUserInfo.secondCall,
          sinon.match((signal: AbortSignal) => !signal.aborted),
        );
      });
    });
  });

  describe('when polling fails', () => {
    let randomStub: sinon.SinonStub<[], number>;

    beforeEach(async () => {
      // Deterministic jitter: the multiplier becomes exactly 1.
      randomStub = sinon.stub(Math, 'random').returns(0.5);
      clientStub.getConsumptionUserInfo.rejects(new Error('offline'));
      poller.on();
      await fakeClock.tickAsync(TASK_TIMEOUT_MS);
      clientStub.getConsumptionUserInfo.resetHistory();
    });

    it('skips the next interval after a single failure', async () => {
      await fakeClock.tickAsync(POLL_INTERVAL_MS);

      sinon.assert.notCalled(clientStub.getConsumptionUserInfo);
    });

    it('retries once the backoff has elapsed', async () => {
      await fakeClock.tickAsync(POLL_INTERVAL_MS * 2);

      sinon.assert.calledOnce(clientStub.getConsumptionUserInfo);
    });

    it('backs off further with each consecutive failure', async () => {
      // Second failure, so the next attempt waits two intervals rather than
      // the one that followed the first.
      await fakeClock.tickAsync(POLL_INTERVAL_MS * 2);
      clientStub.getConsumptionUserInfo.resetHistory();

      await fakeClock.tickAsync(POLL_INTERVAL_MS * 2);
      sinon.assert.notCalled(clientStub.getConsumptionUserInfo);

      await fakeClock.tickAsync(POLL_INTERVAL_MS);
      sinon.assert.calledOnce(clientStub.getConsumptionUserInfo);
    });

    /** Advances to just after a poll runs, so its backoff starts here. */
    async function settleOnFreshBackoff(): Promise<void> {
      for (let i = 0; i < 200; i++) {
        clientStub.getConsumptionUserInfo.resetHistory();
        await fakeClock.tickAsync(POLL_INTERVAL_MS);
        if (clientStub.getConsumptionUserInfo.called) {
          clientStub.getConsumptionUserInfo.resetHistory();
          return;
        }
      }
      expect.fail('the poller never retried');
    }

    it('caps the backoff at fifteen intervals', async () => {
      // Far more failures than needed to saturate the exponential growth.
      await fakeClock.tickAsync(POLL_INTERVAL_MS * 500);
      await settleOnFreshBackoff();

      await fakeClock.tickAsync(POLL_INTERVAL_MS * 15);
      sinon.assert.notCalled(clientStub.getConsumptionUserInfo);

      await fakeClock.tickAsync(POLL_INTERVAL_MS);
      sinon.assert.calledOnce(clientStub.getConsumptionUserInfo);
    });

    it('caps the backoff even after jitter rounds up', async () => {
      // Maximum jitter, which without a post-jitter clamp turns 15 into 23.
      randomStub.returns(0.999);
      await fakeClock.tickAsync(POLL_INTERVAL_MS * 500);
      await settleOnFreshBackoff();

      await fakeClock.tickAsync(POLL_INTERVAL_MS * 16);

      sinon.assert.called(clientStub.getConsumptionUserInfo);
    });

    it('jitters the backoff', async () => {
      // A second failure has a base of two intervals; maximum jitter takes it
      // to three.
      randomStub.returns(0.999);
      await fakeClock.tickAsync(POLL_INTERVAL_MS * 2);
      clientStub.getConsumptionUserInfo.resetHistory();

      await fakeClock.tickAsync(POLL_INTERVAL_MS * 3);
      sinon.assert.notCalled(clientStub.getConsumptionUserInfo);

      await fakeClock.tickAsync(POLL_INTERVAL_MS);
      sinon.assert.calledOnce(clientStub.getConsumptionUserInfo);
    });

    it('resets the backoff after a success', async () => {
      clientStub.getConsumptionUserInfo.resolves(DEFAULT_CCU_INFO);
      await fakeClock.tickAsync(POLL_INTERVAL_MS * 2);

      // Failing again should earn the one-interval backoff of a first
      // failure, not the two intervals of a second consecutive one.
      clientStub.getConsumptionUserInfo.rejects(new Error('offline again'));
      await fakeClock.tickAsync(POLL_INTERVAL_MS);
      clientStub.getConsumptionUserInfo.resetHistory();

      await fakeClock.tickAsync(POLL_INTERVAL_MS);
      sinon.assert.notCalled(clientStub.getConsumptionUserInfo);

      await fakeClock.tickAsync(POLL_INTERVAL_MS);
      sinon.assert.calledOnce(clientStub.getConsumptionUserInfo);
    });

    it('clears the backoff when toggled off and back on', async () => {
      // Escalate well past a single interval of backoff.
      await fakeClock.tickAsync(POLL_INTERVAL_MS * 10);
      poller.off();
      await fakeClock.tickAsync(TASK_TIMEOUT_MS);
      clientStub.getConsumptionUserInfo.resetHistory();

      poller.on();

      sinon.assert.calledOnce(clientStub.getConsumptionUserInfo);
    });

    it('polls immediately when an assignment changes', () => {
      assignmentChangeEmitter.fire({ added: [], removed: [], changed: [] });

      sinon.assert.calledOnce(clientStub.getConsumptionUserInfo);
    });
  });

  describe('aborts are not network failures', () => {
    beforeEach(async () => {
      sinon.stub(Math, 'random').returns(0.5);
      clientStub.getConsumptionUserInfo.resolves(DEFAULT_CCU_INFO);
      poller.on();
      await fakeClock.tickAsync(TASK_TIMEOUT_MS);
    });

    it('does not accrue backoff from superseded polls', async () => {
      // Hang until aborted, the way an in-flight request behaves.
      clientStub.getConsumptionUserInfo.callsFake(
        (signal?: AbortSignal) =>
          new Promise((_, reject) => {
            signal?.addEventListener('abort', () => {
              reject(new Error('The user aborted a request.'));
            });
          }),
      );

      // Each change abandons the poll the previous one started. Kept well
      // inside the task timeout so none of these is a genuine hang.
      for (let i = 0; i < 3; i++) {
        assignmentChangeEmitter.fire({ added: [], removed: [], changed: [] });
        await fakeClock.tickAsync(1);
      }

      // Let the last one be superseded by a poll that completes, so nothing
      // is left in flight to time out during the probe below.
      clientStub.getConsumptionUserInfo.resolves(DEFAULT_CCU_INFO);
      assignmentChangeEmitter.fire({ added: [], removed: [], changed: [] });
      await fakeClock.tickAsync(1);
      clientStub.getConsumptionUserInfo.resetHistory();

      // A plain scheduled tick: it only runs if no backoff was armed.
      await fakeClock.tickAsync(POLL_INTERVAL_MS);

      sinon.assert.called(clientStub.getConsumptionUserInfo);
    });

    it('polls immediately when toggled back on after being toggled off', async () => {
      poller.off();
      await fakeClock.tickAsync(TASK_TIMEOUT_MS);
      clientStub.getConsumptionUserInfo.resetHistory();

      poller.on();

      sinon.assert.calledOnce(clientStub.getConsumptionUserInfo);
    });

    it('still backs off when a poll times out', async () => {
      // node-fetch rejects on abort, so a timeout surfaces as a rejection.
      clientStub.getConsumptionUserInfo.callsFake(
        (signal?: AbortSignal) =>
          new Promise((_, reject) => {
            signal?.addEventListener('abort', () => {
              reject(new Error('The user aborted a request.'));
            });
          }),
      );
      await fakeClock.tickAsync(POLL_INTERVAL_MS + TASK_TIMEOUT_MS);
      clientStub.getConsumptionUserInfo.resetHistory();

      await fakeClock.tickAsync(POLL_INTERVAL_MS);

      sinon.assert.notCalled(clientStub.getConsumptionUserInfo);
    });
  });

  describe('toggled off', () => {
    beforeEach(async () => {
      clientStub.getConsumptionUserInfo.resolves(DEFAULT_CCU_INFO);
      poller.on();
      // Turning the poller on runs the task immediately. Wait past the task
      // timeout to ensure the immediate invocation runs to completion.
      await fakeClock.tickAsync(TASK_TIMEOUT_MS);
      clientStub.getConsumptionUserInfo.resetHistory();
    });

    it('clears the poll timer', async () => {
      poller.off();

      await fakeClock.tickAsync(POLL_INTERVAL_MS);
      sinon.assert.notCalled(clientStub.getConsumptionUserInfo);
    });

    it('clears the assignment change listener', () => {
      expect(assignmentChangeEmitter.hasListeners()).to.be.true;

      poller.off();

      expect(assignmentChangeEmitter.hasListeners()).to.be.false;
    });

    it('aborts the running worker', async () => {
      const workerStarted = new Deferred<void>();
      const workerCompleter = new Deferred<void>();
      clientStub.getConsumptionUserInfo.callsFake(async () => {
        workerStarted.resolve();
        await workerCompleter.promise;
        return Promise.resolve(DEFAULT_CCU_INFO);
      });

      // Wait for worker to start running
      await fakeClock.tickAsync(POLL_INTERVAL_MS);
      await workerStarted.promise;
      // Turn off poller
      poller.off();
      workerCompleter.resolve();

      // Underlying call should receive an abort signal
      sinon.assert.calledOnceWithMatch(
        clientStub.getConsumptionUserInfo,
        sinon.match((signal: AbortSignal) => signal.aborted),
      );
    });
  });

  it('can be toggled on and off', async () => {
    const onDidChangeCcuInfo: sinon.SinonStub<[ConsumptionUserInfo]> =
      sinon.stub();
    poller.onDidChangeCcuInfo(onDidChangeCcuInfo);

    // On for 3.
    clientStub.getConsumptionUserInfo.resolves({
      ...DEFAULT_CCU_INFO,
      paidComputeUnitsBalance: 3,
    });
    poller.on();
    await fakeClock.tickAsync(POLL_INTERVAL_MS);

    // Off for 2.
    clientStub.getConsumptionUserInfo.resolves({
      ...DEFAULT_CCU_INFO,
      paidComputeUnitsBalance: 2,
    });
    poller.off();
    await fakeClock.tickAsync(POLL_INTERVAL_MS);

    // On for 1.
    clientStub.getConsumptionUserInfo.resolves({
      ...DEFAULT_CCU_INFO,
      paidComputeUnitsBalance: 1,
    });
    poller.on();
    await fakeClock.tickAsync(POLL_INTERVAL_MS);

    sinon.assert.calledTwice(onDidChangeCcuInfo);

    sinon.assert.calledWith(
      onDidChangeCcuInfo.firstCall,
      sinon.match({ paidComputeUnitsBalance: 3 }),
    );
    sinon.assert.calledWith(
      onDidChangeCcuInfo.secondCall,
      sinon.match({ paidComputeUnitsBalance: 1 }),
    );
  });
});
