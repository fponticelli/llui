import { getRenderContext } from '../render-context'
import { createBinding } from '../binding'
import { FULL_MASK } from '../update-loop'

export function text<S>(
  accessor: ((s: S) => string) | (() => string) | string,
  mask?: number,
): Text {
  if (typeof accessor === 'string') {
    return document.createTextNode(accessor)
  }

  const ctx = getRenderContext()
  const node = document.createTextNode('')

  // Per-item accessor from each() — zero-arg function (length === 0)
  if (accessor.length === 0) {
    const binding = createBinding(ctx.rootScope, {
      mask: FULL_MASK,
      accessor: accessor as (state: never) => unknown,
      kind: 'text',
      node,
      perItem: true,
    })
    const initialValue = (accessor as () => string)()
    node.nodeValue = String(initialValue)
    binding.lastValue = initialValue
    return node
  }

  // Component-level state accessor
  const bindingMask = mask ?? FULL_MASK
  const binding = createBinding(ctx.rootScope, {
    mask: bindingMask,
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
