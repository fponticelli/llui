import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'
import globals from 'globals'

/**
 * The LLui linting baseline.
 *
 * As of the lint→compiler migration, all framework-specific lint rules
 * (correctness, agent-protocol, conventions) emit as compile-time
 * errors via `@llui/compiler` through `@llui/vite-plugin`. The former
 * `@llui/eslint-plugin` package was deleted; this config keeps only
 * the universal TS/JS lint baseline.
 *
 * If a future need arises for editor-time squiggles on the same rules,
 * the right path is an LSP wrapper around the compiler's diagnostics
 * rather than re-deriving the same checks in eslint rule form.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.d.ts',
      '**/__fixtures__/**',
      'benchmarks/js-framework-benchmark-repo/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
)
