// Signal authoring surface — what humans/LLMs write. These typed helpers are
// REWRITTEN by @llui/vite-plugin (text -> signalText, div -> el, each ->
// signalEach, …) before they ever run, so their runtime bodies are stubs that
// throw if reached uncompiled. `component` and `mountApp` are kept by the
// transform and have real runtime behavior (they route to the signal runtime).
//
// Importing from `@llui/dom/signals` gives both these authoring names and the
// lowered runtime names (signalText/el/…); the transform replaces the former
// with the latter.

import type { Signal, LiveSignal } from './types.js'
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
export function text(_value: Reactive<string | number>): Node {
  return compiledAway('text')
}

// ── Elements ────────────────────────────────────────────────────────
export type AttrValue = Reactive<string | number | boolean | null>
export type ElProps = Record<string, AttrValue | ((ev: Event) => void)>

function elementHelper(tag: string): (props?: ElProps, children?: readonly Node[]) => Node {
  return () => compiledAway(tag)
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

// ── Structural primitives ───────────────────────────────────────────
export function each<T>(
  _items: Signal<readonly T[]>,
  _opts: {
    key: (item: T) => string | number
    render: (item: Signal<T>, index: Signal<number>) => readonly Node[]
  },
): Node {
  return compiledAway('each')
}

export function show<T>(
  _cond: Signal<T>,
  _render: (narrowed: Signal<NonNullable<T>>) => readonly Node[],
): Node {
  return compiledAway('show')
}

export function branch<K extends string>(
  _discriminant: Signal<K>,
  _arms: Partial<Record<K, () => readonly Node[]>>,
): Node {
  return compiledAway('branch')
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
