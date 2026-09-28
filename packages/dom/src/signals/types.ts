// Signals — the view-layer reactive surface.
//
// `Signal<T>` (sliceable, path-rooted) / `MappedSignal<T>` (from `.map`/`derived`)
// and their shared read-only supertype `ReadSignal<T>` are the authoring API for
// reading state in views. They are a COMPILE-TIME FICTION: the Vite compiler
// erases `state.at('a.b')` / `.map` / `derived` into chunked-mask-gated bindings,
// so there is no runtime Signal object on the common path (see docs/proposals/signals/). The interfaces here define the
// authored surface and the static path typing the compiler keys off.
//
// `LiveSignal<T>` is the ONE place signals materialize at runtime: the
// declarative→imperative boundary (`foreign`, and `subApp` only when a reactive
// slice must cross in). It is DCE'd when unused.

/**
 * Resolve the value type at a single path segment `K` of `T`.
 *
 * - Array element access (`K` is a numeric-literal string) always yields
 *   `U | undefined` — an index may miss, regardless of `noUncheckedIndexedAccess`.
 * - `'length'` on an array yields `number`.
 * - Otherwise it's the property type `T[K]`.
 */
export type GetKey<T, K extends string> = T extends readonly (infer U)[]
  ? K extends `${number}`
    ? U | undefined
    : K extends 'length'
      ? number
      : never
  : K extends keyof T
    ? T[K]
    : never

/**
 * Resolve the value type at a dot-separated `path` of `T`, bubbling
 * nullability: once any segment introduces `null`/`undefined` (optional field,
 * nullable field, array index), it carries through to the result.
 */
export type PathValue<T, S extends string> = [Extract<T, null | undefined>] extends [never]
  ? S extends `${infer Head}.${infer Tail}`
    ? PathValue<GetKey<T, Head>, Tail>
    : GetKey<T, S>
  : PathValue<NonNullable<T>, S> | Extract<T, null | undefined>

/**
 * Recursion budget for {@link ValidPath}. Each level of object/array descent
 * decrements it; at `0` enumeration stops (only the keys at the current level
 * stay valid, no deeper paths). Two reasons it exists:
 *
 * 1. **Termination on recursive types.** A self-referential state shape — a tree
 *    node whose field references the node type (e.g. a menu item with
 *    `children?: Item[]`) — would expand `ValidPath` forever and surface as
 *    `TS2615: Type ... circularly references itself`. Decrementing the budget
 *    passes DIFFERENT type arguments at each level, which breaks the cycle.
 * 2. **Bounding the union.** `ValidPath<T>` grows multiplicatively with width ×
 *    depth; a cap keeps very deep shapes from blowing TypeScript's instantiation
 *    limit (`TS2589`). Paths deeper than the budget aren't typo-checked — reach
 *    for `.map(s => s.deep.path)` there (it sidesteps path typing entirely).
 *
 * The budget is generous (8 segments) — deeper than any hand-written state path
 * in practice — so it only ever bites pathological/recursive shapes.
 */
type PathDepthBudget = 8
type DecrDepth = [0, 0, 1, 2, 3, 4, 5, 6, 7]

/**
 * The union of all valid dot-separated paths of `T` — both intermediate
 * (object) paths and leaf paths. Arrays contribute `${number}` indices,
 * `${number}.<sub>` nested paths, and `'length'`. Navigation descends through
 * nullable/optional fields (via `NonNullable`), bounded by {@link PathDepthBudget}.
 */
export type ValidPath<T, D extends number = PathDepthBudget> = T extends null | undefined
  ? ValidPath<NonNullable<T>, D>
  : T extends readonly (infer U)[]
    ? D extends 0
      ? `${number}` | 'length'
      : `${number}` | `${number}.${ValidPath<U, DecrDepth[D]>}` | 'length'
    : T extends object
      ? {
          [K in keyof T & string]: NonNullable<T[K]> extends object
            ? D extends 0
              ? K
              : K | `${K}.${ValidPath<NonNullable<T[K]>, DecrDepth[D]>}`
            : K
        }[keyof T & string]
      : never

/**
 * The READ surface every signal shares — a reactive view of a value of type `T`
 * that you can transform and read, but not slice:
 *
 * - `map(fn)` — transform into a derived signal (single source).
 * - `peek()` — one-shot, non-reactive read (handlers / effects / lifecycle).
 *
 * `ReadSignal<T>` is the type to ACCEPT whenever you only read a signal: a view
 * helper's parameter, a part-bag value, a slot. Both kinds of signal satisfy it —
 * a path signal ({@link Signal}, from `state` / `.at()` / `constant()`) and a
 * mapped one ({@link MappedSignal}, from `.map()` / `derived()`) — so a caller can
 * hand it either:
 *
 *     const badge = (count: ReadSignal<number>) => span([text(count.map(String))])
 *     badge(state.at('unread'))                        // ✅ path signal
 *     badge(state.map((s) => s.inbox.length))          // ✅ mapped signal
 *
 * Only a parameter that calls `.at()` needs the narrower {@link Signal}.
 */
