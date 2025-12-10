/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import cspellESLintPluginRecommended from '@cspell/eslint-plugin/recommended';
import eslint from '@eslint/js';
import stylisticTs from '@stylistic/eslint-plugin';
import eslintConfigPrettier from 'eslint-config-prettier';
import checkFile from 'eslint-plugin-check-file';
import importPlugin from 'eslint-plugin-import';
// @ts-expect-error: No type definitions available for this plugin.
import licenseHeader from 'eslint-plugin-license-header';
import tsDocPlugin from 'eslint-plugin-tsdoc';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  cspellESLintPluginRecommended,
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
      'license-header': licenseHeader,
      import: importPlugin,
      tsdoc: tsDocPlugin,
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
    },
  },
  {
    files: ['**/*.unit.test.ts'],
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
      'license-header/header': [
        'error',
        [
          '/**',
          ' * @license',
          ' * Copyright ' + new Date().getFullYear().toString() + ' Google LLC',
          ' * SPDX-License-Identifier: Apache-2.0',
          ' */',
        ],
      ],
    },
  },
  // Intentionally last to override any conflicting rules.
  eslintConfigPrettier,
);
