import checkFile from "eslint-plugin-check-file";
import cspellESLintPluginRecommended from "@cspell/eslint-plugin/recommended";
import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";
import licenseHeader from "eslint-plugin-license-header";
import stylisticTs from "@stylistic/eslint-plugin";
import tsDocPlugin from "eslint-plugin-tsdoc";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["eslint.config.mjs", "**/*.mocharc.js"] },
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  cspellESLintPluginRecommended,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@stylistic/ts": stylisticTs,
      "check-file": checkFile,
      "license-header": licenseHeader,
      import: importPlugin,
      tsdoc: tsDocPlugin,
    },
    rules: {
      "import/order": [
        "error",
        {
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "@/max-len": [
        "error",
        {
          ignoreTrailingComments: true,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
          ignoreUrls: true,
          // Generics and regex literals are often long and can be hard to split.
          ignorePattern: "(<.*>)|(\/.+\/)",
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "all",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/explicit-member-accessibility": [
        "error",
        { accessibility: "no-public" },
      ],
      "tsdoc/syntax": "warn",
      "check-file/filename-naming-convention": [
        "error",
        {
          "src/**/*.ts": "KEBAB_CASE",
        },
        { ignoreMiddleExtensions: true },
      ],
    },
  },
  {
    files: ["**/*.unit.test.ts"],
    rules: {
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...global.Node,
      },
    },
  },
  {
    files: ["**/*.{ts,js,mjs,mts}"],
    rules: {
      "license-header/header": [
        "error",
        [
          "/**",
          " * @license",
          " * Copyright " + new Date().getFullYear() + " Google LLC",
          " * SPDX-License-Identifier: Apache-2.0",
          " */",
        ],
      ],
    },
  },
  // Intentionally last to override any conflicting rules.
  eslintConfigPrettier,
);
