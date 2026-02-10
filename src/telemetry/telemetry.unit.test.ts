/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon, { SinonSpy, SinonFakeTimers } from 'sinon';
import type vscode from 'vscode';
import { Disposable } from 'vscode';
import { COLAB_EXT_IDENTIFIER } from '../config/constants';
import { JUPYTER_EXT_IDENTIFIER } from '../jupyter/jupyter-extension';
import { newVsCodeStub, VsCodeStub } from '../test/helpers/vscode';
import { ColabLogEventBase } from './api';
import { ClearcutClient } from './client';
import { initializeTelemetry, telemetry } from '.';

const NOW = Date.now();
const SESSION_ID = 'sessionId';
const VERSION_COLAB = '0.1.0';
const VERSION_JUPYTER = '2025.0.0';
const VERSION_VSCODE = '1.109.0';

describe('Telemetry Module', () => {
  let disposeTelemetry: Disposable | undefined;
  let fakeClock: SinonFakeTimers;
  let vs: VsCodeStub;

  beforeEach(() => {
    fakeClock = sinon.useFakeTimers({ now: NOW, toFake: [] });
    vs = newVsCodeStub();
    const packageJSON = { name: '', publisher: '' };
    vs.extensions.getExtension
      .withArgs(COLAB_EXT_IDENTIFIER)
      .returns({
        packageJSON: { ...packageJSON, version: VERSION_COLAB },
      } as vscode.Extension<unknown>)
      .withArgs(JUPYTER_EXT_IDENTIFIER)
      .returns({
        packageJSON: { ...packageJSON, version: VERSION_JUPYTER },
      } as vscode.Extension<unknown>);
    vs.env.sessionId = SESSION_ID;
    vs.version = VERSION_VSCODE;
  });

  afterEach(() => {
    sinon.restore();
    disposeTelemetry?.dispose();
  });

  describe('lifecycle', () => {
    it('throws if doubly initialized', () => {
      disposeTelemetry = initializeTelemetry(vs.asVsCode());

      expect(() => {
        initializeTelemetry(vs.asVsCode());
      }).to.throw(/already been initialized/);
    });

    it('no-ops silently before being initialized', () => {
      expect(() => {
        telemetry.logActivation();
      }).not.to.throw();
    });

    it('disposes the client when disposed', () => {
      const disposeSpy = sinon.spy(ClearcutClient.prototype, 'dispose');
      disposeTelemetry = initializeTelemetry(vs.asVsCode());

      disposeTelemetry.dispose();

      sinon.assert.calledOnce(disposeSpy);
    });
  });

  describe('logs to Clearcut', () => {
    let baseLog: ColabLogEventBase & { timestamp: string };
    let logSpy: SinonSpy;

    beforeEach(() => {
      logSpy = sinon.spy(ClearcutClient.prototype, 'log');
      baseLog = {
        extension_version: VERSION_COLAB,
        jupyter_extension_version: VERSION_JUPYTER,
        session_id: SESSION_ID,
        ui_kind: 'UI_KIND_DESKTOP',
        vscode_version: VERSION_VSCODE,
        timestamp: new Date(NOW).toISOString(),
      };
      disposeTelemetry = initializeTelemetry(vs.asVsCode());
    });

    it('on activation', () => {
      telemetry.logActivation();

      sinon.assert.calledOnceWithExactly(logSpy, {
        ...baseLog,
        activation_event: {},
      });
    });

    const errors = [
      {
        type: 'error',
        getError: () => {
          const e = new Error('message');
          e.name = 'ErrorName';
          e.stack = 'stack';
          return e;
        },
        error_event: { name: 'ErrorName', msg: 'message', stack: 'stack' },
      },
      {
        type: 'string',
        getError: () => 'Foo error',
        error_event: { name: 'Error', msg: 'Foo error', stack: '' },
      },
      {
        type: 'object',
        getError: () => {
          return { e: 'Foo error' };
        },
        error_event: { name: 'Error', msg: '{"e":"Foo error"}', stack: '' },
      },
      {
        type: 'undefined',
        getError: () => undefined,
        error_event: { name: 'Error', msg: 'undefined', stack: '' },
      },
    ];
    for (const { type, getError, error_event } of errors) {
      it(`on error with type ${type}`, () => {
        telemetry.logError(getError());

        sinon.assert.calledOnceWithExactly(logSpy, {
          ...baseLog,
          error_event,
        });
      });
    }

    it('with the correct time', () => {
      const curTime = fakeClock.tick(100);

      telemetry.logActivation();

      sinon.assert.calledOnceWithExactly(logSpy, {
        ...baseLog,
        activation_event: {},
        timestamp: new Date(curTime).toISOString(),
      });
    });
  });
});
