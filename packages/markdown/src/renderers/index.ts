// The built-in renderer registry + merge with user overrides.

import type { Node } from 'unist'
import type { NodeRenderer, Renderers, ResolvedRenderers } from '../types.js'
import { blockRenderers } from './block.js'
import { inlineRenderers } from './inline.js'

export { renderHtmlRun } from './inline.js'

// Each built-in is authored with a precise node type (`NodeRenderer<Heading>`, …).
// Dispatch only ever invokes the renderer whose key equals `node.type`, so viewing
// each as a uniform `NodeRenderer<Node>` is sound. `NodeRenderer<N>` is assignable
// to `NodeRenderer<never>` (parameters are contravariant; `never` is a subtype of
// everything), so this is a localized, type-checked widening — not an `as unknown`.
function widen(renderer: NodeRenderer<never>): NodeRenderer<Node> {
  return renderer as NodeRenderer<Node>
}

const builtins = { ...blockRenderers, ...inlineRenderers }

/** The built-in registry: every built-in node type, uniformly callable. Its keys
 * are statically known, so `defaultRenderers.heading(node, ctx)` (delegating from a
 * custom override) type-checks without an undefined guard. */
export type BuiltinRenderers = { [K in keyof typeof builtins]: NodeRenderer<Node> }

function mapWiden<K extends string>(
  map: Record<K, NodeRenderer<never>>,
): Record<K, NodeRenderer<Node>> {
  const out = {} as Record<K, NodeRenderer<Node>>
  for (const key of Object.keys(map) as K[]) out[key] = widen(map[key])
  return out
}

export const defaultRenderers: BuiltinRenderers = mapWiden(builtins)

/** Merge user overrides over the built-in defaults into a uniform registry. */
export function mergeRenderers(user?: Renderers): ResolvedRenderers {
  const merged: ResolvedRenderers = { ...defaultRenderers }
  if (!user) return merged
  for (const key of Object.keys(user)) {
    const renderer = user[key]
    if (renderer) merged[key] = widen(renderer)
  }
  return merged
}
