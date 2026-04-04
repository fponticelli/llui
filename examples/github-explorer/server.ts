/**
 * SSR dev server — renders the initial page server-side, then the
 * client hydrates the existing HTML instead of mounting fresh.
 *
 * Usage: npx tsx server.ts
 */
import { createServer } from 'vite'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const PORT = 5173

async function main() {
  const vite = await createServer({
    root: resolve(import.meta.dirname),
    server: { middlewareMode: true },
    appType: 'custom',
  })

  const { createServer: createHttpServer } = await import('http')
  const template = readFileSync(resolve(import.meta.dirname, 'index.html'), 'utf-8')

  const server = createHttpServer(async (req, res) => {
    const url = req.url ?? '/'

    // Let Vite handle its own routes and static assets
    const pathname = url.split('?')[0]!
    if (pathname.startsWith('/@') || pathname.startsWith('/node_modules') || pathname.startsWith('/src/') ||
        pathname.endsWith('.js') || pathname.endsWith('.css') || pathname.endsWith('.map') ||
        pathname.endsWith('.ico') || pathname.endsWith('.png') || pathname.endsWith('.svg')) {
      vite.middlewares(req, res)
      return
    }

    try {
      // Transform the HTML template
      const html = await vite.transformIndexHtml(url, template)

      // Load the server entry
      const { render } = await vite.ssrLoadModule('/src/entry-server.ts') as {
        render: (url: string) => { html: string; state: string }
      }

      const { html: appHtml, state } = render(url)

      // Inject the rendered HTML and state into the template
      const page = html
        .replace('<div id="app"></div>', `<div id="app">${appHtml}</div><script id="__llui_state" type="application/json">${state}</script>`)

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(page)
    } catch (e) {
      vite.ssrFixStacktrace(e as Error)
      console.error(e)
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end((e as Error).message)
    }
  })

  server.listen(PORT, () => {
    console.log(`SSR dev server: http://localhost:${PORT}`)
  })
}

main()
