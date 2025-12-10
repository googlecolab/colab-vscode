/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { parse, stringify } from 'yaml';

const DIR = import.meta.dirname;
const API_YAML = path.join(DIR, 'api.yaml');
const POST_PROCESSED_YAML = path.join(DIR, 'post-processed-api.yaml');
const OUT_DIR = path.join(DIR, 'generated');

type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  [key: string]: unknown; // Allow other properties
}

type OpenAPIPathItem = Partial<Record<HttpMethod, OpenApiOperation>> &
  Record<string, unknown>;

interface OpenAPIDocument {
  openapi: string;
  paths: Record<string, OpenAPIPathItem>;
  [key: string]: unknown;
}

interface OpDef {
  id: string; // Unique operationId for the spec (e.g. "Kernels_list")
  name: string; // Desired method name in code (e.g. "list")
}

// Path -> Method -> { id, name }
const OPERATION_MAP: Record<string, Partial<Record<HttpMethod, OpDef>>> = {
  '/api/contents/{path}': {
    get: { id: 'Contents_get', name: 'get' },
    post: { id: 'Contents_create', name: 'create' },
    patch: { id: 'Contents_rename', name: 'rename' },
    put: { id: 'Contents_save', name: 'save' },
    delete: { id: 'Contents_delete', name: 'delete' },
  },
  '/api/contents/{path}/checkpoints': {
    get: { id: 'Contents_listCheckpoints', name: 'listCheckpoints' },
    post: { id: 'Contents_createCheckpoint', name: 'createCheckpoint' },
  },
  '/api/contents/{path}/checkpoints/{checkpoint_id}': {
    post: { id: 'Contents_restoreCheckpoint', name: 'restoreCheckpoint' },
    delete: { id: 'Contents_deleteCheckpoint', name: 'deleteCheckpoint' },
  },
  '/api/sessions/{session}': {
    get: { id: 'Sessions_get', name: 'get' },
    patch: { id: 'Sessions_update', name: 'update' },
    delete: { id: 'Sessions_delete', name: 'delete' },
  },
  '/api/sessions': {
    get: { id: 'Sessions_list', name: 'list' },
    post: { id: 'Sessions_create', name: 'create' },
  },
  '/api/kernels': {
    get: { id: 'Kernels_list', name: 'list' },
    post: { id: 'Kernels_start', name: 'start' },
  },
  '/api/kernels/{kernel_id}': {
    get: { id: 'Kernels_get', name: 'get' },
    delete: { id: 'Kernels_kill', name: 'kill' },
  },
  '/api/kernels/{kernel_id}/interrupt': {
    post: { id: 'Kernels_interrupt', name: 'interrupt' },
  },
  '/api/kernels/{kernel_id}/restart': {
    post: { id: 'Kernels_restart', name: 'restart' },
  },
  '/api/kernelspecs': {
    get: { id: 'Kernelspecs_list', name: 'list' },
  },
  '/api/config/{section_name}': {
    get: { id: 'Config_get', name: 'get' },
    patch: { id: 'Config_update', name: 'update' },
  },
  '/api/terminals': {
    get: { id: 'Terminals_list', name: 'list' },
    post: { id: 'Terminals_create', name: 'create' },
  },
  '/api/terminals/{terminal_id}': {
    get: { id: 'Terminals_get', name: 'get' },
    delete: { id: 'Terminals_delete', name: 'delete' },
  },
  '/api/me': {
    get: { id: 'Identity_get', name: 'get' },
  },
  '/api/status': {
    get: { id: 'Status_get', name: 'get' },
  },
  '/api/spec.yaml': {
    get: { id: 'ApiSpec_get', name: 'getSpec' },
  },
  '/api/': {
    get: { id: 'Default_getVersion', name: 'getVersion' },
  },
};

function main(): void {
  console.log('📚 Reading api.yaml...');
  const spec = readApiSpec();

  console.log('✏️ Injecting unique operationIds...');
  const { nameReplacements, injectedCount } = injectOperationIds(spec);
  console.log(`✅ Injected ${injectedCount.toString()} operationIds.`);

  fs.writeFileSync(POST_PROCESSED_YAML, stringify(spec));

  console.log('🏃 Running openapi-generator-cli...');
  execSync(
    `npx openapi-generator-cli generate \
        -i "${POST_PROCESSED_YAML}" \
        -g typescript-fetch \
        -o "${OUT_DIR}" \
        --additional-properties=typescriptThreePlus=true,supportsES6=true,withInterfaces=true`,
    { stdio: 'inherit' },
  );

  console.log('✏️ Post-processing generated files...');
  postProcessGeneratedFiles(nameReplacements);

  console.log('✅ Done generating client!');
}

function readApiSpec(): OpenAPIDocument {
  const raw = fs.readFileSync(API_YAML, 'utf8');

  const spec = parse(raw) as unknown;
  if (!isOpenAPIDocument(spec)) {
    throw new Error(
      "Parsed YAML is not a valid OpenAPI document (missing 'paths').",
    );
  }
  return spec;
}

function injectOperationIds(spec: OpenAPIDocument): {
  nameReplacements: Map<string, string>;
  injectedCount: number;
} {
  let injectedCount = 0;

  const nameReplacements = new Map<string, string>();
  for (const [route, methods] of Object.entries(OPERATION_MAP)) {
    const pathItem = spec.paths[route];
    for (const [methodKey, def] of Object.entries(methods)) {
      const method = methodKey as HttpMethod;
      const operation = pathItem[method];
      if (!operation) {
        console.warn(
          `Warning: Method ${method} for ${route} not found in spec.`,
        );
        continue;
      }
      operation.operationId = def.id;
      const generatedName = toCamelCase(def.id);
      nameReplacements.set(generatedName, def.name);
      injectedCount++;
    }
  }
  return { nameReplacements, injectedCount };
}

function postProcessGeneratedFiles(
  nameReplacements: Map<string, string>,
): void {
  const files = findTsFiles(OUT_DIR);

  for (const file of files) {
    let content = fs.readFileSync(file, 'utf8');

    // Add @ts-nocheck if missing
    if (!content.startsWith('// @ts-nocheck')) {
      content = '// @ts-nocheck\n' + content;
    }

    // Rename methods
    for (const [genName, desiredName] of nameReplacements) {
      const regex = new RegExp(`(async )?${genName}\\(`, 'g');
      content = content.replace(regex, `$1${desiredName}(`);
      const regexRaw = new RegExp(`(async )?${genName}Raw\\(`, 'g');
      content = content.replace(regexRaw, `$1${desiredName}Raw(`);
    }

    fs.writeFileSync(file, content);
  }
}

/**
 * Type Guard to ensure the parsed YAML has the basic structure needed for our
 * post-processing.
 */
function isOpenAPIDocument(doc: unknown): doc is OpenAPIDocument {
  return (
    typeof doc === 'object' &&
    doc !== null &&
    'paths' in doc &&
    typeof (doc as OpenAPIDocument).paths === 'object'
  );
}

function toCamelCase(str: string): string {
  // "Kernels_list" -> "kernelsList"
  return str
    .replace(/_([a-z])/g, (_: string, letter: string) => letter.toUpperCase())
    .replace(/^[A-Z]/, (letter: string) => letter.toLowerCase());
}

function findTsFiles(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return [];

  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      results = results.concat(findTsFiles(filePath));
    } else if (file.endsWith('.ts')) {
      results.push(filePath);
    }
  }
  return results;
}

main();
