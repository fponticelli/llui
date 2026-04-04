import type { ComponentDef } from './types'
import { createComponentInstance } from './update-loop'
import { setRenderContext, clearRenderContext } from './render-context'
import { setFlatBindings } from './binding'

/**
 * Render a component to an HTML string for SSR.
 * Evaluates view() against the initial state (or provided data),
 * serializes the DOM to HTML, and adds data-llui-hydrate markers
 * on nodes with reactive bindings.
 *
 * Call initSsrDom() once before using this on the server.
 */
export function renderToString<S, M, E>(
  def: ComponentDef<S, M, E>,
  initialState?: S,
): string {
  const inst = createComponentInstance(def)
  if (initialState !== undefined) {
    inst.state = initialState
  }

  setFlatBindings(inst.allBindings)
  setRenderContext({ ...inst, send: inst.send as (msg: unknown) => void })
  const nodes = def.view(inst.state, inst.send)
  clearRenderContext()
  setFlatBindings(null)

  // Serialize nodes to HTML
  let html = ''
  for (const node of nodes) {
    html += nodeToString(node)
  }

  // Collect elements that need hydrate markers (bindings on them or their text children)
  const hydrateElements = new Set<Node>()
  for (const binding of inst.allBindings) {
    const node = binding.node
    if (node.nodeType === 1) {
      hydrateElements.add(node)
    } else if (node.parentNode && node.parentNode.nodeType === 1) {
      hydrateElements.add(node.parentNode)
    }
  }

  // Re-serialize with markers
  html = ''
  for (const node of nodes) {
    html += nodeToStringWithMarkers(node, hydrateElements)
  }

  return html
}

function nodeToString(node: Node): string {
  if (node.nodeType === 3) {
    return escapeHtml(node.textContent ?? '')
  }
  if (node.nodeType === 8) {
    return `<!--${node.textContent ?? ''}-->`
  }
  if (node.nodeType === 1) {
    const el = node as Element
    return elementToString(el, false, new Set())
  }
  return ''
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
    return elementToString(el, true, bindingNodes)
  }
  return ''
}

function elementToString(el: Element, withMarkers: boolean, bindingNodes: Set<Node>): string {
  const tag = el.tagName.toLowerCase()
  let attrs = ''

  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i]!
    // Skip event handler attributes
    if (attr.name.startsWith('on')) continue
    attrs += ` ${attr.name}="${escapeAttr(attr.value)}"`
  }

  // Add hydrate marker if this element or any of its text children have bindings
  if (withMarkers && bindingNodes.has(el)) {
    attrs += ' data-llui-hydrate'
  }

  // Void elements
  if (isVoidElement(tag)) {
    return `<${tag}${attrs} />`
  }

  let children = ''
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes[i]!
    if (withMarkers) {
      children += nodeToStringWithMarkers(child, bindingNodes)
    } else {
      children += nodeToString(child)
    }
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
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

function isVoidElement(tag: string): boolean {
  return VOID_ELEMENTS.has(tag)
}
