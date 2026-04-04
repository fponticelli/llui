/**
 * SSR entry point — renders the initial page to HTML string.
 * Uses jsdom to provide a DOM environment on the server.
 */
import { JSDOM } from 'jsdom'
import { renderToString } from '@llui/dom'
import { appDef, initialState } from './app'

// Provide a minimal DOM environment for renderToString
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
const g = globalThis as Record<string, unknown>
g.document = dom.window.document
g.HTMLElement = dom.window.HTMLElement
g.Element = dom.window.Element
g.Node = dom.window.Node
g.Text = dom.window.Text
g.Comment = dom.window.Comment
g.MouseEvent = dom.window.MouseEvent
g.ShadowRoot = dom.window.ShadowRoot

export function render(url: string): { html: string; state: string } {
  const state = initialState(url)
  const html = renderToString(appDef, state)
  return {
    html,
    state: JSON.stringify(state),
  }
}
