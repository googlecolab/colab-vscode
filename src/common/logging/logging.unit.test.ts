/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from "chai";
import sinon, { SinonFakeTimers, SinonStubbedInstance } from "sinon";
import {
  ConfigurationChangeEvent,
  WorkspaceConfiguration,
  Disposable,
  ConfigurationScope,
} from "vscode";
import { TestEventEmitter } from "../../test/helpers/events";
import { FakeLogOutputChannel } from "../../test/helpers/output-channel";
import { newVsCodeStub, VsCodeStub } from "../../test/helpers/vscode";
import { initializeLogger, log, LogLevel } from ".";

const TEST_ISO_TIME = "1994-08-24T14:34:00.010Z";
const TEST_DATE = new Date(TEST_ISO_TIME);

describe("Logging Module", () => {
  let fakeClock: SinonFakeTimers;
  let consoleStub: SinonStubbedInstance<Console>;
  let logSink: FakeLogOutputChannel;
  let configChangeEmitter: TestEventEmitter<ConfigurationChangeEvent>;
  let logging: Disposable | undefined;
  let logLevel: Lowercase<keyof typeof LogLevel> = "info";
  let vs: VsCodeStub;

  beforeEach(() => {
    fakeClock = sinon.useFakeTimers({ now: TEST_DATE, toFake: [] });
    vs = newVsCodeStub();
    logSink = new FakeLogOutputChannel();
    (vs.window.createOutputChannel as sinon.SinonStub).returns(logSink);
    vs.workspace.getConfiguration.withArgs("colab.logging").returns({
      get: () => logLevel,
    } as Pick<WorkspaceConfiguration, "get"> as WorkspaceConfiguration);
    consoleStub = sinon.stub(console);
    configChangeEmitter = new TestEventEmitter<ConfigurationChangeEvent>();
    vs.workspace.onDidChangeConfiguration.callsFake(configChangeEmitter.event);
  });

  afterEach(() => {
    logging?.dispose();
    fakeClock.restore();
    sinon.restore();
  });

  describe("lifecycle", () => {
    it("throws if doubly initialized", () => {
      logging = initializeLogger(vs.asVsCode(), vs.ExtensionMode.Production);

      expect(() =>
        initializeLogger(vs.asVsCode(), vs.ExtensionMode.Production),
      ).to.throw(/already/);
    });

    it("throws if used before being initialized", () => {
      expect(() => {
        log.info("test");
      }).to.throw(
        "Logger not initialized. Call initializeLogger() before logging.",
      );
    });

    it("disposes config listener and output channel when disposed", () => {
      logging = initializeLogger(vs.asVsCode(), vs.ExtensionMode.Production);

      logging.dispose();

      expect(configChangeEmitter.hasListeners()).to.be.false;
      sinon.assert.calledOnce(logSink.dispose);
    });
  });

  describe("in dev mode", () => {
    beforeEach(() => {
      logging = initializeLogger(vs.asVsCode(), vs.ExtensionMode.Development);
    });

    it("logs to console", () => {
      log.info("test");

      sinon.assert.calledOnce(consoleStub.info);
    });

    it("focuses output channel", () => {
      sinon.assert.calledOnceWithMatch(logSink.show);
    });
  });

  describe("logs", () => {
    it("each of the log levels", () => {
      logLevel = "trace";
      logging = initializeLogger(vs.asVsCode(), vs.ExtensionMode.Production);

      log.error("error");
      log.warn("warn");
      log.info("info");
      log.debug("debug");
      log.trace("trace");

      expect(logSink.content).to.equal(
        `
[${TEST_ISO_TIME}] [Error] error
[${TEST_ISO_TIME}] [Warning] warn
[${TEST_ISO_TIME}] [Info] info
[${TEST_ISO_TIME}] [Debug] debug
[${TEST_ISO_TIME}] [Trace] trace
      `.trim(),
      );
    });

    it("only logs messages at or above the configured level", () => {
      logLevel = "warning";
      logging = initializeLogger(vs.asVsCode(), vs.ExtensionMode.Production);

      log.error("error");
      log.warn("warn");
      log.info("info");
      log.debug("debug");
      log.trace("trace");

      expect(logSink.content).to.equal(
        `
[${TEST_ISO_TIME}] [Error] error
[${TEST_ISO_TIME}] [Warning] warn
      `.trim(),
      );
    });

    it("respects logging level configuration changes", () => {
      logLevel = "info";
      logging = initializeLogger(vs.asVsCode(), vs.ExtensionMode.Production);
      log.info("first info");

      logLevel = "error";

      const s: sinon.SinonStub<[string, ConfigurationScope], boolean> =
        sinon.stub();
      s.withArgs("colab.logging").returns(true);
      configChangeEmitter.fire({ affectsConfiguration: s });
      log.info("second info");
      log.error("first error");

      expect(logSink.content).to.equal(
        `
[${TEST_ISO_TIME}] [Info] first info
[${TEST_ISO_TIME}] [Error] first error
      `.trim(),
      );
    });
  });
});
