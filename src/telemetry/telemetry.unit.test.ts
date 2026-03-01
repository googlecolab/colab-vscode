/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon, { SinonSpy, SinonFakeTimers } from 'sinon';
import vscode from 'vscode';
import { Disposable } from 'vscode';
import { COLAB_EXT_IDENTIFIER } from '../config/constants';
import { JUPYTER_EXT_IDENTIFIER } from '../jupyter/jupyter-extension';
import { newVsCodeStub, VsCodeStub } from '../test/helpers/vscode';
import { ColabLogEventBase } from './api';
import { ClearcutClient } from './client';
import { initializeTelemetry, telemetry, EventSource } from '.';

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

  it('does not log to Clearcut when telemetry is disabled', () => {
    const logStub = sinon.stub(ClearcutClient.prototype, 'log');
    vs.env.isTelemetryEnabled = false;
    disposeTelemetry = initializeTelemetry(vs.asVsCode());

    telemetry.logActivation();

    sinon.assert.notCalled(logStub);
  });

  it('enables telemetry when isTelemetryEnabled is true', () => {
    const logStub = sinon.stub(ClearcutClient.prototype, 'log');
    vs.env.isTelemetryEnabled = false;
    // Maintain a reference to this stub as that's the reference telemetry has.
    const vscodeStub = vs.asVsCode();
    disposeTelemetry = initializeTelemetry(vscodeStub);

    telemetry.logActivation();
    sinon.assert.notCalled(logStub);
    logStub.resetHistory();

    // Required to change read-only property
    (vscodeStub.env as { isTelemetryEnabled: boolean }).isTelemetryEnabled =
      true;
    telemetry.logActivation();
    sinon.assert.calledOnce(logStub);
  });

  it('disables telemetry when isTelemetryEnabled is false', () => {
    const logStub = sinon.stub(ClearcutClient.prototype, 'log');
    // Maintain a reference to this stub as that's the reference telemetry has.
    const vscodeStub = vs.asVsCode();
    disposeTelemetry = initializeTelemetry(vscodeStub);

    telemetry.logActivation();
    sinon.assert.calledOnce(logStub);
    logStub.resetHistory();

    // Required to change read-only property
    (vscodeStub.env as { isTelemetryEnabled: boolean }).isTelemetryEnabled =
      false;
    telemetry.logActivation();
    sinon.assert.notCalled(logStub);
  });

  describe('logs to Clearcut', () => {
    const PLATFORM = 'darwin';
    let baseLog: ColabLogEventBase & { timestamp: string };
    let logStub: SinonSpy;

    beforeEach(() => {
      logStub = sinon.stub(ClearcutClient.prototype, 'log');
      sinon.stub(process, 'platform').get(() => PLATFORM);
      baseLog = {
        app_name: 'VS Code',
        extension_version: VERSION_COLAB,
        jupyter_extension_version: VERSION_JUPYTER,
        platform: PLATFORM,
        session_id: SESSION_ID,
        ui_kind: 'UI_KIND_DESKTOP',
        vscode_version: VERSION_VSCODE,
        timestamp: new Date(NOW).toISOString(),
      };
      disposeTelemetry = initializeTelemetry(vs.asVsCode());
    });

    it('on activation', () => {
      telemetry.logActivation();

      sinon.assert.calledOnceWithExactly(logStub, {
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

        sinon.assert.calledOnceWithExactly(logStub, {
          ...baseLog,
          error_event,
        });
      });
    }

    it('with the correct time', () => {
      const curTime = fakeClock.tick(100);

      telemetry.logActivation();

      sinon.assert.calledOnceWithExactly(logStub, {
        ...baseLog,
        activation_event: {},
        timestamp: new Date(curTime).toISOString(),
      });
    });

    it('logs on auto connect', () => {
      telemetry.logAutoConnect();

      sinon.assert.calledOnceWithExactly(logStub, {
        ...baseLog,
        auto_connect_event: {},
      });
    });

    it('logs on server assignment', () => {
      telemetry.logAssignServerEvent();

      sinon.assert.calledOnceWithExactly(logStub, {
        ...baseLog,
        assign_server_event: {
          server: 'Unknown',
          variant: 'Unknown',
          accelerator: undefined,
          shape: undefined,
          version: undefined,
        },
      });
    });

    it('logs when servers are pruned', () => {
      const servers = ['server1', 'server2'];
      telemetry.logPruneServersEvent(servers);

      sinon.assert.calledOnceWithExactly(logStub, {
        ...baseLog,
        prune_servers_event: { servers },
      });
    });

    it('logs on server removal', () => {
      const server = 'server';
      telemetry.logRemoveServerEvent(server);

      sinon.assert.calledOnceWithExactly(logStub, {
        ...baseLog,
        remove_server_event: { server, source: EventSource.UNKNOWN },
      });
    });
  });
});
