import type { BindingKind } from './types.js'
import type { DomEnv } from './dom-env.js'
import { getRenderContext } from './render-context.js'
import { createBinding, applyBinding } from './binding.js'
import { addCheckedItemUpdater } from './lifetime.js'

// Template cache. Each HTML string maps to its parsed
// `HTMLTemplateElement`. Single shared `Map` keyed only on the HTML —
// the WeakMap-by-env layer that wrapped this used to support
// concurrent SSR with mixed envs (jsdom + linkedom in one process)
// but in practice each runtime uses one env and the layer was
// zero-benefit overhead. SSR processes that need a fresh cache call
// `_resetTemplateCache()` at boundary points.
const templateCache = new Map<string, HTMLTemplateElement>()

/** @internal SSR-only — clear the cache between independent renders. */
export function _resetTemplateCache(): void {
  templateCache.clear()
}

/** Callback passed to patch functions — registers a reactive binding on a node.
 *
 *  `maskHi` (optional, defaults to 0) carries the high-word mask for
 *  accessors that read prefixes at bit positions 31..61. Stale
 *  compiled bundles emitted before multi-word support omit the
 *  parameter entirely; the defaulting keeps them correct under
 *  ≤31-prefix components. */
export type TemplateBind = (
  node: Node,
  mask: number,
  kind: BindingKind,
  key: string | undefined,
  accessor: (s: never) => unknown,
  maskHi?: number,
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
  patch: (root: Element, bind: TemplateBind, dom: DomEnv) => void,
): Element {
  const ctx = getRenderContext()
  let tmpl = templateCache.get(html)
  if (!tmpl) {
    tmpl = ctx.dom.createElement('template') as HTMLTemplateElement
    tmpl.innerHTML = html
    templateCache.set(html, tmpl)
  }

  const root = tmpl.content.firstElementChild!.cloneNode(true) as Element

  const bind: TemplateBind = (node, mask, kind, key, accessor, maskHi = 0) => {
    const perItem = accessor.length === 0
    if (perItem) {
      const get = accessor as unknown as () => unknown
      const target = { kind, node, key }
      const initial = addCheckedItemUpdater(ctx.rootLifetime, get, (v) => applyBinding(target, v))
      applyBinding(target, initial)
    } else {
      // State-level: use the binding system for Phase 2
      const binding = createBinding(ctx.rootLifetime, {
        mask,
        maskHi,
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

  patch(root, bind, ctx.dom)
  return root
}

/**
 * Emitted by `@llui/vite-plugin` for static-content template clones
 * (no bindings). Replaces the bare `document.createElement('template')`
 * IIFE the compiler used to emit, threading through `ctx.dom` so SSR
 * in non-browser envs (jsdom, linkedom) works without globalThis mutation.
 *
 * App authors should not call this directly — use `elTemplate` for
 * dynamic content and element helpers (`div`, `span`, …) for everything
 * else. The underscore prefix signals the compiler-only surface; the
 * export exists because the compiler emits import references to it.
 */
export function __cloneStaticTemplate(html: string): Node {
  const ctx = getRenderContext('cloneStaticTemplate')
  let tmpl = templateCache.get(html)
  if (!tmpl) {
    tmpl = ctx.dom.createElement('template') as HTMLTemplateElement
    tmpl.innerHTML = html
    templateCache.set(html, tmpl)
  }
  return tmpl.content.cloneNode(true).firstChild!
}
