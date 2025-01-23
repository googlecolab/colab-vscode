import { Jupyter } from "@vscode/jupyter-extension";
import vscode from "vscode";

/**
 * Get the exported API from the Jupyter extension.
 */
export async function getJupyterApi(vs: typeof vscode): Promise<Jupyter> {
  const ext = vs.extensions.getExtension<Jupyter>("ms-toolsai.jupyter");
  if (!ext) {
    throw new Error("Jupyter Extension not installed");
  }
  if (!ext.isActive) {
    await ext.activate();
  }
  return ext.exports;
}
