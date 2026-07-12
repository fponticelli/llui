// Signal authoring surface — what humans/LLMs write.
//
// These are REAL runtime functions: they accept runtime signal handles (carrying
// produce+deps) or plain values and build DOM + mask-gated bindings. So views
// factored into helper functions compose naturally. As an OPTIMIZATION, the Vite
// transform lowers signal expressions in a component's DIRECT view to static
// `signalText`/`el`/… calls (erasing handle allocation); both forms coexist.
//
// `component` and `mountApp` route to the signal runtime.

import type { Signal, LiveSignal } from './types.js'
import { isSignalHandle, rowHandle } from './handle.js'
import { react, type Mountable } from './build-context.js'
import {
  signalText,
  staticText,
  el,
  elNS,
  type PropValue,
  type ChildNode,
  type Renderable,
} from './element.js'
import { signalEach, signalEachDirect, type RowFactory, type RowCtx } from './each.js'
import { signalShow, signalBranch } from './show-branch.js'
import { signalUnsafeHtml } from './unsafe-html.js'
import { signalLazy, type SignalLazyOptions } from './lazy.js'
import { signalVirtualEach } from './virtual-each.js'
import { signalForeign, type SignalSpec } from './foreign.js'
import {
  mountSignalComponent,
  type MountSignalOptions,
  type SignalComponentDef,
  type SignalComponentHandle,
} from './component.js'

export type Send<M> = (msg: M) => void

/** A reactive value in a slot: a signal of T, or a plain T. */
export type Reactive<T> = Signal<T> | T

const compiledAway = (name: string): never => {
  throw new Error(
    `${name}() received a non-signal value at runtime — it was not lowered by @llui/vite-plugin.\n` +
      `Checklist:\n` +
      `  1. Is @llui/vite-plugin registered in your Vite config's \`plugins\`?\n` +
      `  2. Is this module a .ts/.tsx file the plugin transforms (not plain .js, not in an excluded path)?\n` +
      `  3. Did you restart the dev server / rebuild after changing the Vite config?\n` +
      `  4. In a view HELPER or test, pass a real signal handle (state.at(…) / state.map(…)) — ${name}() needs a signal, not a plain value.\n` +
      `When lowering is wired correctly, a direct-view ${name}() is compiled away and never reaches this code.`,
  )
}

// ── Text ────────────────────────────────────────────────────────────
export function text(value: Reactive<string | number>): Mountable {
  if (isSignalHandle(value)) return signalText(value.produce, value.deps, value.rowLocal !== true)
  return staticText(value == null ? '' : String(value))
}

/** Render a raw HTML string as live DOM nodes (escape hatch for pre-rendered
 * markup — markdown, syntax highlighting). Reactive on a `Signal<string>`; a
 * plain string renders once. The HTML is inserted as-is — the caller owns
 * trust/sanitization. */
export function unsafeHtml(value: Reactive<string>): Mountable {
  if (isSignalHandle(value))
    return signalUnsafeHtml(value.produce, value.deps, value.rowLocal !== true)
  return signalUnsafeHtml(() => value, [])
}

// ── Elements ────────────────────────────────────────────────────────
export type AttrValue = Reactive<string | number | boolean | null | undefined>

/** The DOM event type delivered to each well-known `on*` handler prop. Keep the
 * keys camelCased (`onClick`, `onKeyDown`) — those are what the element helpers
 * recognize and bind. Anything not listed here (rarer events, `data-*`, custom
 * attributes) falls through to the {@link ElProps} index signature. */
