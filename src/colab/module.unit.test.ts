/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import * as sinon from 'sinon';
import type { StatusBarItem } from 'vscode';
import { GoogleAuthProvider } from '../auth/auth-provider';
import { AssignmentManager } from '../jupyter/assignments';
import {
  newVsCodeStub,
  StatusBarAlignment,
  VsCodeStub,
} from '../test/helpers/vscode';
import { ColabClient } from './client';
import { ConsumptionPoller } from './consumption/poller';
import { ConsumptionStatusBar } from './consumption/status-bar';
import { ExperimentStateProvider } from './experiment-state';
import { createColabClient, createColabModule } from './module';

function stubStatusBarItem(vs: VsCodeStub): StatusBarItem {
  const item: StatusBarItem = {
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
  vs.window.createStatusBarItem.returns(item);
  return item;
}

describe('createColabClient', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('returns a ColabClient', () => {
    const vs = newVsCodeStub();
    const authProvider = sinon.createStubInstance(GoogleAuthProvider);

    const colabClient = createColabClient(vs.asVsCode(), authProvider, {
      publisher: 'google',
      name: 'colab',
      version: '0.0.1-test',
    });

    expect(colabClient).to.exist;
  });
});

describe('createColabModule', () => {
  afterEach(() => {
    sinon.restore();
  });

  function stubAssignmentManager(
    vs: VsCodeStub,
  ): sinon.SinonStubbedInstance<AssignmentManager> {
    const stub = sinon.createStubInstance(AssignmentManager);
    // `onDidAssignmentsChange` is a constructor-set property, not a method,
    // so createStubInstance leaves it undefined; install a real Event so
    // the consumption poller's listener subscription does not blow up.
    Object.defineProperty(stub, 'onDidAssignmentsChange', {
      value: new vs.EventEmitter<unknown>().event,
    });
    return stub;
  }

  it('returns disposables and toggles', () => {
    const vs = newVsCodeStub();
    stubStatusBarItem(vs);
    const colabClient = sinon.createStubInstance(ColabClient);

    const result = createColabModule(
      vs.asVsCode(),
      colabClient,
      stubAssignmentManager(vs),
    );

    expect(result.disposables).to.be.an('array').with.length.greaterThan(0);
    expect(result.toggles).to.be.an('array').with.length.greaterThan(0);
  });

  it('exposes the experiment state provider as a toggle', () => {
    const vs = newVsCodeStub();
    stubStatusBarItem(vs);
    const colabClient = sinon.createStubInstance(ColabClient);

    const result = createColabModule(
      vs.asVsCode(),
      colabClient,
      stubAssignmentManager(vs),
    );

    // Toggles are the auth-gated background services. The notifier is *not*
    // gated; silencing the poller is enough to stop notifications.
    expect(result.toggles).to.have.lengthOf(3);
    expect(
      result.toggles.some((t) => t instanceof ConsumptionPoller),
      'expected a ConsumptionPoller toggle',
    ).to.be.true;
    expect(
      result.toggles.some((t) => t instanceof ConsumptionStatusBar),
      'expected a ConsumptionStatusBar toggle',
    ).to.be.true;
    expect(
      result.toggles.some((t) => t instanceof ExperimentStateProvider),
      'expected an ExperimentStateProvider toggle',
    ).to.be.true;
  });
});
