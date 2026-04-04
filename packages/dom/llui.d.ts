/**
 * LLui — Consolidated Type Reference for LLM Context Injection
 *
 * This file contains the complete public API surface of @llui/dom,
 * @llui/effects, and @llui/test in under 150 lines. Include this
 * in an LLM's system prompt for accurate code generation.
 *
 * Auto-generated from source types — do not edit manually.
 */

// ── @llui/dom ────────────────────────────────────────────────────

export interface ComponentDef<S, M, E> {
  name: string
  init: (data?: unknown) => [S, E[]]
  update: (state: S, msg: M) => [S, E[]]
  view: (send: Send<M>) => Node[]
  onEffect?: (effect: E, send: Send<M>, signal: AbortSignal) => void
  propsMsg?: (props: Record<string, unknown>) => M
  receives?: Record<string, (params: unknown) => M>
}

export type Send<M> = (msg: M) => void
export interface AppHandle {
  dispose(): void
  flush(): void
}

export declare function component<S, M, E>(def: ComponentDef<S, M, E>): ComponentDef<S, M, E>
export declare function mountApp<S, M, E>(
  container: HTMLElement,
  def: ComponentDef<S, M, E>,
  data?: unknown,
): AppHandle
export declare function flush(): void

// ── View Primitives ───────────────────────────────────────────────

export declare function text(content: string): Node
export declare function text<S>(accessor: (s: S) => string, mask?: number): Node

export declare function branch<S, M>(opts: {
  on: (s: S) => string | number | boolean
  cases: Record<string | number, (send: Send<M>) => Node[]>
  enter?: (nodes: Node[]) => void | Promise<void>
  leave?: (nodes: Node[]) => void | Promise<void>
}): Node[]

export declare function show<S, M>(opts: {
  when: (s: S) => boolean
  render: (send: Send<M>) => Node[]
  fallback?: (send: Send<M>) => Node[]
  enter?: (nodes: Node[]) => void | Promise<void>
  leave?: (nodes: Node[]) => void | Promise<void>
}): Node[]

export declare function each<S, T, M>(opts: {
  items: (s: S) => T[]
  key: (item: T) => string | number
  render: (opts: {
    send: Send<M>
    item: <R>(selector: (t: T) => R) => () => R
    index: () => number
  }) => Node[]
  enter?: (nodes: Node[]) => void | Promise<void>
  leave?: (nodes: Node[]) => void | Promise<void>
}): Node[]

/** Read the current value from a scoped accessor imperatively (in event handlers). */
export declare function peek<T, R>(
  item: <V>(selector: (t: T) => V) => () => V,
  selector: (t: T) => R,
): R

export declare function portal(opts: { target: HTMLElement | string; render: () => Node[] }): Node[]

export declare function foreign<S, T extends Record<string, unknown>, Instance>(opts: {
  mount: (container: HTMLElement, send: Send<unknown>) => Instance
  props: (s: S) => T
  sync:
    | ((inst: Instance, props: T, prev: T | undefined) => void)
    | {
        [K in keyof T]?: (inst: Instance, value: T[K], prev: T[K] | undefined) => void
      }
  destroy: (inst: Instance) => void
  container?: { tag?: string; attrs?: Record<string, string> }
}): Node[]

export declare function child<S, ChildM>(opts: {
  def: ComponentDef<unknown, ChildM, unknown>
  key: string | number
  props: (s: S) => Record<string, unknown>
  onMsg?: (msg: ChildM) => unknown | null
}): Node[]

export declare function memo<S, T>(accessor: (s: S) => T): (s: S) => T
export declare function onMount(callback: (el: Element) => (() => void) | void): void
export declare function errorBoundary(opts: {
  render: () => Node[]
  fallback: (error: Error) => Node[]
  onError?: (error: Error) => void
}): Node[]

// ── Form Utilities ────────────────────────────────────────────────

export type FieldMsg<Fields extends Record<string, unknown>> = {
  [K in keyof Fields]: { type: 'setField'; field: K; value: Fields[K] }
}[keyof Fields]

export declare function applyField<S extends Record<string, unknown>, K extends keyof S>(
  state: S,
  field: K,
  value: S[K],
): S

// ── Element Helpers (representative subset) ───────────────────────

export declare function div(props?: Record<string, unknown>, children?: Node[]): HTMLDivElement
export declare function span(props?: Record<string, unknown>, children?: Node[]): HTMLSpanElement
export declare function button(
  props?: Record<string, unknown>,
  children?: Node[],
): HTMLButtonElement
export declare function input(props?: Record<string, unknown>): HTMLInputElement
export declare function a(props?: Record<string, unknown>, children?: Node[]): HTMLAnchorElement
export declare function img(props?: Record<string, unknown>): HTMLImageElement
export declare function ul(props?: Record<string, unknown>, children?: Node[]): HTMLUListElement
export declare function li(props?: Record<string, unknown>, children?: Node[]): HTMLLIElement
export declare function label(props?: Record<string, unknown>, children?: Node[]): HTMLLabelElement
export declare function form(props?: Record<string, unknown>, children?: Node[]): HTMLFormElement
export declare function select(
  props?: Record<string, unknown>,
  children?: Node[],
): HTMLSelectElement
export declare function option(
  props?: Record<string, unknown>,
  children?: Node[],
): HTMLOptionElement
export declare function textarea(props?: Record<string, unknown>): HTMLTextAreaElement
export declare function h1(props?: Record<string, unknown>, children?: Node[]): HTMLHeadingElement
export declare function h2(props?: Record<string, unknown>, children?: Node[]): HTMLHeadingElement
export declare function p(props?: Record<string, unknown>, children?: Node[]): HTMLParagraphElement

// ── @llui/effects ─────────────────────────────────────────────────

export declare function http(opts: {
  url: string
  method?: string
  body?: unknown
  headers?: Record<string, string>
  onSuccess: string
  onError: string
}): { type: 'http' }
export declare function cancel(token: string): { type: 'cancel' }
export declare function cancel(token: string, inner: { type: string }): { type: 'cancel' }
export declare function debounce(
  key: string,
  ms: number,
  inner: { type: string },
): { type: 'debounce' }
export declare function sequence(effects: Array<{ type: string }>): { type: 'sequence' }
export declare function race(effects: Array<{ type: string }>): { type: 'race' }
export declare function handleEffects<E extends { type: string }>(): {
  else(
    handler: (effect: E, send: Send<unknown>, signal: AbortSignal) => void,
  ): (effect: E, send: Send<unknown>, signal: AbortSignal) => void
}

// ── @llui/test ────────────────────────────────────────────────────

export declare function testComponent<S, M, E>(
  def: ComponentDef<S, M, E>,
  data?: unknown,
): {
  state: S
  effects: E[]
  allEffects: E[]
  history: Array<{ prevState: S; msg: M; nextState: S; effects: E[] }>
  send(msg: M): void
  sendAll(msgs: M[]): S
}
export declare function testView<S, M, E>(
  def: ComponentDef<S, M, E>,
  state: S,
): {
  query(selector: string): Element | null
  queryAll(selector: string): Element[]
}
export declare function assertEffects<E>(actual: E[], expected: Array<Partial<E>>): void
