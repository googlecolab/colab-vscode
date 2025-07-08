import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const ColabEnvironments = ["production", "sandbox", "local"] as const;

const envConfig = {
  env: process.env.COLAB_EXTENSION_ENVIRONMENT,
  clientId: process.env.COLAB_EXTENSION_CLIENT_ID,
  clientNotSoSecret: process.env.COLAB_EXTENSION_CLIENT_NOT_SO_SECRET,
};

let colabApiDomain: string;
let colabGapiApiDomain: string;
try {
  if (!envConfig.env) {
    throw new Error("COLAB_EXTENSION_ENVIRONMENT is not set");
  }
  if (!envConfig.clientId) {
    throw new Error("COLAB_EXTENSION_CLIENT_ID is not set");
  }
  if (!envConfig.clientNotSoSecret) {
    throw new Error("COLAB_EXTENSION_CLIENT_NOT_SO_SECRET is not set");
  }
  switch (envConfig.env) {
    case "production":
      colabApiDomain = "https://colab.research.google.com";
      colabGapiApiDomain = "https://colab.pa.googleapis.com";
      break;
    case "sandbox":
      colabApiDomain = "https://colab.sandbox.google.com";
      colabGapiApiDomain = "https://staging-colab.sandbox.googleapis.com";
      break;
    case "local":
      colabApiDomain = "https://localhost:8888";
      // It's not feasible to run this locally.
      colabGapiApiDomain = "https://staging-colab.sandbox.googleapis.com";
      break;
    default:
      throw new Error(
        `Unknown COLAB_EXTENSION_ENVIRONMENT: "${envConfig.env}", expected one of: ${Object.values(ColabEnvironments).join(", ")}`,
      );
  }
} catch (err: unknown) {
  console.error(err);
  process.exit(1);
}

const config = {
  ColabApiDomain: colabApiDomain,
  ColabGapiDomain: colabGapiApiDomain,
  ClientId: envConfig.clientId,
  ClientNotSoSecret: envConfig.clientNotSoSecret,
};

const output = `// AUTO-GENERATED. Do not edit.
//
// Generate with \`npm run generate-config\` after updating environment
// variables (see \`.env.template\`).

/* eslint-disable @cspell/spellchecker */
export const CONFIG = ${JSON.stringify(config, null, 2)} as const;
`;

const configFile = path.join(__dirname, "../src/colab-config.ts");

await fs.writeFile(configFile, output);
console.log("✅ Wrote src/colab-config.ts");
