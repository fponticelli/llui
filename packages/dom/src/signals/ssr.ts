// Signal SSR — render a signal component to an HTML string on the server, for
// hydration on the client.
//
// Unlike the legacy SSR path, signal hydration does NOT reuse server nodes via
// claim-markers: hydration rebuilds the (deterministic) tree client-side and
// atomically swaps it in (see `hydrateSignalApp`). So the serializer emits plain
// HTML with no `data-llui-hydrate` markers — the server pass exists for first
// paint / SEO; the client owns reconciliation from there.

import { renderSignalTree, type SignalDoc } from './dom.js'
import { pathHandle } from './handle.js'
import type { SignalComponentDef } from './component.js'

/** A server DOM document: the node-factory subset the build needs. A `DomEnv`
 * from `@llui/dom/ssr/jsdom` or `@llui/dom/ssr/linkedom` satisfies it. */
export type ServerDoc = SignalDoc

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

function nodeToString(node: Node): string {
  if (node.nodeType === 3) return escapeHtml(node.textContent ?? '') // text
  if (node.nodeType === 8) return `<!--${node.textContent ?? ''}-->` // comment
  if (node.nodeType === 11) {
    // document fragment — serialize its children (portals/structural slots)
    let out = ''
    for (let i = 0; i < node.childNodes.length; i++) out += nodeToString(node.childNodes[i]!)
    return out
  }
  if (node.nodeType !== 1) return ''
  const el = node as Element
  const tag = el.tagName.toLowerCase()
  let attrs = ''
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i]!
    if (attr.name.startsWith('on')) continue // event handlers don't serialize
    attrs += ` ${attr.name}="${escapeAttr(attr.value)}"`
  }
  if (VOID_ELEMENTS.has(tag)) return `<${tag}${attrs} />`
  let children = ''
  for (let i = 0; i < el.childNodes.length; i++) children += nodeToString(el.childNodes[i]!)
  return `<${tag}${attrs}>${children}</${tag}>`
}

/** Serialize an array of (already-built) DOM nodes to an HTML string. Used by
 * adapters (`@llui/vike`) that compose layout + page node trees before one final
 * serialization pass. */
export function serializeNodes(nodes: readonly Node[]): string {
  let html = ''
  for (const node of nodes) html += nodeToString(node)
  return html
}

/**
 * Build a signal component's DOM tree on the server, returning the (detached)
 * nodes plus a `dispose` that runs the build's teardowns. The caller composes /
 * serializes the nodes; effects are NOT dispatched (server render is pure).
 *
 * For persistent layouts, compose multiple `renderNodes` results before
 * `serializeNodes` so the layout/page trees are stitched at the slot position.
 */
export function renderNodes<S, M, E>(
  def: SignalComponentDef<S, M, E>,
  initialState: S | undefined,
  env: ServerDoc,
): { nodes: readonly Node[]; dispose: () => void } {
  const [seed] = normalizeInit(def, initialState)
  const handle = pathHandle<S>(() => seed, '')
  const noopSend = (): void => {}
  const tree = renderSignalTree(env, seed, () => def.view({ state: handle, send: noopSend }))
  return {
    nodes: tree.nodes,
    dispose: () => {
      for (const t of tree.teardowns.splice(0)) t()
    },
  }
}

/**
 * Render a signal component to an HTML string against the initial state (or a
 * provided override). `env` is a server `DomEnv` from `@llui/dom/ssr/jsdom` or
 * `@llui/dom/ssr/linkedom`.
 */
export function renderToString<S, M, E>(
  def: SignalComponentDef<S, M, E>,
  initialState: S | undefined,
  env: ServerDoc,
): string {
  const { nodes, dispose } = renderNodes(def, initialState, env)
  try {
    return serializeNodes(nodes)
  } finally {
    dispose()
  }
}

function normalizeInit<S, M, E>(def: SignalComponentDef<S, M, E>, override: S | undefined): [S] {
  if (override !== undefined) return [override]
  const r = def.init()
  if (Array.isArray(r) && r.length === 2 && Array.isArray((r as [S, E[]])[1])) {
    return [(r as [S, E[]])[0]]
  }
  return [r as S]
}
