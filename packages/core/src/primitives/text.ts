import { getRenderContext } from '../render-context'
import { createBinding } from '../binding'
import { isPerItemAccessor } from './each'

const FULL_MASK = 0xffffffff

export function text<S>(
  accessor: ((s: S) => string) | (() => string) | string,
  mask?: number,
): Text {
  if (typeof accessor === 'string') {
    return document.createTextNode(accessor)
  }

  const ctx = getRenderContext()
  const node = document.createTextNode('')

  // Per-item accessor from each() — zero-arg function tagged __perItem
  if (isPerItemAccessor(accessor)) {
    const binding = createBinding(ctx.rootScope, {
      mask: FULL_MASK,
      accessor: accessor as (state: never) => unknown,
      kind: 'text',
      node,
      perItem: true,
    })
    const initialValue = accessor()
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
