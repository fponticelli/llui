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
