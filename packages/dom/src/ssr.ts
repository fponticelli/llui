import type { ComponentDef, Scope, Binding } from './types.js'
import { createComponentInstance, type ComponentInstance } from './update-loop.js'
import { setRenderContext, clearRenderContext } from './render-context.js'
import { setFlatBindings } from './binding.js'
import { createView } from './view-helpers.js'

/**
 * Render a component to DOM nodes for SSR, returning both the produced
 * nodes and the component instance (so callers can compose trees before
 * serializing — e.g. `@llui/vike` stitches layout + page nodes at the
 * `pageSlot()` marker position before one final serialization pass).
 *
 * Accepts an optional `parentScope` so the rendered instance's rootScope
 * becomes a child of an existing scope tree — used by persistent layouts
 * so contexts provided by an outer layout are reachable from an inner
 * page via `useContext`.
 *
 * Call `initSsrDom()` once before using this on the server.
 */
export function renderNodes<S, M, E, D = void>(
  def: ComponentDef<S, M, E, D>,
  initialState?: S,
  parentScope?: Scope,
): { nodes: Node[]; inst: ComponentInstance<S, M, E> } {
  const inst = createComponentInstance(def, undefined, parentScope ?? null)
  if (initialState !== undefined) {
    inst.state = initialState
  }

  setFlatBindings(inst.allBindings)
  setRenderContext({
    ...inst,
    send: inst.send as (msg: unknown) => void,
    instance: inst as ComponentInstance,
  })
  const nodes = def.view(createView<S, M>(inst.send))
  clearRenderContext()
  setFlatBindings(null)

  return { nodes, inst }
}

/**
 * Serialize an array of DOM nodes to an HTML string, adding
 * `data-llui-hydrate` markers on elements that own reactive bindings.
 *
 * Accepts a flat binding list so compositions of multiple instances
 * (layout + page, for persistent-layout SSR) produce correct markers
 * across the whole tree. Pass the union of every composed instance's
 * `allBindings`.
 */
export function serializeNodes(nodes: Node[], bindings: Binding[]): string {
  const hydrateElements = new Set<Node>()
  for (const binding of bindings) {
    const node = binding.node
    if (node.nodeType === 1) {
      hydrateElements.add(node)
    } else if (node.parentNode && node.parentNode.nodeType === 1) {
      hydrateElements.add(node.parentNode)
    }
  }
  let html = ''
  for (const node of nodes) {
    html += nodeToStringWithMarkers(node, hydrateElements)
  }
  return html
}

/**
 * Render a component to an HTML string for SSR.
 * Evaluates view() against the initial state (or provided data),
 * serializes the DOM to HTML, and adds data-llui-hydrate markers
 * on nodes with reactive bindings.
 *
 * Call initSsrDom() once before using this on the server.
 *
 * For persistent layouts, use `renderNodes` + `serializeNodes` directly
 * so layout and page nodes can be composed before serialization.
 */
export function renderToString<S, M, E, D = void>(
  def: ComponentDef<S, M, E, D>,
  initialState?: S,
): string {
  const { nodes, inst } = renderNodes(def, initialState)
  return serializeNodes(nodes, inst.allBindings)
}

function nodeToStringWithMarkers(node: Node, bindingNodes: Set<Node>): string {
  if (node.nodeType === 3) {
    return escapeHtml(node.textContent ?? '')
  }
  if (node.nodeType === 8) {
    return `<!--${node.textContent ?? ''}-->`
  }
  if (node.nodeType === 1) {
    const el = node as Element
    return elementToString(el, bindingNodes)
  }
  return ''
}

function elementToString(el: Element, bindingNodes: Set<Node>): string {
  const tag = el.tagName.toLowerCase()
  let attrs = ''

  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i]!
    // Skip event handler attributes
    if (attr.name.startsWith('on')) continue
    attrs += ` ${attr.name}="${escapeAttr(attr.value)}"`
  }

  // Add hydrate marker if this element or any of its text children have bindings
  if (bindingNodes.has(el)) {
    attrs += ' data-llui-hydrate'
  }

  // Void elements
  if (isVoidElement(tag)) {
    return `<${tag}${attrs} />`
  }

  let children = ''
  for (let i = 0; i < el.childNodes.length; i++) {
    children += nodeToStringWithMarkers(el.childNodes[i]!, bindingNodes)
  }

  return `<${tag}${attrs}>${children}</${tag}>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

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

function isVoidElement(tag: string): boolean {
  return VOID_ELEMENTS.has(tag)
}
