import { renderNodes, serializeNodes, collectHeadSink, mergeStaticHead, HEAD_SINK } from '@llui/dom'
import type { CollectedHead } from '@llui/dom'
import type { DomEnv } from '@llui/dom/ssr'
import { _consumePendingSlot, _resetPendingSlot } from './page-slot.js'
import type { VikePageContextData } from './vike-namespace.js'
import {
  resolveLayoutChain as resolveChain,
  buildManifest,
  seedFor,
  type AnyLayer,
  type LayoutChain,
  type LayoutOption,
  type HydrationManifest,
} from './chain.js'
import { toDocumentHtml, type DangerousHtml } from './document-html.js'

export type { AnyLayer } from './chain.js'

/**
 * Page context shape as seen by `@llui/vike`'s server hook. `Page` and
 * `data` are whichever `+Page.ts` and `+data.ts` Vike resolved for the
 * current route; `lluiLayoutData` is an optional array of per-layer
 * layout data matching the chain configured on `createOnRenderHtml`.
 *
 * `data` is derived from the global `Vike.PageContext` namespace so that
 * consumer-side augmentations (the Vike convention for typing data) flow
 * into this hook's callbacks without any cast. When the consumer hasn't
 * augmented the namespace, `data` falls back to `unknown`.
 *
 * In the signal runtime a component's `init()` takes no data argument, so
 * each layer's `data` slice is used directly as that layer's seed STATE
 * when present; when absent, the layer's own `init()` provides the seed.
 */
export interface PageContext {
  Page: AnyLayer
  data?: VikePageContextData

  /**
   * Vike's resolved pathname for the current route (origin-, query- and
   * hash-stripped, e.g. `/docs/getting-started`). Vike always populates this on
   * the live pageContext; it's optional here only because not every test/SSR
   * construction site supplies it. Inside a `Layout` resolver it is guaranteed
   * present — see {@link ServerLayoutResolverContext}.
   */
  urlPathname?: string

  /**
   * Vike's route params for the current route (e.g. `{ slug: 'intro' }` for a
   * `/docs/@slug` route). Empty object when the matched route has no params.
   * Guaranteed present inside a `Layout` resolver — see
   * {@link ServerLayoutResolverContext}.
   */
  routeParams?: Record<string, string>

  lluiLayoutData?: readonly unknown[]
  head?: string
}

/**
 * The pageContext a server-side `Layout` **resolver function** receives.
 * Identical to {@link PageContext} except Vike's routing fields (`urlPathname`,
 * `routeParams`) are guaranteed present — the resolver only runs against a live
 * page render, which always populates them. Mirrors the client's
 * `LayoutResolverContext` so a single route-scoped resolver branches the same
 * way on both sides, keeping the server-rendered chain in lockstep with the
 * chain the client hydrates.
 */
export type ServerLayoutResolverContext = PageContext &
  Required<Pick<PageContext, 'urlPathname' | 'routeParams'>>

export interface DocumentContext {
  /** Rendered component HTML (layout + page composed if a Layout is configured) */
  html: string
  /** JSON-serialized hydration envelope (chain-aware when Layout is configured) */
  state: string
  /** Head content: static `pageContext.head` (e.g. from +Head.ts) merged with the
   * head collected from `title`/`meta`/`link` primitives in the render tree
   * (component entries override colliding static tags). */
  head: string
  /** Attribute string for the `<html>` tag (leading space included), from
   * `htmlAttr(...)` primitives. Interpolate as `<html${htmlAttrs}>`. */
  htmlAttrs: string
  /** Attribute string for the `<body>` tag (leading space included), from
   * `bodyAttr(...)` primitives. Interpolate as `<body${bodyAttrs}>`. */
  bodyAttrs: string
  /** Full page context for custom logic */
  pageContext: PageContext
}

export interface RenderHtmlResult {
  documentHtml: DangerousHtml
  pageContext: { lluiState: HydrationManifest }
}

const DEFAULT_DOCUMENT = ({
  html,
  state,
  head,
  htmlAttrs,
  bodyAttrs,
}: DocumentContext): string => `<!DOCTYPE html>
<html${htmlAttrs}>
  <head>
    <meta charset="utf-8" />
    ${head}
  </head>
  <body${bodyAttrs}>
    <div id="app">${html}</div>
    <script>window.__LLUI_STATE__ = ${state}</script>
  </body>
</html>`

/**
 * Options for the customized `createOnRenderHtml` factory. Mirrors
 * `@llui/vike/client`'s `RenderClientOptions.Layout` — the same chain
 * shape is accepted for consistency between server and client render.
 */
export interface RenderHtmlOptions {
  /** Custom HTML document template. Defaults to a minimal layout. */
  document?: (ctx: DocumentContext) => string

