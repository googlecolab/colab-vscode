/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as sinon from "sinon";
import { OutputChannel } from "vscode";

export class FakeLogOutputChannel implements OutputChannel {
  readonly name = "fake";
  readonly append = sinon.stub();
  readonly appendLine = sinon.stub<[string]>();
  readonly replace = sinon.stub();
  readonly clear = sinon.stub();
  readonly show = sinon.stub();
  readonly hide = sinon.stub();
  readonly dispose = sinon.stub();

  private readonly lines: string[] = [];

  constructor() {
    this.appendLine.callsFake((line: string) => {
      this.lines.push(line);
    });
  }

  get content(): string {
    return this.lines.join("\n");
  }
}
