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
import { isSignalHandle, pathHandle } from './handle.js'
import {
  signalText,
  staticText,
  el,
  elNS,
  react,
  signalEach,
  signalShow,
  signalUnsafeHtml,
  signalBranch,
  signalLazy,
  signalVirtualEach,
  signalForeign,
  type PropValue,
  type ChildNode,
  type Mountable,
  type Renderable,
  type SignalLazyOptions,
  type SignalSpec,
} from './dom.js'
import {
  mountSignalComponent,
  type SignalComponentDef,
  type SignalComponentHandle,
} from './component.js'

export type Send<M> = (msg: M) => void

/** A reactive value in a slot: a signal of T, or a plain T. */
export type Reactive<T> = Signal<T> | T

const compiledAway = (name: string): never => {
  throw new Error(
    `${name}() must be compiled by @llui/vite-plugin (signal authoring helper used at runtime)`,
  )
}

// ── Text ────────────────────────────────────────────────────────────
export function text(value: Reactive<string | number>): Node {
  if (isSignalHandle(value)) return signalText(value.produce, value.deps)
  return staticText(value == null ? '' : String(value))
}

/** Render a raw HTML string as live DOM nodes (escape hatch for pre-rendered
 * markup — markdown, syntax highlighting). Reactive on a `Signal<string>`; a
 * plain string renders once. The HTML is inserted as-is — the caller owns
 * trust/sanitization. */
export function unsafeHtml(value: Reactive<string>): Mountable {
  if (isSignalHandle(value)) return signalUnsafeHtml(value.produce, value.deps)
  return signalUnsafeHtml(() => value, [])
}

// ── Elements ────────────────────────────────────────────────────────
export type AttrValue = Reactive<string | number | boolean | null | undefined>
// Event-handler props accept a handler for ANY specific Event subtype (component
// `connect()` parts type them as `(e: KeyboardEvent)=>void` etc.). A single
// non-`any` type can't both accept those AND keep good inline inference, so the
// event param is intentionally `any` here (handlers are typed at their source).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ElProps = Record<string, AttrValue | ((ev: any) => void)>

/** An element helper accepts `tag(children)`, `tag(props, children)`, `tag(props)`,
 * or `tag()` — a leading array literal is children. Children may be built nodes
 * or bare strings/numbers (coerced to text nodes at append time). */
export interface ElementHelper {
  (children: readonly ChildNode[]): Node
  (props?: ElProps, children?: readonly ChildNode[]): Node
}

function lowerProps(props: ElProps | undefined): Record<string, PropValue> {
  const lowered: Record<string, PropValue> = {}
  if (props) {
    for (const k of Object.keys(props)) {
      const v = props[k]
      // a signal handle -> reactive binding; handler/static value pass through
      lowered[k] = isSignalHandle(v) ? react(v.produce, v.deps) : (v as PropValue)
    }
  }
  return lowered
}

function elementHelper(tag: string): ElementHelper {
  return ((a0?: ElProps | readonly ChildNode[], a1?: readonly ChildNode[]): Node => {
    const props = Array.isArray(a0) ? undefined : (a0 as ElProps | undefined)
    const children = (Array.isArray(a0) ? a0 : a1) ?? []
    return el(tag, lowerProps(props), children)
  }) as ElementHelper
}

/** SVG element helper (namespaced) — same call forms as HTML helpers. */
function svgHelper(tag: string): ElementHelper {
  return ((a0?: ElProps | readonly ChildNode[], a1?: readonly ChildNode[]): Node => {
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
export function each<T>(
  items: Signal<readonly T[]>,
  opts: {
    key: (item: T) => string | number
    render: (item: Signal<T>, index: Signal<number>) => Renderable
  },
): Mountable {
  if (!isSignalHandle(items)) return compiledAway('each')
  const produce = items.produce as (s: unknown) => readonly T[]
  return signalEach({ items: produce, deps: items.deps }, opts.key, (getCtx) => {
    // item/index handles read the row's live combined ctx ({ item, state })
    const itemH = pathHandle<T>(getCtx, 'item')
    const indexH = pathHandle<number>(getCtx, 'index')
    return opts.render(itemH, indexH)
  })
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
  return signalShow({ produce: cond.produce, deps: cond.deps }, () => render(narrowed), orElse)
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
    return signalBranch({ produce: (s) => discFn(value.produce(s)), deps: value.deps }, lowered)
  }
  // 2-arg: the value IS the discriminant (string/number)
  const armMap = arg1 as Record<string, () => Renderable>
  const lowered: Record<string, () => Renderable> = {}
  for (const k of Object.keys(armMap)) lowered[k] = () => armMap[k]!()
  return signalBranch({ produce: value.produce, deps: value.deps }, lowered)
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
 * receives per-row `item` + `index` signal handles. Fixed `itemHeight` only. */
export function virtualEach<T>(opts: {
  items: Signal<readonly T[]>
  key: (item: T) => string | number
  itemHeight: number
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
    key: opts.key,
    itemHeight: opts.itemHeight,
    containerHeight: opts.containerHeight,
    overscan: opts.overscan,
    class: opts.class,
    renderRow: (getCtx) => {
      const itemH = pathHandle<T>(getCtx, 'item')
      const indexH = pathHandle<number>(getCtx, 'index')
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
}

export interface SignalComponentSpec<S, M, E = never> {
  /** optional component name (debug registry / agent identity) */
  name?: string
  init: () => S | [S, E[]]
  update: (state: S, msg: M) => [S, E[]] | S
  view: (bag: SignalViewBag<S, M>) => Renderable
  onEffect?: (effect: E, api: { send: Send<M>; state: Signal<S> }) => void | (() => void)
}

/** Define a signal component. Identity at runtime — the view has been lowered by
 * the compiler; the authoring/runtime bag shapes coincide (state: Signal<S>). */
export function component<S, M, E = never>(
  spec: SignalComponentSpec<S, M, E>,
): SignalComponentDef<S, M, E> {
  return spec as SignalComponentDef<S, M, E>
}

/** Mount a signal component into a container. */
export function mountApp<S, M, E = never>(
  container: Element,
  def: SignalComponentDef<S, M, E>,
): SignalComponentHandle<S, M> {
  return mountSignalComponent(container, def)
}
