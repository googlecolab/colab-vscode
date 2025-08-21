/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { assert, expect } from "chai";
import sinon, { SinonFakeTimers, SinonStubbedInstance } from "sinon";
import { TestEventEmitter } from "../test/helpers/events";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { CcuInfo, SubscriptionTier } from "./api";
import { ColabClient } from "./client";
import { ConsumptionNotifier } from "./consumption-notifier";

const NOTIFICATION_SEVERITIES = ["warn", "error"] as const;
type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

// Since notifications are dispatched asynchronously and are non-blocking, when
// we don't expect one to show our only way of asserting the behavior is to
// punch a hole in the code and wrap the notification-handling code 🤢.
//
// This could be improved in the future if the ConsumptionNotifier dispatched
// events each time it calculated the remaining minutes (e.g. for logging
// purposes).
class TestConsumptionNotifier extends ConsumptionNotifier {
  override notifyCcuConsumption(e: CcuInfo): Promise<void> {
    return super.notifyCcuConsumption(e);
  }

  /**
   * Capture the next consumption calculation.
   *
   * @returns A promise which resolves the next time CCU consumption is
   * performed. The promise is blocked on the notification "completing". In
   * other words, either no notification is shown, or one is shown and dismissed
   * (exit or click on action).
   */
  async nextConsumptionCalculation(): Promise<void> {
    const orig = this.notifyCcuConsumption;
    const stub = sinon.stub(this, "notifyCcuConsumption");
    const res = new Promise<void>((resolve) => {
      stub.callsFake(async (...args) => {
        try {
          await orig.apply(this, args);
        } finally {
          resolve();
        }
      });
    });
    return res.then(() => {
      stub.restore();
    });
  }
}

