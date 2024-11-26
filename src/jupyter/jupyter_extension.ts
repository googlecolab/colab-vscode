import { Jupyter } from "@vscode/jupyter-extension";
import { extensions } from "vscode";

/**
 * Get the exported API from the Jupyter extension.
 */
export async function getJupyterApi(): Promise<Jupyter> {
  const ext = extensions.getExtension<Jupyter>("ms-toolsai.jupyter");
  if (!ext) {
    throw new Error("Jupyter Extension not installed");
  }
  if (!ext.isActive) {
    await ext.activate();
  }
  return ext.exports;
}
