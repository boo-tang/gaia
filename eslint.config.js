import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import importPlugin from 'eslint-plugin-import';
import noOnlyTests from 'eslint-plugin-no-only-tests';
import reactPlugin from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import { globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import noNonPrimitiveInCollections from './eslint-rules/no-non-primitive-in-collections.js';

// Only the workspace packages are linted. The root Hardhat tests and scripts are not.
const PACKAGE_FILES = ['packages/*/{src,test,scripts}/**/*.{ts,tsx}', 'packages/*/*.ts'];
// The browser code of the web app. Its Vite config and plugin run in Node.
const WEB_FILES = ['packages/web/{src,test}/**/*.{ts,tsx}'];

const NO_DIST_IMPORTS = {
  group: ['dist'],
  message: 'You should not be importing from a build directory. Did you accidentally do a relative import?',
};

export default [
  globalIgnores(['**/node_modules/**', '**/dist/**', '*.js', 'packages/core/src/abis/**']),
  ...tseslint.config({
    files: PACKAGE_FILES,
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      importPlugin.flatConfigs.recommended,
      importPlugin.flatConfigs.typescript,
      eslintConfigPrettier,
    ],
    settings: {
      'import/resolver': {
        typescript: true,
        node: true,
      },
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
      ecmaVersion: 2025,
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      'no-only-tests': noOnlyTests,
      'gaia-custom': {
        rules: {
          'no-non-primitive-in-collections': noNonPrimitiveInCollections,
        },
      },
    },
    rules: {
      // Disabled rules
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-constant-condition': 'off',
      // Warnings
      'import/no-cycle': 'warn',
      // Errors
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'require-await': 'error',
      curly: ['error', 'all'],
      camelcase: 'error',
      'import/no-relative-packages': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [NO_DIST_IMPORTS],
        },
      ],
      'import/no-unresolved': 'error',
      'import/no-extraneous-dependencies': 'error',
      // this unfortunately doesn't block `fit` and `fdescribe`
      'no-only-tests/no-only-tests': ['error'],
      'gaia-custom/no-non-primitive-in-collections': 'error',
    },
  }),
  {
    files: WEB_FILES,
    ...reactPlugin.configs.flat.recommended,
    ...reactPlugin.configs.flat['jsx-runtime'],
    ...reactHooks.configs.flat.recommended,
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
    },
    settings: {
      react: { version: 'detect' },
      // The Vite plugin in packages/web/deployment-plugin.ts makes this module.
      'import/core-modules': ['virtual:gaia-deployment'],
    },
    languageOptions: {
      ...reactPlugin.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      ...reactPlugin.configs.flat.recommended.rules,
      ...reactPlugin.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.flat.recommended.rules,
      // TypeScript checks the props.
      'react/prop-types': 'off',
      // Only src/wallet/ knows the wallet kit. The rest of the app uses wagmi hooks.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            NO_DIST_IMPORTS,
            {
              group: ['@rainbow-me/rainbowkit', '@rainbow-me/rainbowkit/*'],
              message: 'Use wagmi hooks. Only packages/web/src/wallet/ uses the wallet kit.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/web/src/wallet/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [NO_DIST_IMPORTS] }],
    },
  },
];
