import { renderNodes, serializeNodes } from '@llui/dom'
import type { Renderable } from '@llui/dom'
import type { DomEnv } from '@llui/dom/ssr'
import { _consumePendingSlot, _resetPendingSlot } from './page-slot.js'
import type { VikePageContextData } from './vike-namespace.js'

/**
 * A type-erased signal component as the adapter sees it. Layouts and pages are
 * `SignalComponentDef<S, M, E>` for concrete S/M/E; the adapter handles them
 * uniformly with the type params erased — the runtime doesn't use them. Unlike
 * the legacy `ComponentDef`, the signal `init()` takes NO data argument, so
 * per-layer data flows in as a seed-STATE override (see `renderPage`).
 */
/**
 * Type-erased layer def at the adapter boundary. Declared with METHOD syntax and
 * a single `unknown` view-bag param so a concrete `SignalComponentDef<S,M,E>`
 * assigns in for ANY S/M/E — `SignalComponentDef<unknown,unknown,unknown>` can't
 * be that erasure, because `view(bag: ComponentBag<S,M>)` couples covariant
 * `state` with contravariant `send` and neither variance direction admits a
 * heterogeneous chain. This interface is itself assignable to
 * `SignalComponentDef<unknown,unknown,unknown>`, so `renderNodes(layer)` type-
 * checks. Mirrors the legacy `AnyComponentDef`.
 */
export interface AnyLayer {
  readonly name?: string
  init(): unknown
  update(state: unknown, msg: unknown): unknown
  view(bag: unknown): Renderable
  onEffect?(effect: unknown, api: unknown): void | (() => void)
}

type LayoutChain = ReadonlyArray<AnyLayer>

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
   * - A single `SignalComponentDef` — becomes a one-layout chain.
   * - An array of `SignalComponentDef`s — outermost first, innermost last.
   *   Every layer except the innermost must call `pageSlot()` in its view.
   * - A function that returns a chain from the current `pageContext` —
   *   enables per-route chains (e.g. reading Vike's `urlPathname`).
   *
   * The server renders the full chain as one composed HTML tree. Client
   * hydration reads the matching envelope and reconstructs the chain
   * layer-by-layer.
   */
  Layout?: AnyLayer | LayoutChain | ((pageContext: PageContext) => LayoutChain)

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
  return [layoutOption as AnyLayer]
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

/** Resolve a layer's seed state. In the signal runtime `init()` takes no data,
 * so a present data slice IS the seed state; an absent slice falls back to the
 * layer's own `init()` (renderNodes does this when given `undefined`). */
function seedFor(data: unknown): unknown | undefined {
  return data === undefined ? undefined : data
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
): { html: string; envelope: HydrationEnvelope } {
  if (chain.length === 0) {
    throw new Error('[llui/vike] renderChain called with empty chain')
  }

  // Defensive: ensure no stale slot leaks in from a prior failed render.
  _resetPendingSlot()

  const envelopeLayouts: HydrationEnvelope['layouts'] = []
  let envelopePage: HydrationEnvelope['page'] | null = null

  let outermostNodes: readonly Node[] = []
  const disposers: Array<() => void> = []
  let currentSlotAnchor: Comment | null = null
  let currentSlotContexts: ReadonlyMap<symbol, unknown> | undefined = undefined

  for (let i = 0; i < chain.length; i++) {
    const def = chain[i]!
    const layerData = chainData[i]
    const isInnermost = i === chain.length - 1

    // Build this layer's tree against the server DomEnv. Per-layer data is the
    // seed state (signal init() takes no data); contexts captured at the parent
    // layer's pageSlot() are replayed so providers above the slot reach here.
    const { nodes, dispose } = renderNodes(def, seedFor(layerData), env, currentSlotContexts)
    disposers.push(dispose)

    if (i === 0) {
      outermostNodes = nodes
    } else {
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
      // Insert this layer's nodes immediately after the anchor, then an end
      // sentinel — preserving any trailing siblings of the anchor.
      const insertPoint = currentSlotAnchor.nextSibling
      for (const node of nodes) {
        parentNode.insertBefore(node, insertPoint)
      }
      const endSentinel = env.createComment('llui-mount-end')
      parentNode.insertBefore(endSentinel, insertPoint)
    }

    // Record this layer's seed state in the envelope. Page goes under `page`,
    // everything else under `layouts[]` ordered outer-to-inner.
    const layerState = seedFor(layerData) ?? normalizeInitState(def)
    if (isInnermost) {
      envelopePage = { name: def.name ?? 'Page', state: layerState }
    } else {
      envelopeLayouts.push({ name: def.name ?? 'Layout', state: layerState })
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

  // Dispose every layer's build now that the composed tree is serialized.
  for (const d of disposers) d()

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

/** The seed state a layer's `init()` produces (used for the envelope when no
 * data slice overrides it). `init()` may return `S` or `[S, E[]]`. */
function normalizeInitState(def: AnyLayer): unknown {
  const r = def.init()
  if (Array.isArray(r) && r.length === 2 && Array.isArray((r as [unknown, unknown[]])[1])) {
    return (r as [unknown, unknown[]])[0]
  }
  return r
}
