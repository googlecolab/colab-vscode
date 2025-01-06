import * as assert from "assert";
import * as vscode from "vscode";
import { Config } from "../extension";

describe("Extension", () => {
  it("should be present", () => {
    assert.ok(vscode.extensions.getExtension("google.colab"));
  });

  it("should activate", async () => {
    await setConfig(Config.ProxyBaseUrl, "foo");
    await setConfig(Config.ProxyToken, "bar");
    const extension = vscode.extensions.getExtension("google.colab");

    await extension?.activate();

    assert.strictEqual(extension?.isActive, true);
  });
});

async function setConfig(section: string, value: string): Promise<void> {
  await vscode.workspace
    .getConfiguration("colab")
    .update(section, value, vscode.ConfigurationTarget.Global);
}
