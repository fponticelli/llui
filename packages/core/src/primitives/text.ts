import { getRenderContext } from '../render-context'
import { createBinding } from '../binding'

const FULL_MASK = 0xffffffff

export function text<S>(accessor: ((s: S) => string) | string, mask?: number): Text {
  if (typeof accessor === 'string') {
    return document.createTextNode(accessor)
  }

  const ctx = getRenderContext()
  const node = document.createTextNode('')
  const bindingMask = mask ?? FULL_MASK

  const binding = createBinding(ctx.rootScope, {
    mask: bindingMask,
    accessor: accessor as (state: never) => unknown,
    kind: 'text',
    node,
    perItem: false,
  })

  // Evaluate initial value
  const initialValue = accessor(ctx.state as S)
  node.nodeValue = String(initialValue)
  binding.lastValue = initialValue

  return node
}
