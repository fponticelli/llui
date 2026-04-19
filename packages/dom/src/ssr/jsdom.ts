/**
 * `@llui/dom/ssr/jsdom` — jsdom-backed `DomEnv` factory.
 *
 * Only imports jsdom. Consumers who need a different DOM (linkedom,
 * happy-dom, custom) use the corresponding sub-entry or build their
 * own `DomEnv` by hand — neither route pulls jsdom into the bundle.
 */
import type { DomEnv } from '../dom-env.js'

// jsdom is an optional peer dependency. The typing below is just
// enough to construct the env; callers don't see the jsdom surface.
interface JsdomWindow {
  document: {
    createElement: (tag: string) => Element
    createElementNS: (ns: string, tag: string) => Element
    createTextNode: (text: string) => Text
    createComment: (text: string) => Comment
    createDocumentFragment: () => DocumentFragment
    createRange: () => Range
    querySelector: (selector: string) => Element | null
  }
  Element: typeof Element
  Node: typeof Node
  Text: typeof Text
  Comment: typeof Comment
  DocumentFragment: typeof DocumentFragment
  HTMLElement: typeof HTMLElement
  HTMLTemplateElement: typeof HTMLTemplateElement
  ShadowRoot: typeof ShadowRoot
  MouseEvent: typeof MouseEvent
}

/**
 * Construct a `DomEnv` backed by a fresh jsdom instance. Each call
 * returns a new env — no process-level state, safe under concurrency.
 *
 * Requires `jsdom` as an installed dependency. If you don't want the
 * jsdom bundle (e.g. on Cloudflare Workers), use `linkedomEnv()` from
 * `@llui/dom/ssr/linkedom` instead.
 */
export async function jsdomEnv(): Promise<DomEnv> {
  // @ts-expect-error — jsdom is an optional peer dependency, not typed
  const jsdomMod = await import('jsdom')
  const { JSDOM } = jsdomMod as { JSDOM: new (html: string) => { window: JsdomWindow } }
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
  const w = dom.window

  return {
    createElement: (tag) => w.document.createElement(tag),
    createElementNS: (ns, tag) => w.document.createElementNS(ns, tag),
    createTextNode: (text) => w.document.createTextNode(text),
    createComment: (text) => w.document.createComment(text),
    createDocumentFragment: () => w.document.createDocumentFragment(),
    createRange: () => w.document.createRange(),
    Element: w.Element,
    Node: w.Node,
    Text: w.Text,
    Comment: w.Comment,
    DocumentFragment: w.DocumentFragment,
    HTMLElement: w.HTMLElement,
    HTMLTemplateElement: w.HTMLTemplateElement,
    ShadowRoot: w.ShadowRoot,
    MouseEvent: w.MouseEvent,
    parseHtmlFragment: (html) => {
      const template = w.document.createElement('template') as HTMLTemplateElement
      template.innerHTML = html
      return template.content
    },
    querySelector: (selector) => w.document.querySelector(selector),
  }
}
