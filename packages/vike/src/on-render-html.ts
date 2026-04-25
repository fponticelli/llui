import { renderNodes, serializeNodes } from '@llui/dom'
import type { AnyComponentDef, Binding, Lifetime, DomEnv } from '@llui/dom'
import { _consumePendingSlot, _resetPendingSlot } from './page-slot.js'
import type { VikePageContextData } from './vike-namespace.js'

type LayoutChain = ReadonlyArray<AnyComponentDef>

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
 */
export interface PageContext {
  Page: AnyComponentDef
  data?: VikePageContextData
  lluiLayoutData?: readonly unknown[]
  head?: string
}

export interface DocumentContext {
  /** Rendered component HTML (layout + page composed if a Layout is configured) */
  html: string
  /** JSON-serialized hydration envelope (chain-aware when Layout is configured) */
  state: string
  /** Head content from pageContext.head (e.g. from +Head.ts) */
  head: string
  /** Full page context for custom logic */
  pageContext: PageContext
}

export interface RenderHtmlResult {
  documentHtml: string | { _escaped: string }
  pageContext: { lluiState: unknown }
}

const DEFAULT_DOCUMENT = ({ html, state, head }: DocumentContext): string => `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    ${head}
  </head>
  <body>
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
   * - A single `ComponentDef` — becomes a one-layout chain.
   * - An array of `ComponentDef`s — outermost first, innermost last.
   *   Every layer except the innermost must call `pageSlot()` in its view.
   * - A function that returns a chain from the current `pageContext` —
   *   enables per-route chains (e.g. reading Vike's `urlPathname`).
   *
   * The server renders the full chain as one composed HTML tree. Client
   * hydration reads the matching envelope and reconstructs the chain
   * layer-by-layer.
   */
  Layout?: AnyComponentDef | LayoutChain | ((pageContext: PageContext) => LayoutChain)

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

function resolveLayoutChain(
  layoutOption: RenderHtmlOptions['Layout'],
  pageContext: PageContext,
): LayoutChain {
  if (!layoutOption) return []
  if (typeof layoutOption === 'function') {
    return layoutOption(pageContext) ?? []
  }
  if (Array.isArray(layoutOption)) return layoutOption
  return [layoutOption as AnyComponentDef]
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
 * Hydration envelope emitted into `window.__LLUI_STATE__`. Chain-aware
 * by default — every layer (layouts + page) is represented by its own
 * entry, keyed by component name so server/client mismatches fail loud.
 */
interface HydrationEnvelope {
  layouts: Array<{ name: string; state: unknown }>
  page: { name: string; state: unknown }
}

async function renderPage(
  pageContext: PageContext,
  options: RenderHtmlOptions,
): Promise<RenderHtmlResult> {
  const env = await options.domEnv()

  const layoutChain = resolveLayoutChain(options.Layout, pageContext)
  const layoutData = pageContext.lluiLayoutData ?? []

  // Full chain: every layout, then the page. Always at least one entry
  // (the page) since Vike's pageContext always has a Page.
  const chain: LayoutChain = [...layoutChain, pageContext.Page]
  const chainData: readonly unknown[] = [...layoutData, pageContext.data]

  const { html, envelope } = _renderChain(chain, chainData, env)

  const document = options.document ?? DEFAULT_DOCUMENT
  const head = pageContext.head ?? ''
  const state = JSON.stringify(envelope)
  const documentHtml = document({ html, state, head, pageContext })

  return {
    // Vike's dangerouslySkipEscape format — the document template is
    // trusted (authored by the developer, not user input)
    documentHtml: { _escaped: documentHtml },
    pageContext: { lluiState: envelope },
  }
}

/**
 * Render every layer of the chain into one composed DOM tree, then
 * serialize. At each non-innermost layer, consume the pending
 * `pageSlot()` registration and insert the next layer's nodes as
 * siblings after the anchor comment, bracketed by an end sentinel.
 * Scopes are threaded so inner layers inherit the outer layer's scope
 * tree for context lookups.
 *
 * @internal — exported for unit testing only (`_renderChain`).
 */
export function _renderChain(
  chain: LayoutChain,
  chainData: readonly unknown[],
  env: DomEnv,
): { html: string; envelope: HydrationEnvelope } {
  if (chain.length === 0) {
    throw new Error('[llui/vike] renderChain called with empty chain')
  }

  // Defensive: ensure no stale slot leaks in from a prior failed render.
  _resetPendingSlot()

  // Accumulate bindings from every layer — serializeNodes needs the
  // full set so hydrate markers are correctly placed across the
  // composed tree.
  const allBindings: Binding[] = []
  const envelopeLayouts: HydrationEnvelope['layouts'] = []
  let envelopePage: HydrationEnvelope['page'] | null = null

  let outermostNodes: Node[] = []
  let currentSlotAnchor: Comment | null = null
  let currentSlotScope: Lifetime | undefined = undefined

  for (let i = 0; i < chain.length; i++) {
    const def = chain[i]!
    const layerData = chainData[i]
    const isInnermost = i === chain.length - 1

    // Resolve the initial state from the layer's own init() applied to
    // its data slice, same as client-side mountApp(). renderNodes takes
    // the state post-init so that the view sees the right fields.
    const [initialState] = def.init(layerData)

    // Cross from type-erased AnyComponentDef into the concrete signature
    // renderNodes expects. Same pattern as the client mount path —
    // renderNodes is generic but the runtime doesn't use the type params.
    const { nodes, inst } = renderNodes(
      def as unknown as Parameters<typeof renderNodes>[0],
      initialState,
      env,
      currentSlotScope,
    )
    allBindings.push(...inst.allBindings)

    if (i === 0) {
      outermostNodes = nodes
    } else {
      // Insert this layer's nodes as siblings immediately after the
      // anchor comment, then place an end sentinel after them.
      // The anchor is already attached to the composed DOM tree (it was
      // produced by the previous layer's pageSlot() call). We insert
      // before the anchor's next sibling so nodes land right after the
      // anchor, preserving any trailing siblings that may exist.
      if (!currentSlotAnchor) {
        // Unreachable given the error checks below, but defensive.
        throw new Error(`[llui/vike] internal: chain layer ${i} (<${def.name}>) has no slot anchor`)
      }
      const parentNode = currentSlotAnchor.parentNode
      if (!parentNode) {
        throw new Error(
          `[llui/vike] internal: slot anchor for layer ${i} (<${def.name}>) is detached`,
        )
      }
      // insertPoint is the node currently after the anchor; inserting
      // before it keeps all new nodes in order immediately after anchor.
      const insertPoint = currentSlotAnchor.nextSibling
      for (const node of nodes) {
        parentNode.insertBefore(node, insertPoint)
      }
      // Synthesize an end sentinel that brackets the owned region.
      const endSentinel = env.createComment('llui-mount-end')
      parentNode.insertBefore(endSentinel, insertPoint)
    }

    // Record this layer's state in the envelope. Page goes under
    // `page`, everything else under `layouts[]` ordered outer-to-inner.
    if (isInnermost) {
      envelopePage = { name: def.name, state: initialState }
    } else {
      envelopeLayouts.push({ name: def.name, state: initialState })
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
    currentSlotScope = slot?.slotLifetime
  }

  const html = serializeNodes(outermostNodes, allBindings)

  if (envelopePage === null) {
    // Unreachable — chain is non-empty so the last iteration sets this.
    throw new Error('[llui/vike] internal: renderChain produced no page entry')
  }

  return {
    html,
    envelope: {
      layouts: envelopeLayouts,
      page: envelopePage,
    },
  }
}
