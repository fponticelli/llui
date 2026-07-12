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

import { resolveSegments } from './mask.js'
// Row-context hooks (build-layer concern): when `derived` is built inside an
// `each` row, each component-state input must resolve against `ctx.state` while
// item/index inputs read the combined ctx. These are runtime-only calls (inside
// `derived`), so the handle→dom import is a benign one-way edge (dom does not
// import handle).
import { __inRowBuild } from './build-context.js'
import { isRowLocalDep, rebaseComponentDep } from './row-rebase.js'
import type { Signal, MappedSignal } from './types.js'

const SIGNAL = Symbol.for('llui.signal.handle')

/** A runtime `Signal`: the read surface PLUS the binding info needed to build a
 * reactive slot at runtime (view-helper composition). */
export interface SignalHandle<T> extends Signal<T> {
  readonly [SIGNAL]: true
  /** resolve the value from the binding's state (component or row ctx) */
  readonly produce: (state: unknown) => T
  /** dependency paths into the binding's state */
  readonly deps: readonly string[]
  /** Root discriminant for row rebasing. `true` ⇒ this handle reads the ROW ctx
   * (an `item`/`index` handle from `rowHandle`, or a row-aware `derived`); `false`
   * (or absent) ⇒ it reads the COMPONENT state and must be rebased to `ctx.state`
   * when placed inside an `each` row. Set at construction from the getter's origin,
   * so locality never depends on string-inferring a `state`/`item`/`index` field
   * name (which collides with a component field literally named that). */
  readonly rowLocal?: boolean
}

/** A runtime handle produced by `.map()` / `derived()` — same carrier as
 * {@link SignalHandle}, but its public `at` is the {@link MappedSignal} `never`
 * (a mapped signal has no static path to slice). A `MappedHandle<T>` is
 * assignable to `SignalHandle<T>`, so it flows through the build helpers
 * unchanged. */
export interface MappedHandle<T> extends MappedSignal<T> {
  readonly [SIGNAL]: true
  readonly produce: (state: unknown) => T
  readonly deps: readonly string[]
  readonly rowLocal?: boolean
}

export function isSignalHandle(v: unknown): v is SignalHandle<unknown> {
  return typeof v === 'object' && v !== null && (v as Record<symbol, unknown>)[SIGNAL] === true
}

/** A path-rooted handle: `produce` resolves `base` from the binding state;
 * `peek` reads the live value via `get`. `at` extends the path; `map` derives.
 * `rowLocal` marks a handle rooted at a ROW ctx (the internal `rowHandle` for
 * `item`/`index`); it propagates through `.at`/`.map` so row locality is carried,
 * never string-inferred. Component-state handles default to `false`. */
export function pathHandle<T>(get: () => unknown, base: string, rowLocal = false): SignalHandle<T> {
  // Pre-split the base path ONCE at handle creation; `produce`/`peek` run on
  // every binding evaluation (and re-evaluation on update), so they must not
  // re-`String.split` the path each time. This keeps `.at(x)` as cheap per-read
  // as a direct `.map(s => s.x)` access — important because the
  // `prefer-at-over-map` lint steers all authors toward `.at`.
  const segs = base === '' ? EMPTY_SEGS : base.split('.')
  const produce = (state: unknown): T => resolveSegments(state, segs) as T
  const h: SignalHandle<T> = {
    [SIGNAL]: true,
    produce,
    deps: [base],
    rowLocal,
    peek: () => resolveSegments(get(), segs) as T,
    at: ((path: string) =>
      pathHandle(get, base === '' ? path : `${base}.${path}`, rowLocal)) as Signal<T>['at'],
    map: (<U>(fn: (v: T) => U) =>
      mapHandle<T, U>(
        { peek: () => resolveSegments(get(), segs) as T, produce },
        fn,
        [base],
        rowLocal,
      )) as Signal<T>['map'],
  }
  return h
}

/** A ROW-rooted path handle (`item`/`index` inside an `each`/`virtualEach` row).
 * Identical to {@link pathHandle} but branded `rowLocal` — so a spec built from it
 * (or from `.at`/`.map` off it) reads the row ctx and is NOT rebased to
 * `ctx.state`. This is the emission target for the compiled each-arm prelude
 * (`const item = rowHandle(getCtx, 'item')`) and the authoring `each`/`virtualEach`
 * item/index handles. */
export function rowHandle<T>(get: () => unknown, base: string): SignalHandle<T> {
  return pathHandle<T>(get, base, true)
}

