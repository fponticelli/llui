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
    querySelector: (selector: string) => Element | null
  }
  Element: typeof Element
  Node: typeof Node
  Text: typeof Text
  Comment: typeof Comment
  DocumentFragment: typeof DocumentFragment
  HTMLElement: typeof HTMLElement
  HTMLTemplateElement: typeof HTMLTemplateElement
  HTMLSelectElement: typeof HTMLSelectElement
  ShadowRoot: typeof ShadowRoot
  MouseEvent: typeof MouseEvent
}

// Tracks whether we've installed the HTMLSelectElement.value setter
// patch for a given prototype. Linkedom instances share prototype
// objects across `parseHTML` calls, so the patch only needs to run
// once per prototype — the WeakSet key keeps it idempotent without
// scanning existing descriptors on every linkedomEnv() call.
const patchedSelectProtos = new WeakSet<object>()

/**
 * Linkedom's `HTMLSelectElement.prototype.value` is a get-only accessor
 * — assigning `select.value = 'foo'` throws
 * `TypeError: Cannot set property value of [object Object] which has
 * only a getter`. LLui's reactive attribute bindings call the IDL
 * setter at render time to mirror the matching `<option selected>`,
 * which is standard on jsdom and real browsers.
 *
 * We install a setter that walks child `<option>`s and toggles the
 * `selected` attribute to match the requested value. Matching
 * semantics follow the HTML spec: compare against `option.value`
 * (which falls back to `option.textContent` when no explicit `value`
 * attribute is set). The getter mirrors this lookup so round-trips
 * (`set` then `get`) are consistent.
 *
 * Idempotent — safe to call on every `linkedomEnv()`.
 */
function patchSelectValueSetter(w: LinkedomWindow): void {
  if (!w.HTMLSelectElement) return
  const proto: object = w.HTMLSelectElement.prototype
  if (patchedSelectProtos.has(proto)) return
  const existing = Object.getOwnPropertyDescriptor(proto, 'value')
  if (existing?.set) {
    patchedSelectProtos.add(proto)
    return
  }
  Object.defineProperty(proto, 'value', {
    configurable: true,
    get(this: Element) {
      const sel = this.querySelector('option[selected]')
      return sel?.getAttribute('value') ?? sel?.textContent ?? ''
    },
    set(this: Element, v: unknown) {
      const target = String(v)
      const options = this.querySelectorAll('option')
      for (let i = 0; i < options.length; i++) {
        const opt = options[i]!
        const ov = opt.getAttribute('value') ?? opt.textContent ?? ''
        if (ov === target) opt.setAttribute('selected', '')
        else opt.removeAttribute('selected')
      }
    },
  })
  patchedSelectProtos.add(proto)
}

/**
 * Construct a `DomEnv` backed by a fresh linkedom instance. Each call
 * returns a new env — no process-level state, safe under concurrency
 * and compatible with Cloudflare Workers.
 *
 * Requires `linkedom` as an installed dependency.
 */
export async function linkedomEnv(): Promise<DomEnv> {
  // Dynamic import — linkedom is an optional peer dependency. Its own
  // declarations type `parseHTML` as returning `Window & typeof globalThis`,
  // which structurally satisfies the narrow `LinkedomWindow` surface this
  // adapter reads — so the annotation below is checked, not asserted.
  const { parseHTML } = await import('linkedom')
  const w: LinkedomWindow = parseHTML('<!DOCTYPE html><html><body></body></html>')
  patchSelectValueSetter(w)

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
