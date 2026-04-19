/**
 * Minimal DOM surface that `@llui/dom`'s internals depend on. Passed to
 * `mountApp` / `hydrateApp` / `renderToString` as a context object so
 * the runtime never reaches for `globalThis.document` directly.
 *
 * Why an injected shape instead of a global shim:
 *
 * 1. **Bundler-friendly.** A Cloudflare Worker that imports
 *    `@llui/dom/ssr/linkedom` reaches only linkedom via its module
 *    graph. No `await import('jsdom')` appears in reachable source,
 *    so rollup doesn't inline the 9 MiB jsdom bundle.
 * 2. **Concurrency-safe.** Two `renderToString` calls can pass
 *    different envs; no process-level singleton to collide on.
 * 3. **Strict-isolate safe.** No `globalThis[key] = ...` mutation —
 *    Cloudflare workerd and Deno strict modes forbid it.
 *
 * The surface is deliberately narrow: exactly the methods and
 * constructors the runtime touches. Grep `document\.` /
 * `instanceof (HTMLElement|Element|...)` inside `@llui/dom/src` for
 * the exhaustive set.
 */
export interface DomEnv {
  // ── Factories ────────────────────────────────────────────────────
  createElement(tag: string): Element
  createElementNS(ns: string, tag: string): Element
  createTextNode(text: string): Text
  createComment(text: string): Comment
  createDocumentFragment(): DocumentFragment
  /**
   * Used by `each()`'s fast clear/bulk-remove paths to delete a range
   * of siblings in one call. SSR adapters that don't need those paths
   * (jsdom + linkedom both do) can stub — the runtime tolerates a
   * missing range during SSR render, which never hits the bulk paths.
   */
  createRange(): Range

  // ── Node / element constructors ─────────────────────────────────
  // Exposed for `instanceof` checks in binding targeting + for any
  // rare site that needs to construct a node type directly.
  readonly Element: typeof Element
  readonly Node: typeof Node
  readonly Text: typeof Text
  readonly Comment: typeof Comment
  readonly DocumentFragment: typeof DocumentFragment
  readonly HTMLElement: typeof HTMLElement
  readonly HTMLTemplateElement: typeof HTMLTemplateElement
  readonly ShadowRoot: typeof ShadowRoot

  // ── Event constructor ───────────────────────────────────────────
  readonly MouseEvent: typeof MouseEvent

  /**
   * Parse an HTML fragment string into a `DocumentFragment`. Used by
   * `unsafeHtml()`. Browsers and jsdom parse via template-element
   * innerHTML; linkedom has its own fragment parser. Adapter chooses
   * the right mechanism.
   */
  parseHtmlFragment(html: string): DocumentFragment

  /**
   * Resolve a CSS selector against the env's root document. Used by
   * `portal()` to locate its target when `opts.target` is a string.
   *
   * Returns `null` when the selector doesn't match — portal callers
   * treat a null target as a no-op (render nothing), so adapters on
   * runtimes where no real document exists (detached linkedom, empty
   * shadow root, etc.) can safely return `null` here.
   *
   * Optional at the interface level so pre-existing consumer envs
   * constructed by hand continue to type-check; a portal call site
   * with a string target falls back to returning no nodes when the
   * method is absent.
   */
  querySelector?(selector: string): Element | null

  /**
   * @internal Lets hot-path code (e.g. `el-split.ts`'s template-clone)
   * skip env indirection when the env wraps the browser globals. Only
   * set by `browserEnv()`.
   */
  readonly isBrowser?: boolean
}

/**
 * Wrap the browser globals as a `DomEnv`. Used as the default env for
 * `mountApp` / `hydrateApp` on the client.
 *
 * The returned object delegates to `globalThis.document` / `globalThis.X`
 * lazily — evaluating `browserEnv()` on a server process before a DOM
 * exists is safe because the delegation only dereferences the globals
 * when a method is actually called.
 *
 * Never mutates `globalThis`. A process with no browser globals that
 * invokes one of the factory methods gets a `TypeError` / `ReferenceError`
 * at the call site — which is correct: you're trying to build DOM on a
 * runtime that has no DOM.
 */
export function browserEnv(): DomEnv {
  // Evaluate globals lazily through getters so module-load on a
  // DOM-less process doesn't throw. Hot client code is still cheap —
  // V8/SpiderMonkey inline the getter after the first call.
  return {
    createElement: (tag) => document.createElement(tag),
    createElementNS: (ns, tag) => document.createElementNS(ns, tag),
    createTextNode: (text) => document.createTextNode(text),
    createComment: (text) => document.createComment(text),
    createDocumentFragment: () => document.createDocumentFragment(),
    createRange: () => document.createRange(),
    get Element() {
      return Element
    },
    get Node() {
      return Node
    },
    get Text() {
      return Text
    },
    get Comment() {
      return Comment
    },
    get DocumentFragment() {
      return DocumentFragment
    },
    get HTMLElement() {
      return HTMLElement
    },
    get HTMLTemplateElement() {
      return HTMLTemplateElement
    },
    get ShadowRoot() {
      return ShadowRoot
    },
    get MouseEvent() {
      return MouseEvent
    },
    parseHtmlFragment: (html) => {
      const template = document.createElement('template')
      template.innerHTML = html
      return template.content
    },
    querySelector: (selector) => document.querySelector(selector),
    isBrowser: true,
  }
}