export interface ElEventMap {
  onClick: MouseEvent
  onDblClick: MouseEvent
  onMouseDown: MouseEvent
  onMouseUp: MouseEvent
  onMouseEnter: MouseEvent
  onMouseLeave: MouseEvent
  onMouseMove: MouseEvent
  onMouseOver: MouseEvent
  onMouseOut: MouseEvent
  onContextMenu: MouseEvent
  onPointerDown: PointerEvent
  onPointerUp: PointerEvent
  onPointerMove: PointerEvent
  onPointerEnter: PointerEvent
  onPointerLeave: PointerEvent
  onPointerCancel: PointerEvent
  onKeyDown: KeyboardEvent
  onKeyUp: KeyboardEvent
  onKeyPress: KeyboardEvent
  onInput: Event
  onChange: Event
  onSubmit: SubmitEvent
  onReset: Event
  onFocus: FocusEvent
  onBlur: FocusEvent
  onFocusIn: FocusEvent
  onFocusOut: FocusEvent
  onScroll: Event
  onWheel: WheelEvent
  onDrag: DragEvent
  onDragStart: DragEvent
  onDragEnd: DragEvent
  onDragOver: DragEvent
  onDragEnter: DragEvent
  onDragLeave: DragEvent
  onDrop: DragEvent
  onTouchStart: TouchEvent
  onTouchEnd: TouchEvent
  onTouchMove: TouchEvent
}

/** Props for an element helper. Well-known `on*` handlers (see {@link ElEventMap})
 * get their precise DOM event type, so `onClick: (e) => e.clientX` infers
 * `e: MouseEvent` with no annotation. Every other key — attributes, `data-*`,
 * `aria-*`, signals, and less-common events — is an {@link AttrValue} or a
 * loosely-typed handler via the index signature, which also lets `connect()`
 * part bags (with their own pre-typed handlers) spread in cleanly.
 *
 * The handler index falls back to `any` ON PURPOSE: a stricter index type would
 * be a supertype of the precise `on*` handlers and reject them (function params
 * are contravariant), so the precise types live in the mapped half and the
 * index stays permissive. */
export type ElProps = {
  [K in keyof ElEventMap]?: (ev: ElEventMap[K]) => void
} & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: AttrValue | ((ev: any) => void) | undefined
}

/** An element helper accepts `tag(children)`, `tag(props, children)`, `tag(props)`,
 * or `tag()` — a leading array literal is children. Children are `Mountable`s (from
 * other helpers) or bare strings/numbers (coerced to text nodes at append time).
 * Returns a `Mountable`, materialized when placed. */
export interface ElementHelper {
  (children: readonly ChildNode[]): Mountable
  (props?: ElProps, children?: readonly ChildNode[]): Mountable
}

function lowerProps(props: ElProps | undefined): Record<string, PropValue> {
  const lowered: Record<string, PropValue> = {}
  if (props) {
    for (const k of Object.keys(props)) {
      const v = props[k]
      // a signal handle -> reactive binding (carry its row-locality brand so a
      // component-state prop placed in an each row rebases correctly); handler/
      // static value pass through
      lowered[k] = isSignalHandle(v)
        ? react(v.produce, v.deps, v.rowLocal !== true)
        : (v as PropValue)
    }
  }
  return lowered
}

function elementHelper(tag: string): ElementHelper {
  return ((a0?: ElProps | readonly ChildNode[], a1?: readonly ChildNode[]): Mountable => {
    const props = Array.isArray(a0) ? undefined : (a0 as ElProps | undefined)
    const children = (Array.isArray(a0) ? a0 : a1) ?? []
    return el(tag, lowerProps(props), children)
  }) as ElementHelper
}

/** SVG element helper (namespaced) — same call forms as HTML helpers. */
function svgHelper(tag: string): ElementHelper {
  return ((a0?: ElProps | readonly ChildNode[], a1?: readonly ChildNode[]): Mountable => {
    const props = Array.isArray(a0) ? undefined : (a0 as ElProps | undefined)
    const children = (Array.isArray(a0) ? a0 : a1) ?? []
    return elNS(tag, lowerProps(props), children)
  }) as ElementHelper
}

