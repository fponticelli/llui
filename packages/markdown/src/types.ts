// Public types for @llui/markdown.
//
// The renderer registry is keyed by mdast node `type`. Known node types get a
// precisely-typed renderer (`heading` → `NodeRenderer<Heading>`); custom node
// types (added via micromark/mdast `extensions`) fall through the string index.

import type { Renderable } from '@llui/dom'
import type { Node } from 'unist'
import type { Nodes, Definition, Link, Image, LinkReference, ImageReference } from 'mdast'
import type { Options as FromMarkdownOptions } from 'mdast-util-from-markdown'

/** A node renderer turns one mdast node into Renderable LLui DOM. It receives the
 * node and a {@link RenderContext} for recursing into children / sibling nodes. */
export type NodeRenderer<N extends Node = Node> = (node: N, ctx: RenderContext) => Renderable

/** Per-node-type render overrides, merged OVER the built-in {@link defaultRenderers}.
 * Known mdast types are precisely typed; the string index admits custom node types.
 *
 * The index value is typed `NodeRenderer<never>` on purpose: a `(node: Heading) => …`
 * renderer is assignable to `(node: never) => …` (parameters are contravariant, and
 * `never` is a subtype of every type), so the precise per-type renderers and custom
 * renderers coexist without the variance conflict a `NodeRenderer<Node>` index would
 * cause. Author custom renderers with an explicit param type (`(node: MyNode) => …`). */
export type Renderers = {
  [K in Nodes['type']]?: NodeRenderer<Extract<Nodes, { type: K }>>
} & {
  [type: string]: NodeRenderer<never> | undefined
}

/** Internal: the merged registry after defaults are applied. Every renderer is
 * uniformly callable with a base `Node` (dispatch only ever calls the renderer
 * whose key matches `node.type`, so the widening is sound). */
export type ResolvedRenderers = Record<string, NodeRenderer<Node>>

/** A URL the renderer is about to emit (link href / image src), with the source
 * node. Return a rewritten URL, or `null` to drop the link/image entirely. */
export type TransformLink = (
  href: string,
  node: Link | Image | LinkReference | ImageReference,
) => string | null

export interface MarkdownOptions {
  /** Enable GitHub Flavored Markdown (tables, strikethrough, task lists,
   * autolinks, footnotes). Default `true`. */
  gfm?: boolean
  /** Per-node-type render overrides, merged over the built-in defaults. */
  renderers?: Renderers
  /** Extra micromark syntax extensions (custom block/inline syntax). */
  extensions?: FromMarkdownOptions['extensions']
  /** Extra mdast extensions matching the syntax extensions above. */
  mdastExtensions?: FromMarkdownOptions['mdastExtensions']
  /** Render raw HTML nodes via `unsafeHtml` instead of dropping them.
   * Default `false` (raw HTML is dropped — safe for untrusted/LLM content). */
  allowDangerousHtml?: boolean
  /** URL schemes permitted in links/images. A URL with no scheme (relative,
   * anchor, query) is always allowed. Default `['http','https','mailto','tel']`. */
  allowedProtocols?: string[]
  /** Rewrite or drop link/image URLs before sanitization. */
  transformLink?: TransformLink
  /** Class applied to the root wrapper element. Default `'markdown-body'`. */
  class?: string
  /** Override the key derived for each top-level block (controls reuse during
   * reactive/streaming updates). Default: a content hash of the block's source. */
  keyOf?: (node: Nodes, index: number) => string | number
}

/** Fully-resolved options with defaults applied — what renderers see on `ctx`. */
export interface ResolvedOptions {
  gfm: boolean
  renderers: ResolvedRenderers
  extensions: FromMarkdownOptions['extensions']
  mdastExtensions: FromMarkdownOptions['mdastExtensions']
  allowDangerousHtml: boolean
  allowedProtocols: string[]
  transformLink: TransformLink | undefined
  class: string
  keyOf: ((node: Nodes, index: number) => string | number) | undefined
}

/** Passed to every {@link NodeRenderer}: recurse, resolve references, read options. */
export interface RenderContext {
  /** Render a single node via the registry (unknown types render nothing). */
  render: (node: Node) => Renderable
  /** Render all children of a parent node, flattened. */
  renderChildren: (parent: { children: readonly Node[] }) => Renderable
  /** Link/image reference definitions collected from the whole document, keyed
   * by lowercased identifier. */
  definitions: ReadonlyMap<string, Definition>
  /** The resolved options. */
  options: ResolvedOptions
}
