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
     * All agent-* rules run at `error`. LLMs (Claude, IDE agents, CI
     * bots) only act on errors — warnings get reported and ignored, so
     * anything we ship as `warn` effectively never improves. Errors are
     * the only severity that drives self-healing behaviour.
     */
    rules: {
      'llui/agent-missing-intent': 'error',
      'llui/agent-exclusive-annotations': 'error',
      'llui/agent-nonextractable-handler': 'error',
      'llui/agent-msg-resolvable': 'error',
      'llui/agent-warning-on-confirm': 'error',
      'llui/agent-example-on-payload': 'error',
      'llui/agent-emits-drift': 'error',
      'llui/agent-optional-field-undocumented': 'error',
    },
  },
  // ── Compiler-pattern overlay ─────────────────────────────────────
  // Rules ported from `@llui/vite-plugin`'s compile-time diagnostics.
  // Apply anywhere LLui's element helpers / `component()` are used —
  // app code, headless component packages, the docs site, the bench
  // app. Excluded from framework internals (`packages/dom`,
  // `packages/vite-plugin`, …) where the surface is intentionally
  // primitive.
  //
  // All rules run at `error`. LLMs and IDE agents only fix what they
  // see as an error — warnings accumulate and never get cleaned up.
  // Even nudges like `empty-props` are worth gating, because the cost
  // of a quick fix is much smaller than the cost of letting them pile up.
  //
  // Note: `bitmask-overflow` moved to `@llui/compiler` as a compile-time
  // error (migration step 1 of the ESLint-plugin-deprecation plan).
  {
    files: [
      'examples/**/*.ts',
      'examples/**/*.tsx',
      'packages/agent/src/**/*.ts',
      'packages/agent-e2e/src/**/*.ts',
      'packages/components/src/**/*.ts',
      'benchmarks/js-framework-benchmark/src/**/*.ts',
      'site/src/**/*.ts',
      'site/pages/**/*.ts',
    ],
    plugins: {
      llui: lluiPlugin,
    },
    rules: {
      'llui/empty-props': 'error',
      'llui/namespace-import': 'error',
      'llui/accessibility': 'error',
      'llui/controlled-input': 'error',
      'llui/static-on': 'error',
    },
  },
)