export const div = elementHelper('div')
export const span = elementHelper('span')
export const p = elementHelper('p')
export const a = elementHelper('a')
export const button = elementHelper('button')
export const input = elementHelper('input')
export const label = elementHelper('label')
export const form = elementHelper('form')
export const ul = elementHelper('ul')
export const ol = elementHelper('ol')
export const li = elementHelper('li')
export const section = elementHelper('section')
export const header = elementHelper('header')
export const footer = elementHelper('footer')
export const nav = elementHelper('nav')
export const main = elementHelper('main')
export const h1 = elementHelper('h1')
export const h2 = elementHelper('h2')
export const h3 = elementHelper('h3')
export const img = elementHelper('img')
export const small = elementHelper('small')
export const strong = elementHelper('strong')
export const em = elementHelper('em')
export const table = elementHelper('table')
export const thead = elementHelper('thead')
export const tbody = elementHelper('tbody')
export const tr = elementHelper('tr')
export const td = elementHelper('td')
export const th = elementHelper('th')
export const pre = elementHelper('pre')
export const code = elementHelper('code')
export const canvas = elementHelper('canvas')
export const aside = elementHelper('aside')
export const article = elementHelper('article')
export const figure = elementHelper('figure')
export const figcaption = elementHelper('figcaption')
export const blockquote = elementHelper('blockquote')
export const h4 = elementHelper('h4')
export const h5 = elementHelper('h5')
export const h6 = elementHelper('h6')
export const hr = elementHelper('hr')
export const br = elementHelper('br')
export const select = elementHelper('select')
export const option = elementHelper('option')
export const optgroup = elementHelper('optgroup')
export const textarea = elementHelper('textarea')
export const fieldset = elementHelper('fieldset')
export const legend = elementHelper('legend')
export const dl = elementHelper('dl')
export const dt = elementHelper('dt')
export const dd = elementHelper('dd')
export const caption = elementHelper('caption')
export const time = elementHelper('time')
export const details = elementHelper('details')
export const summary = elementHelper('summary')

// ── SVG elements (namespaced) ───────────────────────────────────────
export const svg = svgHelper('svg')
export const path = svgHelper('path')
export const g = svgHelper('g')
export const circle = svgHelper('circle')
export const rect = svgHelper('rect')
export const line = svgHelper('line')
export const polyline = svgHelper('polyline')
export const polygon = svgHelper('polygon')
export const ellipse = svgHelper('ellipse')
// SVG <text> — named `svgText` to avoid colliding with the `text()` node helper.
export const svgText = svgHelper('text')

// ── Structural primitives ───────────────────────────────────────────
// The items handle's deps say nothing about what the ROWS read: a row can reach
// component state through connect parts, nested arms, or handles closed over from
// the view — none visible at runtime. `['']` (the whole-state path) makes the
// structural binding fire on every state change so those reads stay live; the
// reconcile's probe/gating (`templateReadsState`, same-structure fast path) keeps
// the per-change cost proportional to the rows that actually changed. Compiled
// tiers pass PRECISE deps instead (pass 1 merges them into the source; `eachDirect`
// receives them as `stateDeps`).
const WHOLE_STATE_DEPS: readonly string[] = ['']

export function each<T>(
  items: Signal<readonly T[]>,
  opts: {
    key: (item: T) => string | number
    render: (item: Signal<T>, index: Signal<number>) => Renderable
  },
): Mountable {
  if (!isSignalHandle(items)) return compiledAway('each')
  const produce = items.produce as (s: unknown) => readonly T[]
  return signalEach(
    { items: produce, deps: items.deps, componentRooted: items.rowLocal !== true },
    opts.key,
    (getCtx) => {
      // item/index handles read the row's live combined ctx ({ item, state });
      // `rowHandle` brands them row-local so their reads aren't rebased.
      const itemH = rowHandle<T>(getCtx, 'item')
      const indexH = rowHandle<number>(getCtx, 'index')
      return opts.render(itemH, indexH)
    },
    WHOLE_STATE_DEPS,
  )
}

