import { createOnRenderHtml } from '@llui/vike/server'
import type { PageContext } from '@llui/vike/server'
import { jsdomEnv } from '@llui/dom/ssr/jsdom'
import { AppLayout } from './Layout'
import { DashboardLayout } from './dashboard/Layout'

/**
 * Server-side render hook. Same chain resolver as +onRenderClient.ts —
 * the server and the client must agree on which layout chain applies
 * to each route, otherwise hydration would mismatch and throw.
 */
export const onRenderHtml = createOnRenderHtml({
  domEnv: jsdomEnv,
  Layout: (pageContext: PageContext) => {
    const path = (pageContext as unknown as { urlPathname?: string }).urlPathname ?? '/'
    if (path.startsWith('/dashboard')) return [AppLayout, DashboardLayout]
    return [AppLayout]
  },
  document: ({ html, state, head }) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LLui / Vike persistent-layout example</title>
    <link rel="stylesheet" href="/style.css" />
    ${head}
  </head>
  <body>
    <div id="app">${html}</div>
    <script>window.__LLUI_STATE__ = ${state}</script>
  </body>
</html>`,
})
