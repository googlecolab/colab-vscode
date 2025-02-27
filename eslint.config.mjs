import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import stylisticTs from "@stylistic/eslint-plugin-ts";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import cspellESLintPluginRecommended from "@cspell/eslint-plugin/recommended";

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  cspellESLintPluginRecommended,
  {
    ignores: ["eslint.config.mjs"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@stylistic/ts": stylisticTs,
      import: importPlugin,
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
          ignorePattern: "<.*>",
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { varsIgnorePattern: "^_$", argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-member-accessibility": [
        "error",
        { accessibility: "no-public" },
      ],
    },
  },
  {
    files: ["**/*.unit.test.ts"],
    rules: {
      "@typescript-eslint/unbound-method": "off",
    },
  },
  // Intentionally last to override any conflicting rules.
  eslintConfigPrettier,
);
