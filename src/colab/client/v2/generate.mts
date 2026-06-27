/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Define minimal TypeScript interfaces for type safety
interface Operation {
  responses?: {
    default?: unknown;
    [statusCode: string]: unknown;
  };
  [key: string]: unknown;
}

interface PathItem {
  get?: Operation;
  post?: Operation;
  put?: Operation;
  delete?: Operation;
  options?: Operation;
  head?: Operation;
  patch?: Operation;
  trace?: Operation;
  [key: string]: unknown;
}

interface OpenAPI3Doc {
  paths?: Record<string, PathItem>;
  [key: string]: unknown;
}

// Supported HTTP methods under OpenAPI paths
const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
];

const DIR = import.meta.dirname;
const OUT_DIR = path.join(DIR, 'generated');
const COLAB_API_JSON = path.join(DIR, 'colab-api.json');
const COLAB_API_TYPES = path.join(OUT_DIR, 'colab-schema.d.ts');
const OPERATIONS_API_JSON = path.join(DIR, 'operations-api.json');
const OPERATIONS_API_TYPES = path.join(OUT_DIR, 'operations-schema.d.ts');

function main() {
  // 1. Transform OpenAPI JSON files to fix typing issue.
  // The OpenAPI JSON documents produced by OnePlatform place successful
  // responses in `default` node instead of a 2XX status node under `paths`.
  // `openapi-fetch` infers typing info from 2XX responses, resulting in
  // undefined types. In this script, we manually copy `default` responses over
  // to `2XX` status responses before generating types.
  console.log('✏️ Fixing OpenAPI JSON documents...');
  transformOpenApi(COLAB_API_JSON);
  transformOpenApi(OPERATIONS_API_JSON);
  console.log(`✅ Done fixing OpenAPI JSON documents.`);

  // 2. Generate types with `openapi-typescript`.
  console.log('🏃 Running openapi-typescript...');
  execSync(`npx openapi-typescript ${COLAB_API_JSON} -o ${COLAB_API_TYPES}`, {
    stdio: 'inherit',
  });
  execSync(
    `npx openapi-typescript ${OPERATIONS_API_JSON} -o ${OPERATIONS_API_TYPES}`,
    {
      stdio: 'inherit',
    },
  );
  console.log(`✅ Done running openapi-typescript.`);
}

function transformOpenApi(filePath: string) {
  try {
    // 1. Read and parse the input OpenAPI JSON file
    const absoluteInputPath = path.resolve(filePath);
    console.log(`📚 Reading: ${absoluteInputPath}`);
    const fileContent = fs.readFileSync(absoluteInputPath, 'utf-8');
    const doc = JSON.parse(fileContent) as OpenAPI3Doc;

    if (!doc.paths) {
      console.warn('⚠️ No "paths" object found in the OpenAPI document.');
      return;
    }

    let replacementsCount = 0;

    // 2. Traverse paths and operations to replace 'responses.default' with
    // 'responses.2XX'
    for (const [routePath, pathItem] of Object.entries(doc.paths)) {
      for (const method of HTTP_METHODS) {
        const operation = pathItem[method] as Operation | undefined;

        if (operation?.responses) {
          const responses = operation.responses;

          if ('default' in responses) {
            // Assign default response content to 2XX
            responses['2XX'] = responses.default;

            replacementsCount++;
            console.log(
              `  Added [${method.toUpperCase()}] ${routePath}: responses.2XX`,
            );
          }
        }
      }
    }

    // 3. Output the updated OpenAPI document to a new JSON file
    const absoluteOutputPath = path.resolve(filePath);
    fs.writeFileSync(absoluteOutputPath, JSON.stringify(doc, null, 2), 'utf-8');

    console.log(`✅ Modified ${String(replacementsCount)} operation(s).`);
  } catch (error: unknown) {
    console.error('❌ An error occurred during processing:', error);
    process.exit(1);
  }
}

main();
