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
interface JsdomDocument {
  createElement: (tag: string) => Element
  createElementNS: (ns: string, tag: string) => Element
  createTextNode: (text: string) => Text
  createComment: (text: string) => Comment
  createDocumentFragment: () => DocumentFragment
  createRange: () => Range
  querySelector: (selector: string) => Element | null
}

interface JsdomWindow {
  document: JsdomDocument & {
    implementation: { createHTMLDocument: (title?: string) => JsdomDocument }
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

// One JSDOM window per process, created lazily on first use. Constructing a
// `new JSDOM(...)` is expensive (~1-5ms + megabytes of parser/window state);
// doing it per SSR request wasted that on every render. We instead share a
// single window's CONSTRUCTORS and mint a fresh, empty `Document` per call via
// `implementation.createHTMLDocument` — a cheap operation that still gives each
// request an isolated node tree (no cross-request node sharing). The promise is
// cached (not just the window) so concurrent first calls don't each build a
// window.
let windowPromise: Promise<JsdomWindow> | null = null

function jsdomWindow(): Promise<JsdomWindow> {
  if (!windowPromise) {
    windowPromise = (async () => {
      // @ts-expect-error — jsdom is an optional peer dependency, not typed
      const jsdomMod = await import('jsdom')
      const { JSDOM } = jsdomMod as { JSDOM: new (html: string) => { window: JsdomWindow } }
      return new JSDOM('<!DOCTYPE html><html><body></body></html>').window
    })()
  }
  return windowPromise
}

/**
 * Construct a `DomEnv` backed by jsdom. The heavyweight jsdom window is created
 * once per process and shared; each call mints a FRESH document from it, so the
 * returned env has its own isolated node tree (no cross-request node sharing)
 * while reusing the window's constructors — a fraction of the per-call cost of a
 * full `new JSDOM(...)`.
 *
 * Requires `jsdom` as an installed dependency. If you don't want the
 * jsdom bundle (e.g. on Cloudflare Workers), use `linkedomEnv()` from
 * `@llui/dom/ssr/linkedom` instead.
 */
export async function jsdomEnv(): Promise<DomEnv> {
  const w = await jsdomWindow()
  // Fresh, empty document per call — shares the window (and its constructors)
  // but owns a distinct node tree, so requests never see each other's nodes.
  const doc = w.document.implementation.createHTMLDocument('')

  return {
    createElement: (tag) => doc.createElement(tag),
    createElementNS: (ns, tag) => doc.createElementNS(ns, tag),
    createTextNode: (text) => doc.createTextNode(text),
    createComment: (text) => doc.createComment(text),
    createDocumentFragment: () => doc.createDocumentFragment(),
    createRange: () => doc.createRange(),
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
      const template = doc.createElement('template') as HTMLTemplateElement
      template.innerHTML = html
      return template.content
    },
    querySelector: (selector) => doc.querySelector(selector),
  }
}
