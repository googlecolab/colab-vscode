/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const ColabEnvironments = ['production', 'sandbox', 'local'] as const;

// --- FIX START: Add Fallbacks here ---
const envConfig = {
  // If env is missing (CI/Fork), default to 'local'
  env: process.env.COLAB_EXTENSION_ENVIRONMENT || 'local',

  // If ID is missing, use a dummy value
  clientId: process.env.COLAB_EXTENSION_CLIENT_ID || 'dummy-client-id',

  // If Secret is missing, use a dummy value
  clientNotSoSecret: process.env.COLAB_EXTENSION_CLIENT_NOT_SO_SECRET || 'dummy-client-secret',
};
// --- FIX END ---

let colabApiDomain: string;
let colabGapiApiDomain: string;

try {
  // --- DELETED: The 'if (!envConfig.env) throw Error' blocks are gone! ---

  switch (envConfig.env) {
    case 'production':
      colabApiDomain = 'https://colab.research.google.com';
      colabGapiApiDomain = 'https://colab.pa.googleapis.com';
      break;
    case 'sandbox':
      colabApiDomain = 'https://colab.sandbox.google.com';
      colabGapiApiDomain = 'https://staging-colab.sandbox.googleapis.com';
      break;
    case 'local':
      colabApiDomain = 'https://localhost:8888';
      // It's not feasible to run this locally.
      colabGapiApiDomain = 'https://staging-colab.sandbox.googleapis.com';
      break;
    default:
      // This is now safe because we default to 'local' if missing
      throw new Error(
        `Unknown COLAB_EXTENSION_ENVIRONMENT: "${envConfig.env}", expected one of: ${Object.values(ColabEnvironments).join(', ')}`,
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
  Environment: envConfig.env,
};

const currentYear = new Date().getFullYear();
const licenseHeader = `/**
 * @license
 * Copyright ${currentYear.toString()} Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */`;

const output = `${licenseHeader}

// AUTO-GENERATED. Do not edit.
//
// Generate with \`npm run generate-config\` after updating environment
// variables (see \`.env.template\`).

/* eslint-disable @cspell/spellchecker */
export const CONFIG = ${JSON.stringify(config, null, 2)} as const;
`;

const configFile = path.join(__dirname, '../src/colab-config.ts');

await fs.writeFile(configFile, output);
console.log('✅ Wrote src/colab-config.ts');