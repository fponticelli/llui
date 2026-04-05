import type { Send, ShowOptions, BranchOptions, EachOptions } from './types'
import { show as _show } from './primitives/show'
import { branch as _branch } from './primitives/branch'
import { each as _each } from './primitives/each'
import { text as _text } from './primitives/text'
import { memo as _memo } from './primitives/memo'
import { selector as _selector, type SelectorInstance } from './primitives/selector'
import { useContext, type Context } from './primitives/context'

/**
 * Typed view helpers bound to a component's `State` / `Msg`. The sole
 * argument to `view`, so every state-bound primitive infers `State` from
 * the component definition — no per-call `show<State>(...)` annotation.
 *
 * ```ts
 * view: ({ send, show, text }) => [
 *   ...show({ when: s => s.count > 0, render: () => [...] }),
 *   text(s => String(s.count)),
 * ]
 * ```
 *
 * Tip: to view-function over a sub-slice of parent state, import `slice`
 * as a standalone helper:
 *
 * ```ts
 * import { slice } from '@llui/dom'
 * const form = slice(h, s => s.form)   // returns View<FormState, Msg>
 * ```
 *
 * The Vite plugin's mask-injection pass recognizes all three call forms
 * equivalently: `h.text(...)` (member expression), `text(...)` (destructured
 * alias), and `text(...)` (bare import from `@llui/dom`). No per-binding
 * gating is lost when calling through `h`.
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
}

/**
 * Create a `View<S, M>` bundle for a component's `view` callback.
 * Delegates straight to the underlying primitives — zero per-call overhead.
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
  }
}
