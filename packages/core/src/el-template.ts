import type { BindingKind } from './types'
import { getRenderContext } from './render-context'
import { createBinding, applyBinding } from './binding'

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
    const binding = createBinding(ctx.rootScope, {
      mask,
      accessor,
      kind,
      node,
      key,
      perItem,
    })
    const initialValue = perItem
      ? (accessor as unknown as () => unknown)()
      : accessor(ctx.state as never)
    binding.lastValue = initialValue
    applyBinding({ kind, node, key }, initialValue)
  }

  patch(root, bind)
  return root
}
