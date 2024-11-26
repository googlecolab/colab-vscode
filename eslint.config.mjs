import eslint from '@eslint/js';
import * as importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    eslint.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    {
        ignores: [
            'eslint.config.mjs',
        ],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            import: importPlugin,
        },
        rules: {
            'import/order': [
                'error', {
                    'alphabetize': { 'order': 'asc', 'caseInsensitive': true }
                },
            ],
            '@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
        },
    },
);