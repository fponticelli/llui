import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'
import globals from 'globals'
import lluiPlugin from '@llui/eslint-plugin'

/**
 * The LLui linting baseline. Three layers:
 *   1. ESLint + typescript-eslint defaults — universal correctness
 *      checks that apply to any TS code.
 *   2. The `@llui/eslint-plugin` agent-* rules, scoped to packages
 *      and examples that author Msg unions / view functions / agent
 *      annotations. The plugin's own internals are linted by the
 *      defaults; running the framework-specific rules against the
 *      framework's own AST-walking code would generate noise.
 *   3. The two new annotation-completeness rules (`agent-warning-on-confirm`,
 *      `agent-example-on-payload`, `agent-emits-drift`) ship as `warn`
 *      so CI doesn't fail on annotation drift; gates can be promoted
 *      to `error` per-package as the codebase catches up.
 *
 * Packages where the agent-* rules apply:
 *   - examples/* — full LLui apps with Msg unions and views.
 *   - packages/agent-e2e — the e2e harness app.
 *   - benchmarks/js-framework-benchmark — counter app for the bench.
 *
 * Packages excluded from the agent-* rules:
 *   - packages/eslint-plugin-llui itself — the rules apply to apps,
 *     not to the rule implementations.
 *   - packages/{dom,vite-plugin,agent,components,test,…} — framework
 *     internals; their TS sources don't define user-app Msg unions.
 *   - test/ subtrees — fixtures often use minimal annotations on
 *     purpose to exercise specific rule behaviour.
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
  // ── Agent-rule overlay for full LLui apps ───────────────────────
  // Apps author Msg unions, view functions, and reducer cases, so
  // they benefit from the agent-* annotation discipline. The plugin's
  // own source / framework internals don't, so we apply this overlay
  // narrowly via a glob.
  {
    files: [
      'examples/**/*.ts',
      'examples/**/*.tsx',
      'packages/agent-e2e/src/**/*.ts',
      'benchmarks/js-framework-benchmark/src/**/*.ts',
    ],
    plugins: {
      llui: lluiPlugin,
    },
    /**
     * All agent-* rules ship as `warn` initially because the example
     * apps + agent-e2e harness predate the rules and have annotation
     * gaps that need real app-domain knowledge to fix (an `@intent`
     * has to describe what the action *does*, not just acknowledge
     * the rule). Surfacing them as warnings makes CI green while
     * keeping the gaps visible for incremental cleanup.
     *
     * Per-package promotion path: apps that have closed all their
     * gaps can override these to `error` in their own `eslint.config`
     * (or via `// eslint-disable` comments for any documented
     * exceptions). The plugin's `recommended` preset still runs at
     * `error` for projects that import it directly.
     */
    rules: {
      'llui/agent-missing-intent': 'warn',
      'llui/agent-exclusive-annotations': 'warn',
      'llui/agent-nonextractable-handler': 'warn',
      'llui/agent-msg-resolvable': 'warn',
      'llui/agent-warning-on-confirm': 'warn',
      'llui/agent-example-on-payload': 'warn',
      'llui/agent-emits-drift': 'warn',
    },
  },
)
