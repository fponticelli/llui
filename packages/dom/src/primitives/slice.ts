import type { Send, EachOptions } from '../types'
import type { View } from '../view-helpers'
import { show as _show } from './show'
import { branch as _branch } from './branch'
import { each as _each } from './each'
import { text as _text } from './text'
import { memo as _memo } from './memo'
import { selector as _selector } from './selector'
import { useContext, type Context } from './context'

/**
 * Build a `View<Sub, M>` that composes a selector into every state-bound
 * accessor. Used to write view-functions over a sub-slice of parent state:
 *
 * ```ts
 * import { slice } from '@llui/dom'
 *
 * view: (h) => {
 *   const formView = slice(h, (s) => s.form)
 *   return [...formView.show({ when: f => f.valid, render: () => [...] })]
 * }
 * ```
 *
 * Kept as a standalone function rather than a method on the View bundle so
 * apps that don't use it don't pay for its bundle cost — tree-shaken when
 * unused.
 */
export function slice<Root, Sub, M>(
  h: View<Root, M> | { send: Send<M> },
  lift: (r: Root) => Sub,
): View<Sub, M> {
  const send = h.send
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
  }
}
