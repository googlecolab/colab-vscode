/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import cspellESLintPluginRecommended from '@cspell/eslint-plugin/recommended';
import eslint from '@eslint/js';
import stylisticTs from '@stylistic/eslint-plugin';
import { defineConfig } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier';
import checkFile from 'eslint-plugin-check-file';
// @ts-expect-error: No type definitions available for this plugin.
import headers from 'eslint-plugin-headers';
import importPlugin from 'eslint-plugin-import';
import jsdoc from 'eslint-plugin-jsdoc';
import tsDocPlugin from 'eslint-plugin-tsdoc';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  cspellESLintPluginRecommended,
  jsdoc.configs['flat/recommended-typescript-error'],
  {
    ignores: ['src/jupyter/client/generated'],
  },
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node, // For linting Node.js globals.
      },
    },
    plugins: {
      '@stylistic/ts': stylisticTs,
      'check-file': checkFile,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      headers,
      import: importPlugin,
      jsdoc,
      tsdoc: tsDocPlugin,
    },
    settings: {
      jsdoc: {
        mode: 'typescript',
      },
    },
    rules: {
      'import/order': [
        'error',
        {
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      '@/max-len': [
        'error',
        {
          ignoreTrailingComments: true,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
          ignoreUrls: true,
          // Generics and regex literals are often long and can be hard to
          // split.
          ignorePattern: '(<.*>)|(/.+/)',
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        { accessibility: 'no-public' },
      ],
      'tsdoc/syntax': 'warn',
      'check-file/filename-naming-convention': [
        'error',
        {
          'src/**/*.ts': 'KEBAB_CASE',
        },
        { ignoreMiddleExtensions: true },
      ],
      'jsdoc/check-indentation': 'error',
      'jsdoc/check-line-alignment': 'error',
      // Don't force destructured, e.g. `@param "foo.bar"...` when the member
      // takes in `foo`.
      'jsdoc/check-param-names': ['error', { checkDestructured: false }],
      // Disabled as it fails on our license header format which we enforce
      // separately.
      'jsdoc/check-values': 'off',
      'jsdoc/require-description': 'error',
      'jsdoc/require-param': ['error', { checkDestructured: false }],
      'jsdoc/require-throws-type': 'off',
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: {
            ArrowFunctionExpression: true,
            ClassDeclaration: true,
            ClassExpression: true,
            FunctionDeclaration: true,
            FunctionExpression: true,
            MethodDefinition: true,
          },
          contexts: [
            'PropertyDefinition[accessibility="public"]',
            'TSInterfaceDeclaration',
            'TSPropertySignature',
            'TSMethodSignature',
          ],
        },
      ],
      'jsdoc/no-blank-block-descriptions': ['error'],
      'jsdoc/tag-lines': ['error', 'any', { startLines: 1 }],
    },
  },
  {
    files: ['**/*.unit.test.ts', '**/*.vscode.test.ts', '**/*.e2e.test.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.{ts,js,mocharc.js,mjs,mts}'],
    rules: {
      'headers/header-format': [
        'error',
        {
          source: 'string',
          content: [
            '@license',
            'Copyright (year) Google LLC',
            'SPDX-License-Identifier: Apache-2.0',
          ].join('\n'),
          patterns: {
            year: {
              pattern: '202[5-6]',
              defaultValue: '2026',
            },
          },
        },
      ],
    },
  },
  // Intentionally last to override any conflicting rules.
  eslintConfigPrettier,
);
