import type { Send, ShowOptions, BranchOptions, EachOptions, ScopeOptions } from './types.js'
import { show as _show } from './primitives/show.js'
import { branch as _branch } from './primitives/branch.js'
import { scope as _scope } from './primitives/scope.js'
import { each as _each } from './primitives/each.js'
import { text as _text } from './primitives/text.js'
import { unsafeHtml as _unsafeHtml } from './primitives/unsafe-html.js'
import { memo as _memo } from './primitives/memo.js'
import { selector as _selector, type SelectorInstance } from './primitives/selector.js'
import { sample as _sample } from './primitives/sample.js'
import { clientOnly as _clientOnly, type ClientOnlyOptions } from './primitives/client-only.js'
import { useContext, type Context } from './primitives/context.js'

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
  branch<K extends string = string>(opts: BranchOptions<S, M, K>): Node[]
  scope(opts: ScopeOptions<S, M>): Node[]
  each<T>(opts: EachOptions<S, T, M>): Node[]
  text(accessor: ((s: S) => string) | string, mask?: number): Text
  /**
   * Insert raw HTML into the tree. Caller is responsible for sanitizing.
   * The parsed subtree is opaque to LLui — no nested bindings, events,
   * or primitives inside it will be tracked. See `unsafeHtml` for details.
   */
  unsafeHtml(accessor: ((s: S) => string) | string, mask?: number): Node[]
  memo<T>(accessor: (s: S) => T): (s: S) => T
  selector<V>(field: (s: S) => V): SelectorInstance<V>
  ctx<T>(c: Context<T>): (s: S) => T
  /**
   * Imperative one-shot read of current state inside the render context.
   * Returns `selector(state)` at call time — no binding is created, no
   * mask is assigned. Use when a builder needs the current state
   * snapshot and a reactive binding would be wrong semantically.
   */
  sample<R>(selector: (s: S) => R): R
  /**
   * Mark a subtree as browser-only. SSR emits an anchor-bracketed
   * placeholder (with optional fallback); the `render` callback only
   * runs on client mount / hydrate. See the `clientOnly` export.
   */
  clientOnly(opts: ClientOnlyOptions<S, M>): Node[]
}

/**
 * Create a `View<S, M>` bundle for a component's `view` callback.
 * Delegates straight to the underlying primitives — zero per-call overhead.
 */
export function createView<S, M>(send: Send<M>): View<S, M> {
  return {
    send,
    show: (opts) => _show<S, M>(opts),
    branch: <K extends string>(opts: BranchOptions<S, M, K>) => _branch<S, M, K>(opts),
    scope: (opts) => _scope<S, M>(opts),
    each: <T>(opts: EachOptions<S, T, M>) => _each<S, T, M>(opts),
    text: (accessor, mask) =>
      typeof accessor === 'string' ? _text(accessor) : _text<S>(accessor, mask),
    unsafeHtml: (accessor, mask) =>
      typeof accessor === 'string' ? _unsafeHtml(accessor) : _unsafeHtml<S>(accessor, mask),
    memo: <T>(accessor: (s: S) => T) => _memo<S, T>(accessor),
    selector: <V>(field: (s: S) => V) => _selector<S, V>(field),
    ctx: <T>(c: Context<T>) => useContext<S, T>(c),
    sample: <R>(selector: (s: S) => R) => _sample<S, R>(selector),
    clientOnly: (opts) => _clientOnly<S, M>(opts),
  }
}