const EMPTY_SEGS: readonly string[] = []

/** Assemble a derived (mapped/combined) handle object from a peek/produce pair.
 * Pure carrier construction — the input-identity memo lives in the `produce`
 * passed in (built by {@link mapHandle} / {@link combineSignals}), so this just
 * wires the object and its `.map` chaining (which memoizes at the next level). */
function makeMappedHandle<T>(
  peek: () => T,
  produce: (state: unknown) => T,
  deps: readonly string[],
  rowLocal: boolean,
): MappedHandle<T> {
  // The carrier keeps a THROWING `at` as a runtime safety net for uncompiled
  // view-helper code; the public type is `MappedSignal` (`at: never`), which
  // can't hold that callable value — so build the object as a `SignalHandle`
  // (callable `at`) and widen to `MappedHandle` on return. The compile error
  // (`MappedSignal.at: never`) + the `at-after-map` lint are the real guards;
  // this throw only fires if both are bypassed.
  const h: SignalHandle<T> = {
    [SIGNAL]: true,
    produce,
    deps,
    rowLocal,
    peek,
    at: (() => {
      throw new Error('.at() on a mapped signal is unsupported — slice with .at() before .map()')
    }) as Signal<T>['at'],
    map: (<U>(fn: (v: T) => U) =>
      mapHandle<T, U>({ peek, produce }, fn, deps, rowLocal)) as Signal<T>['map'],
  }
  return h as MappedHandle<T>
}

/**
 * A single-source derived handle (`.map`) with an input-identity memo.
 *
 * The runtime calls a handle's `produce(state)` once PER DOWNSTREAM BINDING per
 * update (N bindings reading the same `.map` = N calls; a per-row fanout adds one
 * per row), and the reconciler gates commits on OUTPUT identity (`Object.is`).
 * Re-running `fn` when the resolved input is reference-identical to the last call
 * is pure waste. So we cache `{ lastInput, lastValue }` and short-circuit when
 * `source.produce(state)` returns a reference-identical input.
 *
 * Correctness: the memo is keyed on the RESOLVED INPUT reference, which is the
 * exact quantity the chunked-mask gate keys on (reference-equality per path). A
 * binding is evaluated on update ONLY when one of its dep paths changed by
 * reference — i.e. only when this input changed by reference — so inside the
 * reconciler a memo hit never masks a real change; it only dedups the redundant
 * re-reads (multiple bindings / rows in one pass, and mount). `fn` must be a pure
 * function of its input (the framework's dep-coverage contract already requires
 * this); `peek` stays UN-memoized because it reads live mutable state one-shot.
 */
function mapHandle<S, T>(
  source: { peek: () => S; produce: (state: unknown) => S },
  fn: (v: S) => T,
  deps: readonly string[],
  rowLocal: boolean,
): MappedHandle<T> {
  let has = false
  let lastInput: S
  let lastValue: T
  const produce = (state: unknown): T => {
    const input = source.produce(state)
    if (has && Object.is(input, lastInput)) return lastValue
    lastInput = input
    lastValue = fn(input)
    has = true
    return lastValue
  }
  return makeMappedHandle<T>(() => fn(source.peek()), produce, deps, rowLocal)
}

/**
 * Combine N independent signals into one derived signal. Use when the inputs have
 * no shared parent signal (cross-tree, or a per-row item signal + a component-state
 * signal); for a single source, prefer {@link Signal.map}.
 *
 * Two call forms — pick whichever reads cleaner:
 *
 *     derived(a, b, (va, vb) => …)   // variadic: 2–4 sources, positional values
 *     derived([a, b, …c], (…vals) => …)  // array: any N, tuple-typed values
 *
 * The compiler lowers `derived(...)` inside a DIRECT view to an inline call. This
 * is the equivalent RUNTIME handle for view-helper composition (where there is no
 * statically-known path): `produce`/`peek` apply `fn` over the resolved sources and
 * `deps` is the UNION of the sources' deps — so the chunked-mask reconciler fires
 * the binding whenever ANY source changes, and commits only on an output change.
 * All inputs must resolve against the same binding state (the common case: each is
 * rooted at the component state, or all at the same row ctx). The result is a
 * {@link MappedSignal} — like a `.map()`, it carries no path, so `.at()` on it is
 * a compile error (slice the sources before combining).
 */
