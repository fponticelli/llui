import { createOnRenderHtml } from '@llui/vike'

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export const onRenderHtml = createOnRenderHtml({
  document: ({ html, state, pageContext }) => {
    const data = (pageContext as { data?: { title?: string; description?: string } }).data
    const title = data?.title
      ? `${data.title} — LLui`
      : 'LLui — Compile-time optimized web framework'
    const description =
      data?.description ??
      'A compile-time-optimized web framework built on The Elm Architecture.'

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeAttr(description)}" />
    <meta property="og:title" content="${escapeAttr(title)}" />
    <meta property="og:description" content="${escapeAttr(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://llui.dev" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div id="app">${html}</div>
    <script>window.__LLUI_STATE__ = ${state}</script>
  </body>
</html>`
  },
})