/** Compiled render-arm keyed list — the MID-TIER between {@link eachDirect}
 * (full direct construction) and the verbatim authoring {@link each}: the items
 * source is a verbatim runtime handle (a view-helper's call-site-bound signal the
 * compiler can't resolve), but the ROW is a compiled `() => [...]` arm whose
 * binding producers read the combined row ctx (`ctx.item` / `ctx.index`) directly
 * — no per-row item/index handle allocation. Un-lowerable children inside the arm
 * (a nested `show` on a state handle, a helper call without the row param) stay
 * verbatim and run via the authoring path within the row build. Emitted by the
 * compiler's pass-2 helper-each lowering when the row factory bails on a
 * structural child. */
export function eachArm<T>(
  items: Signal<readonly T[]>,
  key: (item: T) => string | number,
  // The compiled arm. Binding producers read the ctx passed to them; `getCtx`
  // exposes the LIVE row ctx for event handlers (`getCtx().item.id` at event
  // time — dispatch-by-id stays correct across keyed reorders).
  render: (getCtx: () => RowCtx<T>) => Renderable,
  stateDeps?: readonly string[],
): Mountable {
  if (!isSignalHandle(items)) return compiledAway('eachArm')
  const produce = items.produce as (s: unknown) => readonly T[]
  // Default to whole-state: this tier exists FOR rows with verbatim residue
  // (structural children / helper calls), whose state reads are unknowable.
  return signalEach(
    { items: produce, deps: items.deps, componentRooted: items.rowLocal !== true },
    key,
    render,
    stateDeps ?? WHOLE_STATE_DEPS,
  )
}

/** Direct-construction keyed list. Same keyed reconcile as {@link each}, but each
 * row is built by `row` (a {@link RowFactory}: direct DOM + binding specs wired by
 * node reference) instead of authoring helpers — the compiled fast path. The
 * factory's spec `produce(ctx)` reads the row ctx `{ item, state, index }`.
 * `stateDeps` names the component-state paths the factory's bindings read (the
 * compiler passes the collected set, often empty); omitted (legacy emissions),
 * it falls back to whole-state so `ctx.state` reads stay live. */
export function eachDirect<T>(
  items: Signal<readonly T[]>,
  key: (item: T) => string | number,
  row: RowFactory,
  stateDeps?: readonly string[],
): Mountable {
  if (!isSignalHandle(items)) return compiledAway('eachDirect')
  const produce = items.produce as (s: unknown) => readonly T[]
  return signalEachDirect(
    { items: produce, deps: items.deps, componentRooted: items.rowLocal !== true },
    key,
    row,
    stateDeps ?? WHOLE_STATE_DEPS,
  )
}

export function show<T>(
  cond: Signal<T>,
  render: (narrowed: Signal<NonNullable<T>>) => Renderable,
  orElse?: () => Renderable,
): Mountable {
  if (!isSignalHandle(cond)) return compiledAway('show')
  // the arm reads component state; the cond handle (path-rooted) IS the narrowed
  // signal — its `.at()` resolves against the same state the arm scope receives.
  const narrowed = cond as Signal<NonNullable<T>>
  return signalShow(
    { produce: cond.produce, deps: cond.deps, componentRooted: cond.rowLocal !== true },
    () => render(narrowed),
    orElse,
  )
}

/** Discriminated-union render. `discriminant` selects the union's tag field
 * (`v => v.kind`, `v => v.type`, …); each arm receives the NARROWED variant
 * signal, so it can read variant-only fields with full types (`v.at('data')`).
 * Mirrors `show`'s narrowing. Rewritten by the compiler to `signalBranch`. */
