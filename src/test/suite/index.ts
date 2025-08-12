/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from "path";
import { Glob } from "glob";
import Mocha from "mocha";

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: "bdd",
  });

  const testsRoot = path.resolve(__dirname, "..");

  return new Promise((c, e) => {
    const files = new Glob("**/**vscode.test.js", { cwd: testsRoot });

    for (const file of files) {
      mocha.addFile(path.resolve(testsRoot, file));
    }

    try {
      mocha.run((failures) => {
        if (failures > 0) {
          e(new Error(`${failures.toString()} tests failed.`));
        } else {
          c();
        }
      });
    } catch (err) {
      console.error(err);
      e(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
