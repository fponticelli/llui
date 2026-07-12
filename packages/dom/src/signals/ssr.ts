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
import { normalizeUpdateResult, type SignalComponentDef } from './component.js'

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

// Raw-text elements: the HTML parser reads their content verbatim (no character
// references), so running `escapeHtml` over inline CSS/JS would corrupt it —
// `a > b { }` must NOT become `a &gt; b { }`. (`textarea`/`title` are *escapable*
// raw text and DO use normal escaping, so they stay on the default text path.)
const RAW_TEXT_ELEMENTS = new Set(['script', 'style'])

/** Emit raw-text-element content verbatim, but neutralize any literal close
 * sequence (`</script`/`</style`, case-insensitive) that would otherwise end the
 * element early in the parser — the standard raw-text serialization guard. */
function guardRawText(text: string, tag: string): string {
  return text.replace(new RegExp(`</(${tag})`, 'gi'), '<\\/$1')
}

/** Escape a string for use inside a double-quoted HTML attribute. Exported so the
 * head-management collector serializes html/body attribute strings through the
 * same escaping as the node serializer (no second, divergent escaper). */
export function escapeAttr(s: string): string {
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
    // Skip only GENUINE inline event-handler attributes (onclick, oninput, …) —
    // the DOM exposes a matching `on*` property slot for those. A bare
    // `startsWith('on')` also dropped legitimate custom attributes (a web
    // component's `on-theme`, `ontology`, …); this keeps them.
    if (/^on[a-z]/.test(attr.name) && attr.name in el) continue
    attrs += ` ${attr.name}="${escapeAttr(attr.value)}"`
  }
  if (VOID_ELEMENTS.has(tag)) return `<${tag}${attrs} />`
  if (RAW_TEXT_ELEMENTS.has(tag)) {
    // Content is verbatim (see RAW_TEXT_ELEMENTS): concatenate raw text, guarded.
    return `<${tag}${attrs}>${guardRawText(el.textContent ?? '', tag)}</${tag}>`
  }
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
  // Adapter seed: context values to expose at the root of this build (see
  // `renderSignalTree`). `@llui/vike` replays a layout's in-scope contexts here
  // so a nested page renders against providers that live above its slot.
  contexts?: ReadonlyMap<symbol, unknown>,
): { nodes: readonly Node[]; dispose: () => void } {
  const [seed] = normalizeInit(def, initialState)
  const handle = pathHandle<S>(() => seed, '')
  const noopSend = (): void => {}
  // SSR has no live document to reconcile; `batch` just runs its body (whose sends
  // are no-ops here), matching the no-op send.
  const noopBatch = (fn: () => void): void => fn()
  const tree = renderSignalTree(
    env,
    () => def.view({ state: handle, send: noopSend, batch: noopBatch }),
    contexts,
    true, // ssr: skip the mount lifecycle (onMount) at every depth — see BuildCtx.ssr
  )
  // Mount on the detached tree to bake initial values into the serialized HTML.
  // The `ssr` flag above means onMount callbacks are never registered (a DOM-less
  // server render can't run them, and a browser-global in the body would throw);
  // portals with no explicit target are already client-only (see `buildPortal`).
  tree.mount(seed)
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
  return [normalizeUpdateResult<S, E>(def.init())[0]]
}
