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
 * `track()` only helps when the `deps` body itself reads paths the
 * walker CAN extract — `(s) => [s.pluginRegistry, s.activePluginName]`,
 * concrete property-access chains. If the deps body is itself opaque
 * (e.g. `(s) => [getError(s)]` where `getError` is a callback
 * parameter), the walker can't pull paths out of it and `track()`
 * collapses to the same FULL_MASK + sentinel behavior that would
 * happen without it — the call is still erased from emission, but it
 * does no useful narrowing. In that case the underlying composition
 * pattern is the real problem: helpers that take `(s) => …` callbacks
 * should be restructured to receive their reactive values via primitives
 * (`text((s) => …)`) at the call site or via the `each` items-bag, not
 * through closure parameters. The `llui/opaque-state-flow` rule
 * suppresses its diagnostic inside `track.deps` to make the escape
 * hatch usable, but the suppression does NOT mean the perf trade-off
 * went away.
 *
 * For statically-typed view helpers in other files, the cross-file
 * walker (v2b) resolves their reads directly — `track()` is unnecessary
 * and the `llui/prefer-static-deps` lint rule will flag it. A clean
 * codebase has zero `track()` calls.
 *
 * If you're considering `track()` to silence `llui/opaque-state-flow`
 * on a function-parameter callback (`getX: (s: S) => X`), don't — that
 * shape is the documented anti-pattern, not a use case for `track`. See
 * `https://github.com/fponticelli/llui/blob/main/docs/composition-patterns.md` for the four migration shapes.
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
