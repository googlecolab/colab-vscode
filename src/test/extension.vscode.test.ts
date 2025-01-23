import * as assert from "assert";
import vscode from "vscode";

describe("Extension", () => {
  it("should be present", () => {
    assert.ok(vscode.extensions.getExtension("google.colab"));
  });

  it("should activate", async () => {
    const extension = vscode.extensions.getExtension("google.colab");

    await extension?.activate();

    assert.strictEqual(extension?.isActive, true);
  });
});
