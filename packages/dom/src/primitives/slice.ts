import type { Send, EachOptions, ShowOptions, BranchOptions, ScopeOptions } from '../types.js'
import type { View } from '../view-helpers.js'
import { show as _show } from './show.js'
import { branch as _branch } from './branch.js'
import { scope as _scope } from './scope.js'
import { each as _each } from './each.js'
import { text as _text } from './text.js'
import { unsafeHtml as _unsafeHtml } from './unsafe-html.js'
import { memo as _memo } from './memo.js'
import { sample as _sample } from './sample.js'
import { selector as _selector } from './selector.js'
import { clientOnly as _clientOnly, type ClientOnlyOptions } from './client-only.js'
import { useContext, type Context } from './context.js'

/**
 * Build a `View<Sub, M>` that composes a selector into every state-bound
 * accessor. Used to write view-functions over a sub-slice of parent state:
 *
 * ```ts
 * import { slice } from '@llui/dom'
 *
 * view: (h) => {
 *   const formView = slice(h, (s) => s.form)
 *   return [...formView.show({ when: f => f.valid, render: (h) => [...] })]
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

  // Wrap a Sub-typed case callback to work with the Root-typed primitive.
  // The inner callback receives a View<Root, M> from the primitive, and we
  // narrow it to View<Sub, M> via a recursive slice() call.
  const wrapCase =
    (fn: (h: View<Sub, M>) => Node[]) =>
    (rootH: View<Root, M>): Node[] =>
      fn(slice(rootH, lift))

  const wrapCases = (
    cases: Record<string, (h: View<Sub, M>) => Node[]>,
  ): Record<string, (h: View<Root, M>) => Node[]> => {
    const out: Record<string, (h: View<Root, M>) => Node[]> = {}
    for (const key of Object.keys(cases)) {
      out[key] = wrapCase(cases[key]!)
    }
    return out
  }

  return {
    send,
    show: (opts: ShowOptions<Sub, M>) =>
      _show<Root, M>({
        ...opts,
        when: (r) => opts.when(lift(r)),
        render: wrapCase(opts.render),
        fallback: opts.fallback ? wrapCase(opts.fallback) : undefined,
      }),
    branch: <K extends string>(opts: BranchOptions<Sub, M, K>) => {
      // Re-typed to the wide form internally because we're transforming
      // the options before handing them to the real `branch`. The inner
      // call loses exhaustiveness narrowing — it's been enforced at the
      // slice boundary already.
      const anyOpts = opts as unknown as {
        on: (s: Sub) => K
        cases?: Record<string, (h: View<Sub, M>) => Node[]>
        default?: (h: View<Sub, M>) => Node[]
      }
      return _branch<Root, M>({
        ...(anyOpts as unknown as BranchOptions<Root, M>),
        on: (r) => anyOpts.on(lift(r)),
        cases: anyOpts.cases ? wrapCases(anyOpts.cases) : undefined,
        default: anyOpts.default ? wrapCase(anyOpts.default) : undefined,
      } as BranchOptions<Root, M>)
    },
    scope: (opts: ScopeOptions<Sub, M>) =>
      _scope<Root, M>({
        ...opts,
        on: (r) => opts.on(lift(r)),
        render: wrapCase(opts.render),
      }),
    each: <T>(opts: EachOptions<Sub, T, M>) =>
      _each<Root, T, M>({
        ...opts,
        items: (r) => opts.items(lift(r)),
        // The render bag carries a View<S, M> — for the inner Root-typed
        // each we need to translate Root → Sub by re-slicing h.
        render: (rootBag) => {
          const subBag = {
            ...rootBag,
            h: slice(rootBag.h, lift),
          } as unknown as Parameters<(typeof opts)['render']>[0]
          return opts.render(subBag)
        },
      }),
    text: (accessor, mask) => {
      if (typeof accessor === 'string') return _text(accessor)
      return _text<Root>((r) => accessor(lift(r)), mask)
    },
    unsafeHtml: (accessor, mask) => {
      if (typeof accessor === 'string') return _unsafeHtml(accessor)
      return _unsafeHtml<Root>((r) => accessor(lift(r)), mask)
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
    sample: <R>(selector: (s: Sub) => R) => _sample<Root, R>((r) => selector(lift(r))),
    clientOnly: (opts: ClientOnlyOptions<Sub, M>) =>
      _clientOnly<Root, M>({
        render: wrapCase(opts.render),
        fallback: opts.fallback ? wrapCase(opts.fallback) : undefined,
      }),
  }
}
