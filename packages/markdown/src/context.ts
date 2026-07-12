// RenderContext construction + reference-definition collection.

import type { Node } from 'unist'
import type { Root, Definition, Html, Text } from 'mdast'
import type { Renderable } from '@llui/dom'
import type { RenderContext, ResolvedOptions } from './types.js'
import { defaultRenderers, renderHtmlRun } from './renderers/index.js'

/** HTML-escape text content folded into a raw-HTML run (so a stray `<`, `>` or
 * `&` in Markdown text between two HTML tags can't inject markup). */
function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** mdast splits inline raw HTML into separate `html` fragments — `<b>hi</b>`
 * arrives as `html('<b>')`, `text('hi')`, `html('</b>')`. Sanitizing each
 * fragment independently corrupts it (an unbalanced `<b>` sanitizes to empty).
 *
 * So we coalesce a contiguous run that STARTS at an `html` node and ends at the
 * LAST `html` node reachable through only `html`/`text` siblings, fold the
 * intervening `text` (escaped) between the tags, and sanitize the joined HTML
 * ONCE. Text before the first tag / after the last tag stays outside the run and
 * renders normally (so it survives even when raw HTML is dropped). Runs are only
 * coalesced for the DEFAULT html renderer; a custom `html` override is honored
 * per-node (its author owns the fragment contract). */
function renderChildrenGrouped(ctx: RenderContext, children: readonly Node[]): Renderable {
  const out: Renderable[] = []
  let i = 0
  while (i < children.length) {
    const child = children[i]!
    if (child.type === 'html') {
      // Extend over contiguous html/text siblings; remember the last html index.
      let last = i
      let j = i
      while (j + 1 < children.length) {
        const t = children[j + 1]!.type
        if (t !== 'html' && t !== 'text') break
        j++
        if (children[j]!.type === 'html') last = j
      }
      let joined = ''
      for (let k = i; k <= last; k++) {
        const n = children[k]!
        joined += n.type === 'html' ? (n as Html).value : escapeHtmlText((n as Text).value)
      }
      out.push(renderHtmlRun(joined, ctx.options))
      i = last + 1
    } else {
      out.push(ctx.render(child))
      i++
    }
  }
  return out.flat()
}

/** Walk the tree and collect every link/image reference definition, keyed by
 * lowercased identifier (so `linkReference`/`imageReference` nodes can resolve). */
export function collectDefinitions(root: Root): Map<string, Definition> {
  const defs = new Map<string, Definition>()
  const visit = (node: Node): void => {
    if (node.type === 'definition') {
      const def = node as Definition
      const id = def.identifier.toLowerCase()
      if (!defs.has(id)) defs.set(id, def)
    }
    const parent = node as { children?: readonly Node[] }
    if (parent.children) for (const child of parent.children) visit(child)
  }
  visit(root)
  return defs
}

/** Build the context renderers receive: `render` dispatches one node through the
 * merged registry, `renderChildren` recurses, `definitions` resolves references. */
export function makeContext(
  options: ResolvedOptions,
  definitions: ReadonlyMap<string, Definition>,
): RenderContext {
  const ctx: RenderContext = {
    options,
    definitions,
    render: (node) => {
      const renderer = options.renderers[node.type]
      return renderer ? renderer(node, ctx) : []
    },
    renderChildren: (parent) =>
      options.renderers.html === defaultRenderers.html
        ? renderChildrenGrouped(ctx, parent.children)
        : parent.children.flatMap((child) => ctx.render(child)),
  }
  return ctx
}
