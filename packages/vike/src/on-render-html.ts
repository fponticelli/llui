import { renderToString } from '@llui/dom'
import type { ComponentDef } from '@llui/dom'

export interface PageContext {
  Page: ComponentDef<unknown, unknown, unknown, unknown>
  data?: unknown
}

export async function onRenderHtml(pageContext: PageContext): Promise<{
  documentHtml: string
  pageContext: { lluiState: unknown }
}> {
  const { Page, data } = pageContext
  const [initialState] = Page.init(data)
  const html = renderToString(Page, initialState)
  const serializedState = JSON.stringify(initialState)

  return {
    documentHtml: `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /></head>
  <body>
    <div id="app">${html}</div>
    <script>window.__LLUI_STATE__ = ${serializedState}</script>
  </body>
</html>`,
    pageContext: { lluiState: initialState },
  }
}
