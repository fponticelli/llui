import type { BindingKind } from './types'
import { getRenderContext } from './render-context'
import { createBinding, applyBinding } from './binding'
import { addItemUpdater } from './scope'

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
        // Per-item: direct updater, bypassing Phase 2.
        // Equality check avoids redundant DOM writes.
        const get = accessor as unknown as () => unknown
        let lastV: unknown = get()
        applyBinding({ kind, node: el, key }, lastV)
        addItemUpdater(ctx.rootScope, () => {
          const v = get()
          if (v === lastV || (v !== v && lastV !== lastV)) return
          lastV = v
          applyBinding({ kind, node: el, key }, v)
        })
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