describe("ConsumptionNotifier", () => {
  let vs: VsCodeStub;
  let colabClient: SinonStubbedInstance<ColabClient>;
  let ccuEmitter: TestEventEmitter<CcuInfo>;
  let consumptionNotifier: TestConsumptionNotifier;

  beforeEach(() => {
    vs = newVsCodeStub();
    colabClient = sinon.createStubInstance(ColabClient);
    colabClient.getSubscriptionTier.resolves(SubscriptionTier.NONE);

    ccuEmitter = new TestEventEmitter<CcuInfo>();

    consumptionNotifier = new TestConsumptionNotifier(
      vs.asVsCode(),
      colabClient,
      ccuEmitter.event,
    );
  });

  afterEach(() => {
    consumptionNotifier.dispose();
    sinon.restore();
  });

  /**
   * Captures the next notification matching the provided severity.
   *
   * @param severity - The severity of the notification to capture ("warn" or
   * "error").
   */
  async function nextNotification(severity: NotificationSeverity): Promise<{
    message: string;
    actions: string[];
    click: (action: string) => void;
  }> {
    return new Promise((resolve) => {
      // Type assertion needed due to overloading.
      (
        vs.window[
          severity === "warn" ? "showWarningMessage" : "showErrorMessage"
        ] as sinon.SinonStub
      ).callsFake(
        async (
          message: string,
          ...actions: string[]
        ): Promise<string | undefined> => {
          let resolveNotificationAction: (
            value: string | PromiseLike<string | undefined> | undefined,
          ) => void;
          const res = new Promise<string | undefined>((resolve) => {
            resolveNotificationAction = resolve;
          });
          const click = (clickedAction: string) => {
            assert(actions.includes(clickedAction));
            resolveNotificationAction(clickedAction);
          };
          resolve({ message, actions, click });
          return res;
        },
      );
    });
  }

  it("disposes the CCU listener on dispose", () => {
    consumptionNotifier.dispose();

    expect(ccuEmitter.hasListeners()).to.be.false;
  });

  interface RemainingConsumption {
    paidMinutes: number;
    freeMinutes: number;
  }

  function createCcuInfo(c: RemainingConsumption): CcuInfo {
    const hourlyConsumptionRate = 0.07;
    const paidBalance = (c.paidMinutes / 60) * hourlyConsumptionRate;
    const freeTokens = (c.freeMinutes / 60) * hourlyConsumptionRate * 1000;
    return {
      currentBalance: paidBalance,
      consumptionRateHourly: hourlyConsumptionRate,
      freeCcuQuotaInfo: {
        remainingTokens: freeTokens,
        nextRefillTimestampSec: 0,
      },
      // Irrelevant fields for SUT.
      assignmentsCount: 1,
      eligibleGpus: [],
      eligibleTpus: [],
    };
  }

  const nonNotifyingTests: {
    label: string;
    tier: SubscriptionTier;
    paidMinutes: number;
    freeMinutes: number;
  }[] = [
    {
      label: "free with sufficient free minutes",
      tier: SubscriptionTier.NONE,
      paidMinutes: 0,
      freeMinutes: 31,
    },
    {
      label: "pay-as-you-go with sufficient paid minutes",
      tier: SubscriptionTier.NONE,
      paidMinutes: 31,
      freeMinutes: 0,
    },
    {
      label: "pay-as-you-go with sufficient combined paid and free minutes",
      tier: SubscriptionTier.NONE,
      paidMinutes: 15,
      freeMinutes: 16,
    },
    {
      label: "subscribed with sufficient paid minutes",
      tier: SubscriptionTier.PRO,
      paidMinutes: 31,
      freeMinutes: 0,
    },
    {
      label: "subscribed with sufficient free minutes",
      tier: SubscriptionTier.PRO,
      paidMinutes: 0,
      freeMinutes: 31,
    },
    {
      label: "subscribed with sufficient combined paid and free minutes",
      tier: SubscriptionTier.PRO,
      paidMinutes: 15,
      freeMinutes: 16,
    },
  ];
  for (const t of nonNotifyingTests) {
    it(`should not notify when ${t.label}`, async () => {
      colabClient.getSubscriptionTier.resolves(t.tier);
      const ccuInfo = createCcuInfo({
        paidMinutes: t.paidMinutes,
        freeMinutes: t.freeMinutes,
      });

      const noOp = consumptionNotifier.nextConsumptionCalculation();
      ccuEmitter.fire(ccuInfo);
      await noOp;

      sinon.assert.notCalled(vs.window.showWarningMessage);
      sinon.assert.notCalled(vs.window.showErrorMessage);
    });
  }

  const notifyingTests: {
    label: string;
    tier: SubscriptionTier;
    paidMinutes: number;
    freeMinutes: number;
    should: {
      severity: NotificationSeverity;
      action: "Sign Up" | "Upgrade" | "Purchase More";
    };
  }[] = [
    {
      label: "unsubscribed with no free minutes",
      tier: SubscriptionTier.NONE,
      paidMinutes: 0,
      freeMinutes: 0,
      should: {
        severity: "error",
        action: "Sign Up",
      },
    },
    {
      label: "unsubscribed with minimal free minutes",
      tier: SubscriptionTier.NONE,
      paidMinutes: 0,
      freeMinutes: 1,
      should: {
        severity: "warn",
        action: "Sign Up",
      },
    },
    {
      label: "pay-as-you-go with minimal paid minutes and no free minutes",
      tier: SubscriptionTier.NONE,
      paidMinutes: 1,
      freeMinutes: 0,
      should: {
        severity: "warn",
        action: "Purchase More",
      },
    },
    {
      label: "pay-as-you-go with minimal combined paid and free minutes",
      tier: SubscriptionTier.NONE,
      paidMinutes: 1,
      freeMinutes: 1,
      should: {
        severity: "warn",
        action: "Purchase More",
      },
    },
    {
      label: "pro with no paid or free minutes",
      tier: SubscriptionTier.PRO,
      paidMinutes: 0,
      freeMinutes: 0,
      should: {
        severity: "error",
        action: "Upgrade",
      },
    },
    {
      label: "pro with no paid and minimal free minutes",
      tier: SubscriptionTier.PRO,
      paidMinutes: 0,
      freeMinutes: 1,
      should: {
        severity: "warn",
        action: "Upgrade",
      },
    },
    {
      // Seems like a weird case, but consider a free user who consumes all
      // their quota but then signs up for Pro.
      label: "pro with minimal paid and no free minutes",
      tier: SubscriptionTier.PRO,
      paidMinutes: 1,
      freeMinutes: 0,
      should: {
        severity: "warn",
        action: "Upgrade",
      },
    },
    {
      label: "pro with minimal combined paid and free minutes",
      tier: SubscriptionTier.PRO,
      paidMinutes: 1,
      freeMinutes: 1,
      should: {
        severity: "warn",
        action: "Upgrade",
      },
    },
    {
      label: "pro+ with no paid or free minutes",
      tier: SubscriptionTier.PRO_PLUS,
      paidMinutes: 0,
      freeMinutes: 0,
      should: {
        severity: "error",
        action: "Purchase More",
      },
    },
    {
      label: "pro+ with no paid and minimal free minutes",
      tier: SubscriptionTier.PRO_PLUS,
      paidMinutes: 0,
      freeMinutes: 1,
      should: {
        severity: "warn",
        action: "Purchase More",
      },
    },
    {
      // Seems like a weird case, but consider a free user who consumes all
      // their quota but then signs up for Pro+.
      label: "pro+ with minimal paid and no free minutes",
      tier: SubscriptionTier.PRO_PLUS,
      paidMinutes: 1,
      freeMinutes: 0,
      should: {
        severity: "warn",
        action: "Purchase More",
      },
    },
    {
      label: "pro+ with minimal combined paid and free minutes",
      tier: SubscriptionTier.PRO_PLUS,
      paidMinutes: 1,
      freeMinutes: 1,
      should: {
        severity: "warn",
        action: "Purchase More",
      },
    },
  ];
  for (const t of notifyingTests) {
    const action = t.should.action.toLowerCase();
    it(`should ${t.should.severity} with a prompt to ${action} when ${t.label}`, async () => {
      colabClient.getSubscriptionTier.resolves(t.tier);
      const ccuInfo = createCcuInfo({
        paidMinutes: t.paidMinutes,
        freeMinutes: t.freeMinutes,
      });

      const waitForNotification = nextNotification(t.should.severity);
      ccuEmitter.fire(ccuInfo);
      const notification = await waitForNotification;

      const minutesLeft = (t.paidMinutes + t.freeMinutes).toString();
      const expectedMessage =
        t.should.severity === "error"
          ? /depleted/
          : new RegExp(`${minutesLeft} minutes left`);
      expect(notification.message).to.match(expectedMessage);
      expect(notification.actions).to.have.lengthOf(1);
      const action = notification.actions[0];
      expect(action).to.match(new RegExp(t.should.action));
      const notificationStub =
        t.should.severity === "error"
          ? vs.window.showErrorMessage
          : vs.window.showWarningMessage;
      sinon.assert.calledOnce(notificationStub);
    });
  }

  for (const severity of NOTIFICATION_SEVERITIES) {
    it(`should open signup page when action is clicked for ${severity}`, async () => {
      const ccuInfo = createCcuInfo({
        paidMinutes: 0,
        freeMinutes: severity === "warn" ? 1 : 0,
      });
      const notification = nextNotification(severity);
      ccuEmitter.fire(ccuInfo);
      const shownNotification = await notification;
      const openExternal = new Promise<string>((resolve) => {
        vs.env.openExternal.callsFake((target) => {
          resolve(target.toString());
          return Promise.resolve(true);
        });
      });

      shownNotification.click("Sign Up for Colab");

      await expect(openExternal).to.eventually.equal(
        "https://colab.research.google.com/signup",
      );
    });
  }

  describe("snooze", () => {
    let fakeClock: SinonFakeTimers;

    beforeEach(() => {
      fakeClock = sinon.useFakeTimers({ toFake: ["setTimeout"] });
    });

    afterEach(() => {
      fakeClock.restore();
    });

    for (const severity of NOTIFICATION_SEVERITIES) {
      it(`should not ${severity} while in "snooze" period`, async () => {
        const ccuInfo = createCcuInfo({
          paidMinutes: 0,
          freeMinutes: severity === "warn" ? 1 : 0,
        });
        const firstNotification = nextNotification(severity);
        ccuEmitter.fire(ccuInfo);
        await firstNotification;
        fakeClock.tick(1);

        // Expect no notification while within "snooze" period.
        const noOp = consumptionNotifier.nextConsumptionCalculation();
        ccuEmitter.fire(ccuInfo);
        expect(noOp).to.eventually.be.fulfilled;

        fakeClock.tick(1000 * 60 * 30); // 30 minutes

        // Expect a notification after the "snooze" period.
        const secondNotification = nextNotification(severity);
        ccuEmitter.fire(ccuInfo);
        expect(secondNotification).to.eventually.be.fulfilled;
      });
    }
  });
});
