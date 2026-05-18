/**
 * `track()` — explicit reactivity declaration for paths the compiler
 * cannot statically infer.
 *
 * ```ts
 * track({ deps: (s) => [s.pluginRegistry, s.activePluginName] })
 * ```
 *
 * At compile time `@llui/compiler` reads the `deps` accessor, folds its
 * paths into the host component's `__prefixes` table, and **strips the
 * entire call expression from the emitted output** (and removes the
 * `track` import). A `track()` call in source produces zero bytes in the
 * bundle and zero work at runtime.
 *
 * The runtime export below is the FULL_MASK fallback. If a
 * `ComponentDef` somehow bypasses the compiler (hand-rolled, build that
 * skipped the plugin), `track()` throws `LluiCompilerSkippedError` on
 * first evaluation — pointing at the specific call site the user needs
 * to either compile or remove. This is the alternative to silently
 * degrading to FULL_MASK; explicit failure beats silent slowness.
 *
 * Use `track()` only when:
 *   - Plugin registries: `pluginRegistry[name].render(h, send)` where
 *     `name` is state.
 *   - Helpers returned by `useContext` chains where the provider lives
 *     two-plus files away.
 *   - Helpers stored in arrays and dispatched by index.
 *
 * For statically-typed view helpers in other files, the cross-file
 * walker (v2b) resolves their reads directly — `track()` is unnecessary
 * and the `llui/prefer-static-deps` lint rule will flag it. A clean
 * codebase has zero `track()` calls.
 *
 * See `docs/proposals/v2-compiler/v2b.md` §3.
 */

export class LluiCompilerSkippedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LluiCompilerSkippedError'
  }
}

export interface TrackOptions<S> {
  /**
   * Declare the paths this component depends on. Called at most once at
   * compile time; the compiler folds the returned paths into
   * `__prefixes`. The runtime stub never invokes this function — if you
   * see it running, the compiler skipped the file.
   */
  deps: (s: S) => unknown[]
}

/**
 * Runtime stub. Throws on call to make it explicit when the compiler
 * has been skipped — the alternative (silent FULL_MASK degradation) is
 * a §0.5 wrong-by-default outcome.
 */
export function track<S>(_opts: TrackOptions<S>): void {
  throw new LluiCompilerSkippedError(
    '[llui] track() was reached at runtime — this means the @llui/compiler ' +
      'transform did not run against this file. Compiled track() calls are ' +
      'erased from the bundle. Check that vite.config.ts registers the LLui ' +
      'plugin and that the file extension is .ts / .tsx. See ' +
      'docs/proposals/v2-compiler/v2b.md §3.',
  )
}