export function derived<A, B, U>(a: Signal<A>, b: Signal<B>, fn: (a: A, b: B) => U): MappedSignal<U>
export function derived<A, B, C, U>(
  a: Signal<A>,
  b: Signal<B>,
  c: Signal<C>,
  fn: (a: A, b: B, c: C) => U,
): MappedSignal<U>
export function derived<A, B, C, D, U>(
  a: Signal<A>,
  b: Signal<B>,
  c: Signal<C>,
  d: Signal<D>,
  fn: (a: A, b: B, c: C, d: D) => U,
): MappedSignal<U>
export function derived<T extends readonly unknown[], U>(
  sigs: { readonly [K in keyof T]: Signal<T[K]> },
  fn: (...values: T) => U,
): MappedSignal<U>
export function derived(...args: readonly unknown[]): MappedSignal<unknown> {
  const fn = args[args.length - 1] as (...values: readonly unknown[]) => unknown
  // `derived([a, b], fn)` (array form) vs `derived(a, b, fn)` (variadic): the
  // array form is exactly two args whose first is an array of signals.
  const sigs = (
    args.length === 2 && Array.isArray(args[0]) ? args[0] : args.slice(0, -1)
  ) as readonly Signal<unknown>[]
  return combineSignals(sigs, fn)
}

/** Shared implementation behind every `derived(...)` overload. */
function combineSignals(
  sigs: readonly Signal<unknown>[],
  fn: (...values: readonly unknown[]) => unknown,
): MappedHandle<unknown> {
  const handles: SignalHandle<unknown>[] = []
  for (const s of sigs) {
    if (!isSignalHandle(s)) {
      throw new TypeError('derived(): every input must be a signal (got a non-signal value)')
    }
    handles.push(s)
  }

  // Built inside an `each` row, the inputs see the combined row ctx
  // `{ item, state, index }`. Item/index inputs already read it correctly, but a
  // COMPONENT-STATE input (deps not all row-local — the bag `state` handle or a
  // `state.at(x)`) must read `ctx.state`. Rebase each such input's produce + deps
  // independently so a mixed `derived([state, item], …)` resolves every input
  // against the right root. The resulting deps are all row-local, so the enclosing
  // `rebaseRowSpec` / `show` cond pass the FULL combined ctx through to this produce.
  const rowAware = __inRowBuild()
  // Row locality comes from each input's brand (`rowLocal`), NOT string inference —
  // so a component input reading a field literally named `state`/`item`/`index`
  // still rebases correctly. Unbranded inputs (rare: a hand-built handle) fall back
  // to the legacy dep-string test.
  const inputIsComponentRooted = (h: SignalHandle<unknown>): boolean =>
    h.rowLocal === true ? false : h.rowLocal === false ? true : !h.deps.every(isRowLocalDep)
  const inputs = handles.map((h) => {
    if (rowAware && inputIsComponentRooted(h)) {
      return {
        produce: (ctx: unknown) => h.produce((ctx as { state: unknown }).state),
        deps: h.deps.map(rebaseComponentDep),
      }
    }
    return { produce: (ctx: unknown) => h.produce(ctx), deps: h.deps }
  })
  // Input-identity memo over the TUPLE of resolved inputs (the multi-input analog
  // of `mapHandle`'s single-slot cache): recompute `fn` only when at least one
  // resolved input differs by reference from the last call. Same correctness
  // basis as `mapHandle` — a binding is re-evaluated on update only when one of
  // its dep paths (hence one of these inputs) changed by reference, so a memo hit
  // never masks a real change; it dedups the redundant re-reads across the N
  // bindings / rows that share this combined handle in a single reconcile pass.
  let lastInputs: unknown[] | null = null
  let lastValue: unknown
  const memoProduce = (state: unknown): unknown => {
    const n = inputs.length
    const vals = new Array<unknown>(n)
    let changed = lastInputs === null
    for (let k = 0; k < n; k++) {
      const v = inputs[k]!.produce(state)
      vals[k] = v
      if (!changed && !Object.is(v, lastInputs![k])) changed = true
    }
    if (!changed) return lastValue
    lastInputs = vals
    lastValue = fn(...vals)
    return lastValue
  }
  return makeMappedHandle<unknown>(
    () => fn(...handles.map((h) => h.peek())),
    memoProduce,
    [...new Set(inputs.flatMap((i) => i.deps))],
    // In a row build the inputs are rebased to read the combined ctx, so the
    // result reads the row ctx → row-local. Outside a row it reads component state.
    rowAware,
  )
}
