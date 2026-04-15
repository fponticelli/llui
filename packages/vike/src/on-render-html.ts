import { renderNodes, serializeNodes } from '@llui/dom'
import type { ComponentDef, Binding, Scope } from '@llui/dom'
import { _consumePendingSlot, _resetPendingSlot } from './page-slot.js'

type AnyComponentDef = ComponentDef<unknown, unknown, unknown, unknown>
type LayoutChain = ReadonlyArray<AnyComponentDef>

/**
 * Page context shape as seen by `@llui/vike`'s server hook. `Page` and
 * `data` are whichever `+Page.ts` and `+data.ts` Vike resolved for the
 * current route; `lluiLayoutData` is an optional array of per-layer
 * layout data matching the chain configured on `createOnRenderHtml`.
 */
export interface PageContext {
  Page: AnyComponentDef
  data?: unknown
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
 * Default onRenderHtml hook — no layout, minimal document template.
 */
export async function onRenderHtml(pageContext: PageContext): Promise<RenderHtmlResult> {
  return renderPage(pageContext, {})
}

/**
 * Factory to create a customized onRenderHtml hook.
 *
 * ```ts
 * // pages/+onRenderHtml.ts
 * import { createOnRenderHtml } from '@llui/vike/server'
 * import { AppLayout } from './+Layout'
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
  // Lazy-import to keep jsdom out of the client bundle's dependency graph
  const { initSsrDom } = await import('@llui/dom/ssr')
  await initSsrDom()

  const layoutChain = resolveLayoutChain(options.Layout, pageContext)
  const layoutData = pageContext.lluiLayoutData ?? []

  // Full chain: every layout, then the page. Always at least one entry
  // (the page) since Vike's pageContext always has a Page.
  const chain: LayoutChain = [...layoutChain, pageContext.Page]
  const chainData: readonly unknown[] = [...layoutData, pageContext.data]

  const { html, envelope } = renderChain(chain, chainData)

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
 * `pageSlot()` registration and append the next layer's nodes into
 * the slot marker. Scopes are threaded so inner layers inherit the
 * outer layer's scope tree for context lookups.
 */
function renderChain(
  chain: LayoutChain,
  chainData: readonly unknown[],
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
  let currentSlotMarker: HTMLElement | null = null
  let currentSlotScope: Scope | undefined = undefined

  for (let i = 0; i < chain.length; i++) {
    const def = chain[i]!
    const layerData = chainData[i]
    const isInnermost = i === chain.length - 1

    // Resolve the initial state from the layer's own init() applied to
    // its data slice, same as client-side mountApp(). renderNodes takes
    // the state post-init so that the view sees the right fields.
    const [initialState] = def.init(layerData)

    const { nodes, inst } = renderNodes(def, initialState, currentSlotScope)
    allBindings.push(...inst.allBindings)

    if (i === 0) {
      outermostNodes = nodes
    } else {
      // Append this layer's nodes into the previous layer's slot marker.
      // The slot marker is an element owned by the previous layer's DOM;
      // appending here stitches this layer into the composed tree so
      // the final serialization pass emits one integrated HTML string.
      if (!currentSlotMarker) {
        // Unreachable given the error checks below, but defensive.
        throw new Error(`[llui/vike] internal: chain layer ${i} (<${def.name}>) has no slot marker`)
      }
      for (const node of nodes) {
        currentSlotMarker.appendChild(node)
      }
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

    currentSlotMarker = slot?.marker ?? null
    currentSlotScope = slot?.slotScope
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
