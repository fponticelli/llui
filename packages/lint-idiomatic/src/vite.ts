import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'
import { lintIdiomatic, type LintResult } from './index.js'

export interface LintIdiomaticPluginOptions {
  /**
   * Rule names to skip. By default, rules that overlap with
   * `@llui/vite-plugin`'s built-in `diagnose()` pass are excluded to
   * avoid duplicate warnings when both plugins run together.
   */
  exclude?: readonly string[]

  /**
   * Glob patterns to skip. Files matching any pattern are not linted.
   * Defaults to `['**\/node_modules/**', '**\/dist/**']`.
   */
  skip?: readonly RegExp[]

  /**
   * Run in dev mode only (default `false` — runs in both dev and build).
   * Set to `true` if lint warnings slow your build pipeline.
   */
  devOnly?: boolean

  /**
   * Fail the build on any violation. Default `true` — violations are
   * emitted as errors.
   */
  failOnError?: boolean

  /**
   * Called after each linted file with its result. Useful for counting
   * violations across the whole build (e.g. a summary reporter).
   */
  onLint?: (filename: string, result: LintResult) => void
}

/**
 * Rules that are already emitted by `@llui/vite-plugin`'s `diagnose()`.
 * Excluded by default so users running both plugins don't see the same
 * warning twice. Override with an explicit `exclude: []` to re-enable.
 */
const DEFAULT_EXCLUDES: readonly string[] = ['map-on-state-array']

const DEFAULT_SKIP: readonly RegExp[] = [/\/node_modules\//, /\/dist\//]

/**
 * Vite plugin that runs `@llui/lint-idiomatic` on every `.ts`/`.tsx`
 * file and emits violations as Vite warnings. Warnings show up in the
 * dev server overlay and CI output via Vite's `this.warn()`.
 *
 * Usage:
 *
 * ```ts
 * import llui from '@llui/vite-plugin'
 * import lintIdiomatic from '@llui/lint-idiomatic/vite'
 *
 * export default {
 *   plugins: [llui(), lintIdiomatic()],
 * }
 * ```
 *
 * Composes naturally with `@llui/vite-plugin` — runs in the `transform`
 * hook with no ordering requirement. The default `exclude` list skips
 * rules that vite-plugin already emits.
 */
export default function lintIdiomaticPlugin(options: LintIdiomaticPluginOptions = {}): Plugin {
  const exclude = options.exclude ?? DEFAULT_EXCLUDES
  const skip = options.skip ?? DEFAULT_SKIP
  const failOnError = options.failOnError ?? true
  const devOnly = options.devOnly ?? false
  const onLint = options.onLint

  let isDev = false

  return {
    name: 'llui-lint-idiomatic',
    // Run before other transforms in the same file so if another plugin
    // depends on lint diagnostics they've seen them. The ordering matters
    // only cosmetically — we always re-read the file from disk below, so
    // whatever `code` the pipeline hands us is ignored.
    enforce: 'pre',

    configResolved(config) {
      isDev = config.command === 'serve' || config.mode === 'development'
    },

    transform(_code, id) {
      if (devOnly && !isDev) return
      if (!id.endsWith('.ts') && !id.endsWith('.tsx')) return
      if (skip.some((re) => re.test(id))) return

      // Always lint the original on-disk source, not the current
      // pipeline state. Another vite plugin (notably @llui/vite-plugin)
      // rewrites component bodies before we'd get a chance to see
      // them, and compiler-generated code contains patterns — `++` in
      // row updaters, state-paren calls after prop-split — that
      // trigger false positives against user-facing rules like
      // `state-mutation`. Reading from disk guarantees we only ever
      // see what the author wrote.
      //
      // Strip any query suffix vite may have added (e.g. `?t=123` for
      // cache-busting) before passing the path to readFileSync.
      const cleanPath = id.split('?', 1)[0]!
      let source: string
      try {
        source = readFileSync(cleanPath, 'utf-8')
      } catch {
        // Virtual modules, not-yet-written files, anything without a
        // readable on-disk path — skip silently. These aren't user
        // source and aren't meaningful targets for idiomatic lint.
        return
      }

      const result = lintIdiomatic(source, id, { exclude })
      if (onLint) onLint(id, result)
      if (result.violations.length === 0) return

      for (const v of result.violations) {
        const hint = v.suggestion ? ` Suggestion: ${v.suggestion}` : ''
        const message = `[${v.rule}] ${v.message}${hint}`
        if (failOnError) {
          this.error(message, { line: v.line, column: v.column })
        } else {
          this.warn(message, { line: v.line, column: v.column })
        }
      }
    },
  }
}

// Named export for callers that want to import { lintIdiomaticPlugin }
export { lintIdiomaticPlugin }

// Re-export the pure function + types so users only need one import
export { lintIdiomatic, RULE_NAMES } from './index.js'
export type { LintResult, LintViolation, LintOptions, RuleName } from './index.js'
