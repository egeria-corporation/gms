// SPDX-License-Identifier: AGPL-3.0-only
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/.turbo/**',
      '.gms/**',
      'artifacts/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/next-env.d.ts',
      'packages/db/src/types.gen.ts',
      '.netlify/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/incompatible-library': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Use <SafeHtml> (DOMPurify) from @gms/ui instead of dangerouslySetInnerHTML.',
        },
      ],
    },
  },
  {
    files: ['packages/ui/src/safe-html.tsx', 'packages/email/**', 'apps/web/app/**/json-ld.tsx', 'apps/web/lib/json-ld.tsx'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
