import { renderToString } from '@llui/dom'
import type { ComponentDef } from '@llui/dom'

export interface PageContext {
  Page: ComponentDef<unknown, unknown, unknown, unknown>
  data?: unknown
  head?: string
}

export interface DocumentContext {
  /** Rendered component HTML */
  html: string
  /** JSON-serialized initial state */
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
 * Default onRenderHtml hook for simple cases.
 * Uses a minimal HTML document template.
 */
export async function onRenderHtml(pageContext: PageContext): Promise<RenderHtmlResult> {
  return renderPage(pageContext, DEFAULT_DOCUMENT)
}

/**
 * Factory to create a customized onRenderHtml hook.
 *
 * ```typescript
 * // pages/+onRenderHtml.ts
 * import { createOnRenderHtml } from '@llui/vike'
 *
 * export const onRenderHtml = createOnRenderHtml({
 *   document: ({ html, state, head }) => `<!DOCTYPE html>
 *     <html>
 *       <head>${head}<link rel="stylesheet" href="/styles.css" /></head>
 *       <body><div id="app">${html}</div>
 *       <script>window.__LLUI_STATE__ = ${state}</script></body>
 *     </html>`,
 * })
 * ```
 */
export function createOnRenderHtml(options: {
  document: (ctx: DocumentContext) => string
}): (pageContext: PageContext) => Promise<RenderHtmlResult> {
  return (pageContext) => renderPage(pageContext, options.document)
}

async function renderPage(
  pageContext: PageContext,
  document: (ctx: DocumentContext) => string,
): Promise<RenderHtmlResult> {
  // Lazy-import to keep jsdom out of the client bundle's dependency graph
  const { initSsrDom } = await import('@llui/dom/ssr')
  await initSsrDom()

  const { Page, data } = pageContext
  const [initialState] = Page.init(data)
  const html = renderToString(Page, initialState)
  const state = JSON.stringify(initialState)
  const head = pageContext.head ?? ''

  const documentHtml = document({ html, state, head, pageContext })

  return {
    // Use Vike's dangerouslySkipEscape format — the document template
    // is trusted (authored by the developer, not user input)
    documentHtml: { _escaped: documentHtml },
    pageContext: { lluiState: initialState },
  }
}
