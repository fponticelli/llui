import type { BindingKind } from './types'
import { getRenderContext } from './render-context'
import { createBinding, applyBinding } from './binding'
import { addItemUpdater } from './scope'
import { isHydrating, claimElement, pushCursor, popCursor } from './hydrate'

export function elSplit(
  tag: string,
  staticFn: ((el: HTMLElement) => void) | null,
  events: Array<[string, EventListener]> | null,
  bindings: Array<[number, BindingKind, string, (state: never) => unknown]> | null,
  children: Node[] | null,
): HTMLElement {
  const hydrate = isHydrating()
  const el = hydrate ? claimElement(tag) as HTMLElement : document.createElement(tag)

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
        // Per-item: direct updater, bypassing Phase 2
        const get = accessor as unknown as () => unknown
        applyBinding({ kind, node: el, key }, get())
        addItemUpdater(ctx.rootScope, () => {
          applyBinding({ kind, node: el, key }, get())
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
    if (hydrate) pushCursor(el)
    for (const child of children) {
      if (!hydrate) el.appendChild(child)
    }
    if (hydrate) popCursor()
  }

  return el
}