export function branch<U extends object, D extends keyof U>(
  value: Signal<U>,
  discriminant: (u: U) => U[D],
  arms: {
    [K in U[D] & (string | number)]: (v: Signal<Extract<U, Record<D, K>>>) => Renderable
  },
): Mountable
/** Render keyed by a plain string/number signal's value (no narrowing). */
export function branch<K extends string | number>(
  value: Signal<K>,
  arms: Partial<Record<K, () => Renderable>>,
): Mountable
export function branch(value: Signal<unknown>, arg1: unknown, arms?: unknown): Mountable {
  if (!isSignalHandle(value)) return compiledAway('branch')
  if (typeof arg1 === 'function') {
    // 3-arg: discriminant fn + narrowed arms
    const discFn = arg1 as (u: unknown) => string | number
    const armMap = arms as Record<string, (v: Signal<unknown>) => Renderable>
    const lowered: Record<string, () => Renderable> = {}
    for (const k of Object.keys(armMap)) lowered[k] = () => armMap[k]!(value)
    return signalBranch(
      {
        produce: (s) => discFn(value.produce(s)),
        deps: value.deps,
        componentRooted: value.rowLocal !== true,
      },
      lowered,
    )
  }
  // 2-arg: the value IS the discriminant (string/number)
  const armMap = arg1 as Record<string, () => Renderable>
  const lowered: Record<string, () => Renderable> = {}
  for (const k of Object.keys(armMap)) lowered[k] = () => armMap[k]!()
  return signalBranch(
    { produce: value.produce, deps: value.deps, componentRooted: value.rowLocal !== true },
    lowered,
  )
}

// ── Lazy (async component loading) ─────────────────────────────────
/** Load a signal component asynchronously: render `fallback()` immediately, then
 * swap in the loaded component when `loader()` resolves (or `error(err)` on
 * reject). Identity at runtime — a real runtime helper (not compiled away), so
 * view-helper composition and uncompiled tests can call it directly. */
export function lazy<LS = unknown, LM = unknown, LE = unknown>(
  opts: SignalLazyOptions<LS, LM, LE>,
): Mountable {
  return signalLazy(opts)
}

// ── VirtualEach (windowed list) ─────────────────────────────────────
/** Virtualized keyed list — only the rows in the scroll viewport (+overscan)
 * exist in the DOM. `items` is a signal handle (like `each`); the render callback
 * receives per-row `item` + `index` signal handles. `itemHeight` is either a
 * uniform `number` (O(1) windowing) or a per-item `(item, index) => number` for
 * variable-height rows (cumulative offsets via a prefix sum, rebuilt when `items`
 * changes). Heights come from the data — measured/auto heights are not supported. */
export function virtualEach<T>(opts: {
  items: Signal<readonly T[]>
  key: (item: T) => string | number
  itemHeight: number | ((item: T, index: number) => number)
  containerHeight: number
  overscan?: number
  class?: string
  render: (item: Signal<T>, index: Signal<number>) => Renderable
}): Mountable {
  if (!isSignalHandle(opts.items)) return compiledAway('virtualEach')
  const produce = opts.items.produce as (s: unknown) => readonly T[]
  return signalVirtualEach<T>({
    items: produce,
    deps: opts.items.deps,
    // Rows may read component state through the enclosing view's handles (invisible
    // at runtime), so fire the structural binding on ANY state change — same
    // whole-state channel `each`/`eachArm` use. The reconcile's state-fanout gating
    // keeps the per-change cost proportional to the visible rows that changed.
    extraDeps: WHOLE_STATE_DEPS,
    key: opts.key,
    itemHeight: opts.itemHeight,
    containerHeight: opts.containerHeight,
    overscan: opts.overscan,
    class: opts.class,
    renderRow: (getCtx) => {
      const itemH = rowHandle<T>(getCtx, 'item')
      const indexH = rowHandle<number>(getCtx, 'index')
      return opts.render(itemH, indexH)
    },
  })
}

// ── Foreign (imperative-library boundary) ──────────────────────────
/** Embed an imperative library. Declared `state` signals are materialized to
 * LiveSignals for `mount`. A REAL runtime helper (like text/each/show/branch):
 * the compiler lowers a direct-view `foreign()` to `signalForeign`, but in
 * view-helper functions / uncompiled code it runs here — converting each declared
 * state HANDLE to its `{produce, deps}` spec and delegating to `signalForeign`. */
