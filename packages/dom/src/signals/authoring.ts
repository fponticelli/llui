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
  signalBranch,
  type PropValue,
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

// ── Elements ────────────────────────────────────────────────────────
export type AttrValue = Reactive<string | number | boolean | null | undefined>
export type ElProps = Record<string, AttrValue | ((ev: Event) => void)>

/** An element helper accepts `tag(children)`, `tag(props, children)`, `tag(props)`,
 * or `tag()` — a leading array literal is children. */
export interface ElementHelper {
  (children: readonly Node[]): Node
  (props?: ElProps, children?: readonly Node[]): Node
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
  return ((a0?: ElProps | readonly Node[], a1?: readonly Node[]): Node => {
    const props = Array.isArray(a0) ? undefined : (a0 as ElProps | undefined)
    const children = (Array.isArray(a0) ? a0 : a1) ?? []
    return el(tag, lowerProps(props), children)
  }) as ElementHelper
}

/** SVG element helper (namespaced) — same call forms as HTML helpers. */
function svgHelper(tag: string): ElementHelper {
  return ((a0?: ElProps | readonly Node[], a1?: readonly Node[]): Node => {
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

// ── Structural primitives ───────────────────────────────────────────
export function each<T>(
  items: Signal<readonly T[]>,
  opts: {
    key: (item: T) => string | number
    render: (item: Signal<T>, index: Signal<number>) => readonly Node[]
  },
): Node {
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
  render: (narrowed: Signal<NonNullable<T>>) => readonly Node[],
  orElse?: () => readonly Node[],
): Node {
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
    [K in U[D] & (string | number)]: (v: Signal<Extract<U, Record<D, K>>>) => readonly Node[]
  },
): Node
/** Render keyed by a plain string/number signal's value (no narrowing). */
export function branch<K extends string | number>(
  value: Signal<K>,
  arms: Partial<Record<K, () => readonly Node[]>>,
): Node
export function branch(value: Signal<unknown>, arg1: unknown, arms?: unknown): Node {
  if (!isSignalHandle(value)) return compiledAway('branch')
  if (typeof arg1 === 'function') {
    // 3-arg: discriminant fn + narrowed arms
    const discFn = arg1 as (u: unknown) => string | number
    const armMap = arms as Record<string, (v: Signal<unknown>) => readonly Node[]>
    const lowered: Record<string, () => readonly Node[]> = {}
    for (const k of Object.keys(armMap)) lowered[k] = () => armMap[k]!(value)
    return signalBranch({ produce: (s) => discFn(value.produce(s)), deps: value.deps }, lowered)
  }
  // 2-arg: the value IS the discriminant (string/number)
  const armMap = arg1 as Record<string, () => readonly Node[]>
  const lowered: Record<string, () => readonly Node[]> = {}
  for (const k of Object.keys(armMap)) lowered[k] = () => armMap[k]!()
  return signalBranch({ produce: value.produce, deps: value.deps }, lowered)
}

// ── Foreign (imperative-library boundary) ──────────────────────────
/** Embed an imperative library. Declared `state` signals are materialized to
 * LiveSignals for `mount`. Rewritten by the compiler to `signalForeign`. */
export function foreign<Inst, State extends Record<string, Signal<unknown>>>(_spec: {
  tag?: string
  state?: State
  mount: (args: {
    el: Element
    state: { [K in keyof State]: LiveSignal<State[K] extends Signal<infer T> ? T : unknown> }
  }) => Inst
  unmount?: (instance: Inst) => void
}): Node {
  return compiledAway('foreign')
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
  view: (bag: SignalViewBag<S, M>) => readonly Node[]
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
