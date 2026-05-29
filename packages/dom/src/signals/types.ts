// Signals — the view-layer reactive surface.
//
// `Signal<T>` is the authoring API for reading state in views. It is a
// COMPILE-TIME FICTION: the Vite compiler erases `state.at('a.b')` / `.map` /
// `derived` into bitmask-gated bindings, so there is no runtime Signal object on
// the common path (see docs/proposals/signals/). The interfaces here define the
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
 * The union of all valid dot-separated paths of `T` — both intermediate
 * (object) paths and leaf paths. Arrays contribute `${number}` indices,
 * `${number}.<sub>` nested paths, and `'length'`. Navigation descends through
 * nullable/optional fields (via `NonNullable`).
 */
export type ValidPath<T> = T extends null | undefined
  ? ValidPath<NonNullable<T>>
  : T extends readonly (infer U)[]
    ? `${number}` | `${number}.${ValidPath<U>}` | 'length'
    : T extends object
      ? {
          [K in keyof T & string]: NonNullable<T[K]> extends object
            ? K | `${K}.${ValidPath<NonNullable<T[K]>>}`
            : K
        }[keyof T & string]
      : never

/**
 * A reactive view of a value of type `T`. Three methods, the entire reactive
 * vocabulary alongside `derived`:
 *
 * - `at(path)` — slice into a sub-signal via a statically-typed dot path.
 * - `map(fn)` — transform into a derived signal (single source).
 * - `peek()` — one-shot, non-reactive read (handlers / effects / lifecycle).
 */
export interface Signal<T> {
  at<P extends ValidPath<T>>(path: P): Signal<PathValue<T, P>>
  map<U>(fn: (value: T) => U): Signal<U>
  peek(): T
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

/**
 * Combine N independent signals into a derived signal. Use when the inputs have
 * no shared parent signal (cross-tree or per-iteration + parent). For a single
 * source, use {@link Signal.map} instead.
 *
 * The tuple form takes one signature for any arity; the callback receives the
 * values spread, not as a tuple.
 *
 * Runtime is not implemented yet — this is the type surface (step 1 of the
 * signals roadmap). The compiler will lower `derived(...)` to a mask-gated memo
 * cell; this stub exists so the module is importable and type-testable.
 */
export function derived<T extends readonly unknown[], U>(
  _sigs: { readonly [K in keyof T]: Signal<T[K]> },
  _fn: (...values: T) => U,
): Signal<U> {
  throw new Error('derived: signals runtime not implemented yet (type surface only)')
}