export function foreign<Inst, State extends Record<string, Signal<unknown>>>(spec: {
  tag?: string
  state?: State
  mount: (args: {
    el: Element
    state: { [K in keyof State]: LiveSignal<State[K] extends Signal<infer T> ? T : unknown> }
  }) => Inst
  unmount?: (instance: Inst) => void
}): Mountable {
  const stateSpecs: Record<string, SignalSpec<unknown>> = {}
  for (const [k, v] of Object.entries(spec.state ?? {})) {
    // a signal handle carries produce+deps; a plain value becomes a static spec
    stateSpecs[k] = isSignalHandle(v)
      ? { produce: v.produce, deps: v.deps }
      : { produce: () => v, deps: [] }
  }
  return signalForeign<Inst, Record<string, SignalSpec<unknown>>>({
    tag: spec.tag,
    state: stateSpecs,
    mount: spec.mount as (args: {
      el: Element
      state: Record<string, LiveSignal<unknown>>
    }) => Inst,
    unmount: spec.unmount,
  })
}

// ── Component + mount (kept by the transform; real runtime behavior) ──
export interface SignalViewBag<S, M> {
  state: Signal<S>
  send: Send<M>
  /** Coalesce a burst of `send`s into ONE reconcile (see the handle's `batch`). */
  batch: (fn: () => void) => void
}

export interface SignalComponentSpec<S, M, E = never> {
  /** optional component name (debug registry / agent identity) */
  name?: string
  init: () => S | [S, E[]]
  update: (state: S, msg: M) => [S, E[]] | S
  view: (bag: SignalViewBag<S, M>) => Renderable
  onEffect?: (
    effect: E,
    api: {
      send: Send<M>
      state: Signal<S>
      batch: (fn: () => void) => void
      /** This mount's lifecycle {@link AbortSignal} — aborted on dispose. */
      signal: AbortSignal
    },
  ) => void | (() => void)
}

/**
 * Define a signal component. Identity at runtime — the view has been lowered by
 * the compiler; the authoring/runtime bag shapes coincide (state: Signal<S>).
 *
 * The three type parameters:
 * - **`S` — State.** The component's state shape. Must be JSON-serializable
 *   (plain objects/arrays/primitives — no class instances, functions, Maps, or
 *   Dates) so it can be snapshotted, time-travelled, and sent over the agent
 *   wire. In `view`, `state` arrives as a `Signal<S>` — read it with
 *   `state.at('field')`, `state.map(fn)`, or `state.peek()` (handlers/effects).
 * - **`M` — Msg.** The message/action union the reducer handles. A
 *   **discriminated union with a `type` field** (`{ type: 'inc' } | { type:
 *   'set'; value: number }`); the `type` discriminant is what the compiler,
 *   devtools, and agent surface key off. Enforced by `M extends { type: string }`.
 * - **`E` — Effect.** The effect union returned from `init`/`update`, also a
 *   **discriminated union with a `type` field**. Defaults to `never` (a pure
 *   component with no effects). Handled in `onEffect` (or by `@llui/effects`).
 *
 * Spelling these out (and the `{ type: string }` constraint) catches a malformed
 * Msg/Effect union at the call site instead of at the first failed dispatch.
 */
export function component<S, M extends { type: string }, E extends { type: string } = never>(
  spec: SignalComponentSpec<S, M, E>,
): SignalComponentDef<S, M, E> {
  return spec as SignalComponentDef<S, M, E>
}

/** Mount a signal component into a container. */
export function mountApp<S, M, E = never>(
  container: Element,
  def: SignalComponentDef<S, M, E>,
  opts?: MountSignalOptions<S>,
): SignalComponentHandle<S, M> {
  return mountSignalComponent(container, def, opts)
}