  /**
   * Persistent layout chain. One of:
   *
   * - A single `SignalComponentDef` — becomes a one-layout chain.
   * - An array of `SignalComponentDef`s — outermost first, innermost last.
   *   Every layer except the innermost must call `pageSlot()` in its view.
   * - A function that returns a chain from the current `pageContext` —
   *   enables per-route chains (e.g. reading Vike's `urlPathname`).
   *
   * The server renders the full chain as one composed HTML tree. Client
   * hydration reads the matching manifest and reconstructs the chain
   * layer-by-layer.
   */
  Layout?: LayoutOption<ServerLayoutResolverContext>

  /**
   * Factory that returns the `DomEnv` backing SSR render. Call with
   * either `jsdomEnv` (from `@llui/dom/ssr/jsdom`) or `linkedomEnv`
   * (from `@llui/dom/ssr/linkedom`). The factory is invoked once per
   * page render, so each request gets a fresh DOM — safe under
   * concurrency, no `globalThis` mutation.
   *
   * On Cloudflare Workers use `linkedomEnv` — jsdom's transitive deps
   * (whatwg-url, tr46, punycode) don't resolve under workerd.
   *
   * @example
   * ```ts
   * import { jsdomEnv } from '@llui/dom/ssr/jsdom'
   * createOnRenderHtml({ Layout: MyLayout, domEnv: jsdomEnv })
   * ```
   */
  domEnv: () => DomEnv | Promise<DomEnv>
}

/**
 * Default onRenderHtml hook — no layout, minimal document template,
 * jsdom-backed DOM env. For Cloudflare Workers (no jsdom support) or
 * a custom layout / document, use `createOnRenderHtml({ domEnv, … })`
 * with `linkedomEnv` from `@llui/dom/ssr/linkedom`.
 *
 * The lazy import below keeps jsdom out of the client bundle —
 * Rollup's graph walker only pulls it when this server hook executes.
 */
export async function onRenderHtml(pageContext: PageContext): Promise<RenderHtmlResult> {
  const { jsdomEnv } = await import('@llui/dom/ssr/jsdom')
  return renderPage(pageContext, { domEnv: jsdomEnv })
}

/**
 * Factory to create a customized onRenderHtml hook.
 *
 * **Do not name your layout file `+Layout.ts`.** Vike reserves `+Layout`
 * for its own framework-adapter config (`vike-react` / `vike-vue` /
 * `vike-solid`) and will conflict with `@llui/vike`'s `Layout` option.
 * Name the file `Layout.ts`, `app-layout.ts`, or anywhere outside
 * `/pages` that Vike won't scan, and import it here by path.
 *
 * ```ts
 * // pages/+onRenderHtml.ts
 * import { createOnRenderHtml } from '@llui/vike/server'
 * import { AppLayout } from './Layout.js' // ← NOT './+Layout'
 *
 * export const onRenderHtml = createOnRenderHtml({
 *   Layout: AppLayout,
 *   document: ({ html, state, head }) => `<!DOCTYPE html>
 *     <html><head>${head}<link rel="stylesheet" href="/styles.css" /></head>
 *     <body><div id="app">${html}</div>
 *     <script>window.__LLUI_STATE__ = ${state}</script></body></html>`,
 * })
 * ```
 */
export function createOnRenderHtml(
  options: RenderHtmlOptions,
): (pageContext: PageContext) => Promise<RenderHtmlResult> {
  return (pageContext) => renderPage(pageContext, options)
}

/**
 * Serialize the hydration manifest for safe embedding inside an inline
 * `<script>` tag. `JSON.stringify` alone is NOT script-safe: a value
 * containing `</script>` (or `<!--`, `<script`) breaks out of the script
 * element, and the JSON-legal raw line separators U+2028 / U+2029 are invalid
 * inside a JS string literal. Escaping `<` to its `<` form neutralizes
 * every HTML-sensitive sequence while remaining valid JSON, since `<` never
 * appears in JSON syntax outside string contents. The manifest carries only
 * layer names (see chain.ts) — no state — but a component name is still data
 * and is escaped defensively.
 */
