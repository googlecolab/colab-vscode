/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Disposable, WorkspaceConfiguration } from "vscode";
import { initializeLogger, LogLevel } from "../../common/logging";
import { FakeLogOutputChannel } from "./output-channel";
import { VsCodeStub } from "./vscode";

/**
 * Helper for capturing log output during tests.
 */
export class ColabLogWatcher implements Disposable {
  private readonly logSink: FakeLogOutputChannel;
  private logging: Disposable | undefined;

  constructor(vs: VsCodeStub, level: LogLevel = LogLevel.Info) {
    this.logSink = new FakeLogOutputChannel();
    // Cast needed due to overloading.
    (vs.window.createOutputChannel as sinon.SinonStub)
      .withArgs("Colab")
      .returns(this.logSink);
    vs.workspace.getConfiguration.withArgs("colab.logging").returns({
      get: () => level,
    } as Pick<WorkspaceConfiguration, "get"> as WorkspaceConfiguration);
    vs.workspace.onDidChangeConfiguration.callsFake(() => {
      return {
        dispose() {
          return;
        },
      };
    });

    try {
      this.logging = initializeLogger(vs.asVsCode(), vs.ExtensionMode.Test);
    } catch (err: unknown) {
      const innerErrMsg = err instanceof Error ? err.message : String(err);
      const lines = [
        "Failed to initialize logger for test.",
        "Likely because a previous ColabLogWatcher was not disposed.",
        "Ensure you call dispose() (e.g., in an afterEach) to clean up the watcher.",
        "",
        innerErrMsg,
      ];
      throw new Error(lines.map((l, i) => (i === 0 ? l : `\t${l}`)).join("\n"));
    }
  }

  dispose() {
    this.logging?.dispose();
    this.logging = undefined;
  }

  get output(): string {
    if (!this.logging) {
      throw new Error("Cannot get output after disposal.");
    }
    return this.logSink.content;
  }
}
