import { existsSync, mkdirSync, cpSync } from "fs";
import * as path from "path";
import * as esbuild from "esbuild";
import { nodeExternalsPlugin } from "esbuild-node-externals";
import { glob } from "glob";

const isProduction = process.argv.includes("--production");
const isTestBuild = process.argv.includes("--tests");
const isWatch = process.argv.includes("--watch");

mkdirSync("out/auth/media", { recursive: true });
if (isTestBuild) {
  mkdirSync("out/test/media", { recursive: true });
  cpSync("src/auth/media/favicon.ico", "out/test/media/favicon.ico");
}

function logBuildMetadata(name, outputs) {
  for (const [fileName, output] of Object.entries(outputs)) {
    if (!output.bytes) {
      continue;
    }
    const size = (output.bytes / 1024).toFixed(2);
    console.log(`📦 ${name} bundle (${fileName}) - ${size} KB`);
  }
}

function buildReporter(name) {
  return {
    name: "build-reporter",
    setup(build) {
      build.onEnd((result) => {
        if (result.errors.length > 0) {
          console.error(`❌ ${name} failed to build`);
          return;
        }

        console.log(`✅ ${name} built successfully`);

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

const baseOptions = {
  bundle: true,
  sourcemap: true,
  platform: "node",
  format: "cjs",
  minify: isProduction,
  treeShaking: true,
  external: ["vscode"], // Provided by the VS Code runtime.
  color: true,
};

const extensionOptions = {
  ...baseOptions,
  entryPoints: ["src/extension.ts"],
  outfile: "out/extension.js",
  plugins: [buildReporter("Extension")],
  metafile: !isWatch,
};

function ensureConfigExists() {
  if (existsSync("./src/colab-config.ts")) {
    return;
  }
  console.error(
    "📣 Required source configuration file not found. Run `npm run generate:config`.",
  );
  throw new Error(`Configuration file not found: ${config}`);
}

function testOptions(name, entrypointGlobPattern) {
  return {
    ...baseOptions,
    entryPoints: glob.sync(entrypointGlobPattern),
    outdir: "out/test",
    plugins: [buildReporter(name), nodeExternalsPlugin()],
  };
}

function testSetupOptions(name, entrypoint, outfile) {
  return {
    ...baseOptions,
    entryPoints: [entrypoint],
    outfile: path.join("out/test", outfile),
    bundle: false, // Don't bundle the test setup file, just transpile it.
    external: undefined, // Cannot use "external" without "bundle".
    plugins: [buildReporter(name), nodeExternalsPlugin()],
  };
}

async function main() {
  try {
    ensureConfigExists();
    cpSync("src/auth/media/favicon.ico", "out/auth/media/favicon.ico");
    const options = isTestBuild
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
    for (const opts of options) {
      if (isWatch) {
        const context = await esbuild.context(opts);
        await context.watch();
        console.log("👀 Watching for changes...");

        process.on("SIGINT", async () => {
          await context.dispose();
          console.log("\n🛑 Watch mode stopped");
          process.exit(0);
        });
      } else {
        const startTime = performance.now();
        await esbuild.build(opts);
        const endTime = performance.now();
        const duration = endTime - startTime;

        console.log(`🏃 Build completed in ${duration.toFixed(2)} ms`);
      }
    }
  } catch (error) {
    process.exit(1);
  }
}

main();
