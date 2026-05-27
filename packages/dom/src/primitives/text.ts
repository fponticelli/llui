import { getRenderContext } from '../render-context.js'
import { createBinding } from '../binding.js'
import { addCheckedItemUpdater } from '../lifetime.js'
import { FULL_MASK } from '../update-loop.js'

export function text<S>(
  accessor: ((s: S) => string) | (() => string) | string,
  mask?: number,
  maskHi?: number,
): Text {
  const ctx = getRenderContext('text')
  if (typeof accessor === 'string') {
    return ctx.dom.createTextNode(accessor)
  }

  const node = ctx.dom.createTextNode('')

  // Per-item accessor from each() — zero-arg function (length === 0)
  // Register as direct updater, bypassing Phase 2 binding scan
  if (accessor.length === 0) {
    const get = accessor as () => string
    const initial = addCheckedItemUpdater(
      ctx.rootLifetime,
      () => String(get()),
      (v) => {
        node.nodeValue = v
      },
    )
    node.nodeValue = initial
    return node
  }

  // Component-level state accessor. `createBinding` derives `maskHi`
  // from `mask` when omitted (FULL_MASK → FULL_MASK, otherwise 0), so a
  // 2-arg call with `mask: FULL_MASK` still fires on high-word changes.
  // A compiler emit that reads a high-word prefix passes both args.
  const bindingMask = mask ?? FULL_MASK
  const binding = createBinding(ctx.rootLifetime, {
    mask: bindingMask,
    maskHi,
    accessor: accessor as (state: never) => unknown,
    kind: 'text',
    node,
    perItem: false,
  })
  const initialValue = (accessor as (s: S) => string)(ctx.state as S)
  node.nodeValue = String(initialValue)
  binding.lastValue = initialValue

  return node
}