function serializeManifestForScript(manifest: HydrationManifest): string {
  return JSON.stringify(manifest)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

async function renderPage(
  pageContext: PageContext,
  options: RenderHtmlOptions,
): Promise<RenderHtmlResult> {
  const env = await options.domEnv()

  const layoutChain = resolveChain(options.Layout, pageContext as ServerLayoutResolverContext)
  const layoutData = pageContext.lluiLayoutData ?? []

  // Full chain: every layout, then the page. Always at least one entry
  // (the page) since Vike's pageContext always has a Page.
  const chain: LayoutChain = [...layoutChain, pageContext.Page]
  const chainData: readonly unknown[] = [...layoutData, pageContext.data]

  const { html, manifest, collectedHead } = _renderChain(chain, chainData, env)

  const document = options.document ?? DEFAULT_DOCUMENT
  // Static +Head.ts head, with component head merged in (components override
  // colliding title/meta so the document never carries two <title>s).
  const head = mergeStaticHead(pageContext.head ?? '', collectedHead)
  const state = serializeManifestForScript(manifest)
  const documentHtml = document({
    html,
    state,
    head,
    htmlAttrs: collectedHead.htmlAttrs,
    bodyAttrs: collectedHead.bodyAttrs,
    pageContext,
  })

  return {
    // The document template is trusted (authored by the developer, not user
    // input); mark it already-escaped via Vike's public `dangerouslySkipEscape`.
    documentHtml: await toDocumentHtml(documentHtml),
    pageContext: { lluiState: manifest },
  }
}

/**
 * Render every layer of the chain into one composed DOM tree, then
 * serialize. At each non-innermost layer, consume the pending
 * `pageSlot()` registration and insert the next layer's nodes as
 * siblings after the anchor comment, bracketed by an end sentinel.
 * Contexts provided above a slot are replayed into the nested layer's
 * build so they reach the nested page.
 *
 * @internal — exported for unit testing only (`_renderChain`).
 */
export function _renderChain(
  chain: LayoutChain,
  chainData: readonly unknown[],
  env: DomEnv,
): { html: string; manifest: HydrationManifest; collectedHead: CollectedHead } {
  if (chain.length === 0) {
    throw new Error('[llui/vike] renderChain called with empty chain')
  }

  // Defensive: ensure no stale slot leaks in from a prior failed render.
  _resetPendingSlot()

  // One head collector for the whole chain. Seeded into the outermost layer's
  // root contexts; pageSlot() captures it (it's in-scope), so it threads inward
  // to every nested layer's separate build/mount pass. Each request gets a fresh
  // collector — no cross-request shared state.
  const headSink = collectHeadSink()
  const rootContexts: ReadonlyMap<symbol, unknown> = new Map([[HEAD_SINK.id, headSink]])

  let outermostNodes: readonly Node[] = []
  // Collected up-front so a throw anywhere in the layer loop or the
  // serialization still runs EVERY layer's teardown (no leaked build state /
  // head writers on the error path).
  const disposers: Array<() => void> = []
  let currentSlotAnchor: Comment | null = null
  // Seed the outermost layer with the head collector; subsequent layers inherit
  // it via their parent's captured pageSlot() contexts.
  let currentSlotContexts: ReadonlyMap<symbol, unknown> | undefined = rootContexts

  try {
    for (let i = 0; i < chain.length; i++) {
      const def = chain[i]!
      const layerData = chainData[i]
      const isInnermost = i === chain.length - 1

      // Build this layer's tree against the server DomEnv. Per-layer data is the
      // seed state (signal init() takes no data) — the SINGLE init()/build for this
      // layer, so the HTML and any recorded seed can never disagree. Contexts
      // captured at the parent layer's pageSlot() are replayed so providers above
      // the slot reach here.
      const { nodes, dispose } = renderNodes(def, seedFor(layerData), env, currentSlotContexts)
      disposers.push(dispose)

      if (i === 0) {
        outermostNodes = nodes
      } else {
        if (!currentSlotAnchor) {
          // Unreachable given the error checks below, but defensive.
          throw new Error(
            `[llui/vike] internal: chain layer ${i} (<${def.name}>) has no slot anchor`,
          )
        }
        const parentNode = currentSlotAnchor.parentNode
        if (!parentNode) {
          throw new Error(
            `[llui/vike] internal: slot anchor for layer ${i} (<${def.name}>) is detached`,
          )
        }
        // Insert this layer's nodes immediately after the anchor, then an end
        // sentinel — preserving any trailing siblings of the anchor.
        const insertPoint = currentSlotAnchor.nextSibling
        for (const node of nodes) {
          parentNode.insertBefore(node, insertPoint)
        }
        const endSentinel = env.createComment('llui-mount-end')
        parentNode.insertBefore(endSentinel, insertPoint)
      }

      // Consume this layer's pending slot registration (if any). Every
      // non-innermost layer MUST declare a slot; the innermost MUST NOT.
      const slot = _consumePendingSlot()
      if (isInnermost && slot !== null) {
        throw new Error(
          `[llui/vike] <${def.name}> is the innermost component in the chain ` +
            `but called pageSlot(). pageSlot() only belongs in layout components.`,
        )
      }
      if (!isInnermost && slot === null) {
        throw new Error(
          `[llui/vike] <${def.name}> is a layout layer at depth ${i} but did not ` +
            `call pageSlot() in its view(). There are ${chain.length - i - 1} more ` +
            `layer(s) to mount and no slot to mount them into.`,
        )
      }

      currentSlotAnchor = slot?.anchor ?? null
      currentSlotContexts = slot?.contexts
    }

    const html = serializeNodes(outermostNodes)
    // Serialize collected head BEFORE disposing (dispose releases the writers).
    const collectedHead = headSink.serialize(env)

    return { html, manifest: buildManifest(chain), collectedHead }
  } finally {
    // Dispose every layer's build — on the success path after serialization, and
    // on ANY error path so a failed render never leaks build state or head writers.
    for (const d of disposers) d()
  }
}
