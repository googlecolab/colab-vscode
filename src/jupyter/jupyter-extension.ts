/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Jupyter } from "@vscode/jupyter-extension";
import { satisfies as semVerSatisfies } from "semver";
import vscode, { Extension } from "vscode";
import { getPackageInfo } from "../config/package-info";

const JUPYTER_SEMVER_RANGE = ">=2025.0.0";

/**
 * Get the exported API from the Jupyter extension.
 */
export async function getJupyterApi(vs: typeof vscode): Promise<Jupyter> {
  const ext = vs.extensions.getExtension<Jupyter>("ms-toolsai.jupyter");
  if (!ext) {
    throw new Error("Jupyter Extension not installed");
  }
  validateJupyterVersion(ext);
  if (!ext.isActive) {
    await ext.activate();
  }
  return ext.exports;
}

function validateJupyterVersion(jupyter: Extension<Jupyter>) {
  const got = getPackageInfo(jupyter).version;
  const want = JUPYTER_SEMVER_RANGE;

  if (!semVerSatisfies(got, JUPYTER_SEMVER_RANGE)) {
    throw new Error(
      `Jupyter version "${got}" does not satisfy required version range "${want}"`,
    );
  }
}
