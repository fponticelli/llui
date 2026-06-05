// RenderContext construction + reference-definition collection.

import type { Node } from 'unist'
import type { Root, Definition } from 'mdast'
import type { RenderContext, ResolvedOptions } from './types.js'

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
    renderChildren: (parent) => parent.children.flatMap((child) => ctx.render(child)),
  }
  return ctx
}
