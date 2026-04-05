import type { BindingKind } from './types'
import { getRenderContext } from './render-context'
import { createBinding, applyBinding } from './binding'
import { addItemUpdater } from './scope'

// Cache: HTML string → template element (created once, cloned per use)
const templateCache = new Map<string, HTMLTemplateElement>()

/** Callback passed to patch functions — registers a reactive binding on a node. */
export type TemplateBind = (
  node: Node,
  mask: number,
  kind: BindingKind,
  key: string | undefined,
  accessor: (s: never) => unknown,
) => void

/**
 * Clone a cached HTML template and apply a patch function.
 *
 * The patch function receives the cloned root element and a `bind` helper
 * that registers reactive bindings in the current render context.
 *
 * Per-item bindings (accessor.length === 0) are registered as direct
 * updaters on the scope — called by each() when item changes, bypassing
 * the Phase 2 binding scan entirely.
 *
 * Fast path for each() rows — 1 cloneNode instead of N createElement.
 */
export function elTemplate(
  html: string,
  patch: (root: Element, bind: TemplateBind) => void,
): Element {
  let tmpl = templateCache.get(html)
  if (!tmpl) {
    tmpl = document.createElement('template')
    tmpl.innerHTML = html
    templateCache.set(html, tmpl)
  }

  const root = tmpl.content.firstElementChild!.cloneNode(true) as Element
  const ctx = getRenderContext()

  const bind: TemplateBind = (node, mask, kind, key, accessor) => {
    const perItem = accessor.length === 0
    if (perItem) {
      // Per-item: set initial value and register direct updater
      const get = accessor as unknown as () => unknown
      const initialValue = get()
      applyBinding({ kind, node, key }, initialValue)
      // Updater called by each() when item changes — bypasses Phase 2.
      // Equality check avoids redundant DOM writes when only some fields
      // of the item changed (e.g. label changed but id didn't).
      let lastV: unknown = initialValue
      addItemUpdater(ctx.rootScope, () => {
        const v = get()
        if (v === lastV || (v !== v && lastV !== lastV)) return
        lastV = v
        applyBinding({ kind, node, key }, v)
      })
    } else {
      // State-level: use the binding system for Phase 2
      const binding = createBinding(ctx.rootScope, {
        mask,
        accessor,
        kind,
        node,
        key,
        perItem: false,
      })
      const initialValue = accessor(ctx.state as never)
      binding.lastValue = initialValue
      applyBinding({ kind, node, key }, initialValue)
    }
  }

  patch(root, bind)
  return root
}
