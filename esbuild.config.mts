/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, mkdirSync, cpSync } from "fs";
import * as path from "path";
import * as esbuild from "esbuild";
import { nodeExternalsPlugin } from "esbuild-node-externals";
import { glob } from "glob";

const isProduction: boolean = process.argv.includes("--production");
const isTestBuild: boolean = process.argv.includes("--tests");
const isWatch: boolean = process.argv.includes("--watch");

// Create output directories.
mkdirSync("out/auth/media", { recursive: true });
if (isTestBuild) {
  mkdirSync("out/test/media", { recursive: true });
  cpSync("src/auth/media/favicon.ico", "out/test/media/favicon.ico");
}

/**
 * Logs metadata about the built output files (e.g., size).
 * @param name - The name of the build process (e.g., "Extension", "Unit
 * Tests").
 * @param outputs - An object containing information about the build outputs.
 */
function logBuildMetadata(
  name: string,
  outputs: esbuild.Metafile["outputs"],
): void {
  for (const [fileName, output] of Object.entries(outputs)) {
    if (!output.bytes) {
      continue;
    }
    const size = (output.bytes / 1024).toFixed(2);
    console.log(`📦 ${name} bundle (${fileName}) - ${size} KB`);
  }
}

/**
 * Creates an esbuild plugin to report build success/failure and metadata.
 * @param name - The name of the build process for logging.
 * @returns An esbuild plugin object.
 */
function buildReporter(name: string): esbuild.Plugin {
  return {
    name: "build-reporter",
    setup(build: esbuild.PluginBuild) {
      build.onEnd((result: esbuild.BuildResult) => {
        if (result.errors.length > 0) {
          console.error(`❌ ${name} failed to build`);
          return;
        }

        console.log(`✅ ${name} built successfully`);

        // Log metadata only if not in watch mode and metafile is available.
        if (!isWatch && result.metafile) {
          const { outputs } = result.metafile;
          logBuildMetadata(name, outputs);
        }

        const buildTime = new Date().toLocaleTimeString();
        console.log(`🕒 ${name} built at: ${buildTime}`);
      });
    },
  };
}

// Base esbuild options common to all builds.
const baseOptions: esbuild.BuildOptions = {
  bundle: true,
  sourcemap: true,
  platform: "node",
  format: "cjs", // CommonJS format, requires for VS Code extensions.
  minify: isProduction,
  treeShaking: true,
  external: ["vscode"], // 'vscode' is provided by the VS Code runtime.
  color: true,
};

// Options specific to the main extension build
const extensionOptions: esbuild.BuildOptions = {
  ...baseOptions,
  entryPoints: ["src/extension.ts"],
  outfile: "out/extension.js",
  plugins: [buildReporter("Extension")],
  metafile: !isWatch,
};

/**
 * Ensures the `src/colab-config.ts` file exists before building.
 * Throws an error if the file is not found.
 */
function ensureConfigExists(): void {
  if (existsSync("./src/colab-config.ts")) {
    return;
  }
  console.error(
    "📣 Required source configuration file not found. Run `npm run generate:config`.",
  );
  throw new Error("Configuration file not found: src/colab-config.ts");
}

/**
 * Generates esbuild options for test bundles.
 * @param name - The name of the test suite (e.g., "Unit Tests").
 * @param entrypointGlobPattern - A glob pattern for the entry point files.
 * @returns Esbuild build options for the test suite.
 */
function testOptions(
  name: string,
  entrypointGlobPattern: string | string[],
): esbuild.BuildOptions {
  return {
    ...baseOptions,
    entryPoints: Array.isArray(entrypointGlobPattern)
      ? entrypointGlobPattern
      : glob.sync(entrypointGlobPattern),
    outdir: "out/test",
    plugins: [buildReporter(name), nodeExternalsPlugin()],
  };
}

/**
 * Generates esbuild options for test setup files (not bundled).
 * @param name - The name of the test setup file.
 * @param entrypoint - The path to the entry point file.
 * @param outfile - The output file name relative to `out/test`.
 * @returns Esbuild build options for the test setup file.
 */
function testSetupOptions(
  name: string,
  entrypoint: string,
  outfile: string,
): esbuild.BuildOptions {
  return {
    ...baseOptions,
    entryPoints: [entrypoint],
    outfile: path.join("out/test", outfile),
    bundle: false, // Do not bundle, just transpile for test setup files.
    external: undefined, // 'external' cannot be used when 'bundle' is false.
    plugins: [buildReporter(name), nodeExternalsPlugin()],
  };
}

/**
 * Main function to orchestrate the esbuild process.
 * Handles build options, watch mode, and error handling.
 */
async function main(): Promise<void> {
  try {
    ensureConfigExists();
    // Copy favicon for both main and test builds
    cpSync("src/auth/media/favicon.ico", "out/auth/media/favicon.ico");
    if (isTestBuild) {
      cpSync("src/auth/media/favicon.ico", "out/test/media/favicon.ico");
    }

    // Determine which build options to use based on 'isTestBuild' flag
    const options: esbuild.BuildOptions[] = isTestBuild
      ? [
          testSetupOptions(
            "Unit Test Setup",
            "src/test/unit-test-setup.ts",
            "test/unit-test-setup.js",
          ),
          testSetupOptions(
            "Integration Test Setup",
            "src/test/integration-test-runner.ts",
            "test/integration-test-runner.js",
          ),
          testOptions("Unit Tests", "src/**/*.unit.test.ts"),
          testOptions("Integration Tests", [
            "src/**/*.vscode.test.ts",
            "src/test/suite/**/*.ts",
          ]),
          testOptions("E2E Tests", [
            "src/test/*.e2e.test.ts",
            "src/test/e2e.mocharc.js",
          ]),
        ]
      : [extensionOptions];

    // Execute builds
    for (const opts of options) {
      if (isWatch) {
        // Start watch mode
        const context = await esbuild.context(opts);
        await context.watch();
        console.log("👀 Watching for changes...");

        // Handle process exit gracefully in watch mode
        process.on("SIGINT", () => {
          void context.dispose();
          console.log("\n🛑 Watch mode stopped");
          process.exit(0);
        });
      } else {
        // Perform a single build
        const startTime = performance.now();
        await esbuild.build(opts);
        const endTime = performance.now();
        const duration = endTime - startTime;

        console.log(`🏃 Build completed in ${duration.toFixed(2)} ms`);
      }
    }
  } catch (error) {
    // Log any errors and exit with a non-zero code
    console.error("🚨 Build process encountered an error:", error);
    process.exit(1);
  }
}

await main();
