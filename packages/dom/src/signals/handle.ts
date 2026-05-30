// Runtime signal handles — the composition layer.
//
// `Signal<T>` is a compile-time fiction the transform erases to static bindings
// IN A COMPONENT'S DIRECT VIEW. But views factored into HELPER functions (or
// passed signals as params) can't be lowered that way — the helper has no
// statically-known path. So a runtime handle carries `produce` (resolve the
// value from the binding's state) + `deps` (its dependency paths); the runtime
// authoring helpers (text/elements/show/branch/each) consume handles to build
// the same mask-gated bindings the transform emits. No reactive graph: handles
// just carry binding info; the component-level chunked-mask reconciler still
// gates everything.

import { resolvePath } from './mask.js'
import type { Signal } from './types.js'

const SIGNAL = Symbol.for('llui.signal.handle')

/** A runtime `Signal`: the read surface PLUS the binding info needed to build a
 * reactive slot at runtime (view-helper composition). */
export interface SignalHandle<T> extends Signal<T> {
  readonly [SIGNAL]: true
  /** resolve the value from the binding's state (component or row ctx) */
  readonly produce: (state: unknown) => T
  /** dependency paths into the binding's state */
  readonly deps: readonly string[]
}

export function isSignalHandle(v: unknown): v is SignalHandle<unknown> {
  return typeof v === 'object' && v !== null && (v as Record<symbol, unknown>)[SIGNAL] === true
}

/** A path-rooted handle: `produce` resolves `base` from the binding state;
 * `peek` reads the live value via `get`. `at` extends the path; `map` derives. */
export function pathHandle<T>(get: () => unknown, base: string): SignalHandle<T> {
  const produce = (state: unknown): T => resolvePath(state, base) as T
  const h: SignalHandle<T> = {
    [SIGNAL]: true,
    produce,
    deps: [base],
    peek: () => resolvePath(get(), base) as T,
    at: ((path: string) =>
      pathHandle(get, base === '' ? path : `${base}.${path}`)) as Signal<T>['at'],
    map: (<U>(fn: (v: T) => U) =>
      derivedHandle<U>(
        () => fn(resolvePath(get(), base) as T),
        (s) => fn(produce(s)),
        [base],
      )) as Signal<T>['map'],
  }
  return h
}

/** A derived handle (from `.map`): wraps a source's peek/produce; deps carry
 * through unchanged (the mask gate stays correct — the value can only change
 * when the source path changes). */
function derivedHandle<T>(
  peek: () => T,
  produce: (state: unknown) => T,
  deps: readonly string[],
): SignalHandle<T> {
  return {
    [SIGNAL]: true,
    produce,
    deps,
    peek,
    at: (() => {
      throw new Error('.at() on a mapped signal is unsupported — slice with .at() before .map()')
    }) as Signal<T>['at'],
    map: (<U>(fn: (v: T) => U) =>
      derivedHandle<U>(
        () => fn(peek()),
        (s) => fn(produce(s)),
        deps,
      )) as Signal<T>['map'],
  }
}

/**
 * Combine N independent signals into one derived signal. Use when the inputs have
 * no shared parent signal (cross-tree, or a per-row item signal + a component-state
 * signal); for a single source, prefer {@link Signal.map}.
 *
 * The compiler lowers `derived(...)` inside a DIRECT view to an inline call. This
 * is the equivalent RUNTIME handle for view-helper composition (where there is no
 * statically-known path): `produce`/`peek` apply `fn` over the resolved sources and
 * `deps` is the UNION of the sources' deps — so the chunked-mask reconciler fires
 * the binding whenever ANY source changes, and commits only on an output change.
 * All inputs must resolve against the same binding state (the common case: each is
 * rooted at the component state, or all at the same row ctx).
 */
export function derived<T extends readonly unknown[], U>(
  sigs: { readonly [K in keyof T]: Signal<T[K]> },
  fn: (...values: T) => U,
): Signal<U> {
  const handles: SignalHandle<unknown>[] = []
  for (const s of sigs) {
    if (!isSignalHandle(s)) {
      throw new TypeError('derived(): every input must be a signal (got a non-signal value)')
    }
    handles.push(s)
  }
  // Resolving N sources yields a value array spread into `fn(...values: T)`. The
  // array IS `T` by construction (handles[i] produces T[i]), but that invariant is
  // erased at runtime, so call through an unknown-arity view of `fn` — the single
  // unavoidable cast at this type-erasure boundary.
  const apply = fn as (...values: readonly unknown[]) => U
  return derivedHandle<U>(
    () => apply(...handles.map((h) => h.peek())),
    (state) => apply(...handles.map((h) => h.produce(state))),
    [...new Set(handles.flatMap((h) => h.deps))],
  )
}
