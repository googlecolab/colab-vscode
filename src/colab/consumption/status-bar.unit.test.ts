/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import * as sinon from 'sinon';
import { StatusBarItem } from 'vscode';
import { TestEventEmitter } from '../../test/helpers/events';
import {
  VsCodeStub,
  newVsCodeStub,
  StatusBarAlignment,
} from '../../test/helpers/vscode';
import { ConsumptionUserInfo, SubscriptionTier } from '../api';
import { ConsumptionStatusBar } from './status-bar';

describe('ConsumptionStatusBar', () => {
  let vs: VsCodeStub;
  let ccuEmitter: TestEventEmitter<ConsumptionUserInfo>;
  let consumptionStatusBar: ConsumptionStatusBar;
  let testStatusBarItem: StatusBarItem;

  beforeEach(() => {
    vs = newVsCodeStub();

    testStatusBarItem = {
      id: 'colab.consumptionStatusBar',
      alignment: StatusBarAlignment.Right,
      priority: undefined,
      name: undefined,
      text: '',
      tooltip: undefined,
      color: undefined,
      backgroundColor: undefined,
      command: undefined,
      accessibilityInformation: undefined,
      show: sinon.stub(),
      hide: sinon.stub(),
      dispose: sinon.stub(),
    };
    vs.window.createStatusBarItem.returns(testStatusBarItem);

    ccuEmitter = new TestEventEmitter<ConsumptionUserInfo>();
    consumptionStatusBar = new ConsumptionStatusBar(
      vs.asVsCode(),
      ccuEmitter.event,
    );
  });

  afterEach(() => {
    sinon.restore();
  });

  it('creates status bar item with name', () => {
    expect(testStatusBarItem.name).to.equal('Colab Status');
  });

  describe('on', () => {
    it('shows status bar item', () => {
      consumptionStatusBar.on();

      sinon.assert.calledOnce(testStatusBarItem.show as sinon.SinonStub);
    });

    it('throws if disposed', () => {
      consumptionStatusBar.dispose();

      expect(() => {
        consumptionStatusBar.on();
      }).to.throw(/Cannot use ConsumptionStatusBar after it has been disposed/);

      sinon.assert.notCalled(testStatusBarItem.show as sinon.SinonStub);
    });
  });

  describe('off', () => {
    it('hides status bar item', () => {
      consumptionStatusBar.off();

      sinon.assert.calledOnce(testStatusBarItem.hide as sinon.SinonStub);
    });

    it('throws if disposed', () => {
      consumptionStatusBar.dispose();

      expect(() => {
        consumptionStatusBar.off();
      }).to.throw(/Cannot use ConsumptionStatusBar after it has been disposed/);

      sinon.assert.notCalled(testStatusBarItem.hide as sinon.SinonStub);
    });
  });

  describe('dispose', () => {
    it('disposes listener and status bar item', () => {
      consumptionStatusBar.dispose();

      expect(ccuEmitter.hasListeners()).to.be.false;
      sinon.assert.calledOnce(testStatusBarItem.dispose as sinon.SinonStub);
    });

    it('is idempotent', () => {
      consumptionStatusBar.dispose();
      expect(ccuEmitter.hasListeners()).to.be.false;
      sinon.assert.calledOnce(testStatusBarItem.dispose as sinon.SinonStub);

      // Second call should not throw or cause issues.
      consumptionStatusBar.dispose();
      expect(ccuEmitter.hasListeners()).to.be.false;
      sinon.assert.calledOnce(testStatusBarItem.dispose as sinon.SinonStub);
    });
  });

  describe('on ConsumptionUserInfo change', () => {
    const baseConsumptionUserInfo: ConsumptionUserInfo = {
      subscriptionTier: SubscriptionTier.NONE,
      paidComputeUnitsBalance: 0,
      consumptionRateHourly: 0.07,
      eligibleAccelerators: [],
      ineligibleAccelerators: [],
      assignmentsCount: 0,
    };

    it('updates status bar text', () => {
      ccuEmitter.fire(baseConsumptionUserInfo);

      expect(testStatusBarItem.text).to.equal('$(colab-logo) 0.07/hr');
    });

    const tierTests = [
      {
        name: 'free tier',
        subscriptionTier: SubscriptionTier.NONE,
        expectedTooltipPart: 'You are not subscribed.',
      },
      {
        name: 'pro tier',
        subscriptionTier: SubscriptionTier.PRO,
        expectedTooltipPart: 'You are subscribed to Colab Pro.',
      },
      {
        name: 'pro+ tier',
        subscriptionTier: SubscriptionTier.PRO_PLUS,
        expectedTooltipPart: 'You are subscribed to Colab Pro+.',
      },
    ];
    const paidBalanceTests = [
      {
        name: 'no paid balance or free quota',
        paidComputeUnitsBalance: 0,
        freeCcuQuotaInfo: undefined,
        consumptionRateHourly: 0.07,
        assignmentsCount: 0,
        expectedTooltipPart:
          'You currently have zero compute units available. Resources offered free of charge are not guaranteed.',
      },
      {
        name: 'no paid balance or consumption rate',
        paidComputeUnitsBalance: 0,
        freeCcuQuotaInfo: { remainingTokens: 6000, nextRefillTimestampSec: 0 },
        consumptionRateHourly: 0,
        assignmentsCount: 0,
        expectedTooltipPart:
          'You currently have zero compute units available. Resources offered free of charge are not guaranteed.',
      },
      {
        name: 'no paid balance but free quota and consumption rate',
        paidComputeUnitsBalance: 0,
        freeCcuQuotaInfo: { remainingTokens: 6000, nextRefillTimestampSec: 0 },
        consumptionRateHourly: 0.07,
        assignmentsCount: 0,
        expectedTooltipPart: `You currently have zero compute units available. Resources offered free of charge are not guaranteed.

At your current usage level, your server(s) may last up to 85h40m.`,
      },
      {
        name: 'paid balance',
        paidComputeUnitsBalance: 123.45,
        freeCcuQuotaInfo: undefined,
        consumptionRateHourly: 0.07,
        assignmentsCount: 4,
        expectedTooltipPart: `Available: 123.45 compute units
Usage rate: approximately 0.07 per hour
You have 4 active session(s).`,
      },
    ];
    tierTests.forEach((tt) => {
      paidBalanceTests.forEach((pbt) => {
        it(`updates status bar tooltip with ${tt.name} and ${pbt.name}`, () => {
          const updatedInfo = {
            ...baseConsumptionUserInfo,
            subscriptionTier: tt.subscriptionTier,
            paidComputeUnitsBalance: pbt.paidComputeUnitsBalance,
            freeCcuQuotaInfo: pbt.freeCcuQuotaInfo,
            consumptionRateHourly: pbt.consumptionRateHourly,
            assignmentsCount: pbt.assignmentsCount,
          };

          ccuEmitter.fire(updatedInfo);

          expect(testStatusBarItem.tooltip).to.equal(
            `${tt.expectedTooltipPart}\n\n${pbt.expectedTooltipPart}`,
          );
        });
      });
    });
  });
});