export interface ReadSignal<T> {
  map<U>(fn: (value: T) => U): MappedSignal<U>
  peek(): T
}

/**
 * A PATH signal: a {@link ReadSignal} that also carries a statically-known state
 * path, so it can be sliced with `.at()`. The view's `state`, anything reached
 * from it through `.at()`, an `each` row's `item`/`index`, and `constant(v)` are
 * path signals. The full reactive vocabulary alongside `derived`:
 *
 * - `at(path)` — slice into a sub-signal via a statically-typed dot path.
 * - `map(fn)` — transform into a derived signal (single source).
 * - `peek()` — one-shot, non-reactive read (handlers / effects / lifecycle).
 *
 * A {@link MappedSignal} is NOT a `Signal`: it has no path to slice. Type a
 * parameter `Signal<T>` only when the function calls `.at()` on it; otherwise take
 * `ReadSignal<T>`, which accepts both.
 */
export interface Signal<T> extends ReadSignal<T> {
  /**
   * Slice into a sub-signal via a statically-typed dot path
   * (`state.at('user.profile.name')`). The path is validated and the result type
   * resolved at compile time.
   *
   * **Depth limit.** `ValidPath<T>` enumerates the union of *every* valid dotted
   * path of `T` (to validate the argument and power autocomplete). That union
   * grows multiplicatively with the state's width × depth, so on a large /
   * deeply-nested `T` it can exceed TypeScript's instantiation limit and surface
   * as `TS2589: Type instantiation is excessively deep`. The cost comes from the
   * *whole state shape*, not the single path you wrote. If you hit it, reach for
   * `.map(s => s.deep.path)` instead — a `.map()` derive sidesteps path typing
   * entirely (it reads the whole slice; the runtime still gates it correctly) and
   * is the supported escape hatch for very deep paths.
   */
  at<P extends ValidPath<T>>(path: P): Signal<PathValue<T, P>>
}

/**
 * A signal produced by `.map()` (or `derived()`). It is a {@link ReadSignal} —
 * `map`, `peek`, and chaining — WITHOUT `at`: a mapped signal carries no
 * statically-known state path, so there is nothing to slice into. Slice with
 * `.at()` BEFORE `.map()`:
 *
 *     sig.at('field').map(fn)   // ✅ narrow first, then transform
 *     sig.map(fn).at('field')   // ❌ no path to slice (use the form above)
 *
 * Two compile errors follow, both naming the fix in the message:
 *
 * - `.at()` on a mapped signal (`This expression is not callable`).
 * - passing a mapped signal where a {@link Signal} is required (`Types of
 *   property 'at' are incompatible`). If that parameter only reads the signal,
 *   type it {@link ReadSignal} instead.
 *
 * (The runtime also throws a branded error if an untyped caller reaches `.at()`.)
 */
export interface MappedSignal<T> extends ReadSignal<T> {
  /**
   * @deprecated `.at()` is unavailable after `.map()` — slice with `.at()` BEFORE `.map()` (`sig.at('field').map(fn)`), or read the field with `.map((v) => v.field)`.
   *
   * Declared (optional, and typed as a non-callable object whose only key is the
   * fix) rather than omitted so that BOTH misuses fail with that text in the
   * diagnostic: a `.at()` call, and a `MappedSignal` passed where a sliceable
   * {@link Signal} is required. An optional property is what makes a mapped
   * signal NOT assignable to `Signal` — a `never`-typed one would be (`never` is
   * assignable to everything).
   */
  at?: {
    readonly 'mapped signals have no state path: slice with .at() BEFORE .map(), or read with .map((v) => v.field); a parameter that only reads should be typed ReadSignal<T>': never
  }
}

/**
 * A materialized signal handed to imperative code at the `foreign` boundary.
 * Minimal on purpose — all derivation stays in the declarative `state:`
 * declaration, so this is a read+subscribe handle only.
 *
 * - `peek()` — one-shot, non-reactive read (same verb as {@link Signal}).
 * - `bind(cb)` — fires `cb` synchronously with the current value, then on every
 *   change; returns an unsubscribe. Mount-time `bind`s auto-dispose on unmount.
 *
 * Deliberately no `on` (event-listener vocabulary trains a redundant
 * peek-then-subscribe), no change-only mode, and no `at`/`map`/`derived`.
 */
export interface LiveSignal<T> {
  peek(): T
  bind(cb: (value: T) => void): () => void
}

// `derived(...)` — combine N signals into one — lives with the other runtime
// handle constructors in `./handle.ts` (it builds a `SignalHandle`). The compiler
// lowers it inside a direct view; the runtime handle backs view-helper composition.
