import type { Send, ShowOptions, BranchOptions, EachOptions } from './types'
import { show as _show } from './primitives/show'
import { branch as _branch } from './primitives/branch'
import { each as _each } from './primitives/each'
import { text as _text } from './primitives/text'
import { memo as _memo } from './primitives/memo'
import { selector as _selector, type SelectorInstance } from './primitives/selector'
import { useContext, type Context } from './primitives/context'

/**
 * Typed view helpers bound to a component's `State` / `Msg`. Passed as the
 * second argument to `view`, so every state-bound primitive infers `State`
 * from the component definition — no per-call `show<State>(...)` annotation.
 *
 * ```ts
 * view: (send, h) => [
 *   ...h.show({ when: s => s.count > 0, render: () => [...] }),
 *   h.text(s => String(s.count)),
 * ]
 * ```
 *
 * `h.slice(selector)` returns a narrower `View<Sub, M>` — useful for
 * view-functions that render a sub-slice of parent state.
 *
 * The Vite plugin's mask-injection pass recognizes all three call forms
 * equivalently: `h.text(...)` (member expression), `text(...)` (destructured
 * alias from the second parameter), and `text(...)` (bare import from
 * `@llui/dom`). No per-binding gating is lost when calling through `h`.
 */
export interface View<S, M> {
  send: Send<M>
  show(opts: ShowOptions<S, M>): Node[]
  branch(opts: BranchOptions<S, M>): Node[]
  each<T>(opts: EachOptions<S, T, M>): Node[]
  text(accessor: ((s: S) => string) | string, mask?: number): Text
  memo<T>(accessor: (s: S) => T): (s: S) => T
  selector<V>(field: (s: S) => V): SelectorInstance<V>
  ctx<T>(c: Context<T>): (s: S) => T
  slice<Sub>(selector: (s: S) => Sub): View<Sub, M>
}

/**
 * Create a `View<S, M>` bundle for a component's `view` callback.
 * The identity bundle delegates straight to the underlying primitives with
 * no wrapping — zero per-call overhead.
 */
export function createView<S, M>(send: Send<M>): View<S, M> {
  return {
    send,
    show: (opts) => _show<S, M>(opts),
    branch: (opts) => _branch<S, M>(opts),
    each: <T>(opts: EachOptions<S, T, M>) => _each<S, T, M>(opts),
    text: (accessor, mask) =>
      typeof accessor === 'string' ? _text(accessor) : _text<S>(accessor, mask),
    memo: <T>(accessor: (s: S) => T) => _memo<S, T>(accessor),
    selector: <V>(field: (s: S) => V) => _selector<S, V>(field),
    ctx: <T>(c: Context<T>) => useContext<S, T>(c),
    slice: <Sub>(selector: (s: S) => Sub) => createSlicedView<S, Sub, M>(send, selector),
  }
}

/**
 * Build a `View<Sub, M>` that composes `selector` into every state-bound
 * accessor. Used by `h.slice(...)` to write view-functions over a sub-slice
 * of parent state.
 */
function createSlicedView<Root, Sub, M>(send: Send<M>, lift: (r: Root) => Sub): View<Sub, M> {
  return {
    send,
    show: (opts) =>
      _show<Root, M>({
        ...opts,
        when: (r) => opts.when(lift(r)),
      }),
    branch: (opts) =>
      _branch<Root, M>({
        ...opts,
        on: (r) => opts.on(lift(r)),
      }),
    each: <T>(opts: EachOptions<Sub, T, M>) =>
      _each<Root, T, M>({
        ...opts,
        items: (r) => opts.items(lift(r)),
      }),
    text: (accessor, mask) => {
      if (typeof accessor === 'string') return _text(accessor)
      return _text<Root>((r) => accessor(lift(r)), mask)
    },
    memo: <T>(accessor: (s: Sub) => T) => {
      const m = _memo<Root, T>((r) => accessor(lift(r)))
      return (s: Sub) => m(s as unknown as Root)
    },
    selector: <V>(field: (s: Sub) => V) => _selector<Root, V>((r) => field(lift(r))),
    ctx: <T>(c: Context<T>) => {
      const root = useContext<Root, T>(c)
      return (s: Sub) => root(s as unknown as Root)
    },
    slice: <Sub2>(sel: (s: Sub) => Sub2) =>
      createSlicedView<Root, Sub2, M>(send, (r) => sel(lift(r))),
  }
}
