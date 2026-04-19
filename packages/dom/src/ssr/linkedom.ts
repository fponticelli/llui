/**
 * `@llui/dom/ssr/linkedom` — linkedom-backed `DomEnv` factory.
 *
 * Linkedom is a lightweight JSDOM alternative — smaller bundle, works
 * on Cloudflare Workers and other strict-isolate runtimes where jsdom's
 * transitive `whatwg-url` / `tr46` / `punycode` chain fails to resolve.
 */
import type { DomEnv } from '../dom-env.js'

// Linkedom exposes a `parseHTML` function that returns a window-like
// object with DOM constructors and a `document`. The exact shape is
// narrower than JSDOM's but matches the DomEnv surface we need.
interface LinkedomWindow {
  document: {
    createElement: (tag: string) => Element
    createElementNS: (ns: string, tag: string) => Element
    createTextNode: (text: string) => Text
    createComment: (text: string) => Comment
    createDocumentFragment: () => DocumentFragment
    createRange: () => Range
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
 * Construct a `DomEnv` backed by a fresh linkedom instance. Each call
 * returns a new env — no process-level state, safe under concurrency
 * and compatible with Cloudflare Workers.
 *
 * Requires `linkedom` as an installed dependency.
 */
export async function linkedomEnv(): Promise<DomEnv> {
  // @ts-expect-error — linkedom is an optional peer dependency, not typed
  const linkedomMod = await import('linkedom')
  const { parseHTML } = linkedomMod as {
    parseHTML: (html: string) => LinkedomWindow
  }
  const w = parseHTML('<!DOCTYPE html><html><body></body></html>')

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
  }
}
