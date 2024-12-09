import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import {
  downloadAndUnzipVSCode,
  resolveCliPathFromVSCodeExecutablePath,
  runTests,
} from "@vscode/test-electron";

function getExtensionsDir(vscodeExecutablePath: string): string {
  const extDirPath = path.resolve(vscodeExecutablePath, "../", "extensions");
  if (!fs.existsSync(extDirPath)) {
    fs.mkdirSync(extDirPath);
  }
  return extDirPath;
}

function installExtension(
  cliPath: string,
  extensionsDir: string,
  extension: string,
) {
  console.info("Installing Jupyter Extension");
  spawnSync(
    cliPath,
    [
      "--install-extension",
      extension,
      "--extensions-dir",
      extensionsDir,
      "--disable-telemetry",
    ],
    {
      encoding: "utf-8",
      stdio: "inherit",
    },
  );
}

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");

    const extensionTestsPath = path.resolve(__dirname, "./suite/index");
    const vscodeExecutablePath = await downloadAndUnzipVSCode("insiders");
    const cliPath =
      resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath);
    const extensionsDir = getExtensionsDir(vscodeExecutablePath);

    installExtension(cliPath, extensionsDir, "ms-toolsai.jupyter");

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: ["--extensions-dir", extensionsDir]
        .concat(["--skip-welcome"])
        .concat(["--skip-release-notes"]),
      version: "insiders",
    });
  } catch (err) {
    console.error("Failed to run tests", err);
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error("Unhandled error in main function", error);
  process.exit(1);
});
