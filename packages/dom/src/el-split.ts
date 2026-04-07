import type { BindingKind } from './types'
import { getRenderContext } from './render-context'
import { createBinding, applyBinding } from './binding'
import { addCheckedItemUpdater } from './scope'

export function elSplit(
  tag: string,
  staticFn: ((el: HTMLElement) => void) | null,
  events: Array<[string, EventListener]> | null,
  bindings: Array<[number, BindingKind, string, (state: never) => unknown]> | null,
  children: Node[] | null,
): HTMLElement {
  const el = document.createElement(tag)

  if (staticFn) {
    staticFn(el)
  }

  if (events) {
    for (const [eventName, handler] of events) {
      el.addEventListener(eventName, handler)
    }
  }

  const ctx = getRenderContext()

  if (bindings) {
    for (const [mask, kind, key, accessor] of bindings) {
      const perItem = accessor.length === 0
      if (perItem) {
        const get = accessor as unknown as () => unknown
        const target = { kind, node: el, key }
        const initial = addCheckedItemUpdater(ctx.rootScope, get, (v) => applyBinding(target, v))
        applyBinding(target, initial)
      } else {
        const binding = createBinding(ctx.rootScope, {
          mask,
          accessor,
          kind,
          node: el,
          key,
          perItem: false,
        })
        const initialValue = accessor(ctx.state as never)
        binding.lastValue = initialValue
        applyBinding({ kind, node: el, key }, initialValue)
      }
    }
  }

  if (children) {
    for (const child of children) {
      el.appendChild(child)
    }
  }

  return el
}
