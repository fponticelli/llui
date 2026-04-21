/**
 * SSR dev server — renders the initial page server-side, then the
 * client hydrates the existing HTML instead of mounting fresh.
 *
 * Usage: npx tsx server.ts
 */
import { createServer } from 'vite'
import { resolve } from 'path'
import { readFileSync } from 'fs'
import type { IncomingMessage } from 'node:http'
import { createLluiAgentServer } from '@llui/agent/server'

// AGENT_SIGNING_KEY: set this to a strong random secret (≥ 32 bytes) in
// production via the environment variable. The default 'dev-...' value is
// safe only for local development — it has no entropy.
const AGENT_SIGNING_KEY = process.env['AGENT_SIGNING_KEY'] ?? 'dev-dev-dev-dev-dev-dev-dev-dev-x'

const PORT = 5173

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

function nodeHeadersToRecord(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue
    out[k] = Array.isArray(v) ? v.join(', ') : v
  }
  return out
}

async function main() {
  const vite = await createServer({
    root: resolve(import.meta.dirname),
    server: { middlewareMode: true },
    appType: 'custom',
  })

  // Create the agent server (HTTP management + LAP router + WS pairing).
  const agent = createLluiAgentServer({
    signingKey: AGENT_SIGNING_KEY,
    identityResolver: async () => 'demo-user',
  })

  const { createServer: createHttpServer } = await import('http')
  const template = readFileSync(resolve(import.meta.dirname, 'index.html'), 'utf-8')

  // The server port is not known until server.listen() resolves; capture it so
  // the agent router can construct correct wsUrl/lapUrl values from the incoming
  // request URL (it derives the origin from the request, which is fine here
  // since the browser hits localhost:PORT directly).
  let serverPort = PORT

  const server = createHttpServer(async (req, res) => {
    const url = req.url ?? '/'
    const pathname = url.split('?')[0]!

    // ── Agent routes — handled before Vite ───────────────────────────────────
    if (pathname.startsWith('/agent/')) {
      const rawBody =
        req.method && !['GET', 'HEAD'].includes(req.method) ? await readBody(req) : undefined
      const body: BodyInit | undefined = rawBody ? new Uint8Array(rawBody) : undefined
      const webReq = new Request(`http://localhost:${serverPort}${url}`, {
        method: req.method ?? 'GET',
        headers: nodeHeadersToRecord(req),
        body,
      })
      const webRes = await agent.router(webReq)
      if (!webRes) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('not found')
        return
      }
      res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()))
      res.end(Buffer.from(await webRes.arrayBuffer()))
      return
    }

    // ── Vite static assets / HMR ─────────────────────────────────────────────
    if (
      pathname.startsWith('/@') ||
      pathname.startsWith('/node_modules') ||
      pathname.startsWith('/src/') ||
      pathname.endsWith('.js') ||
      pathname.endsWith('.css') ||
      pathname.endsWith('.map') ||
      pathname.endsWith('.ico') ||
      pathname.endsWith('.png') ||
      pathname.endsWith('.svg')
    ) {
      vite.middlewares(req, res)
      return
    }

    try {
      // Transform the HTML template
      const html = await vite.transformIndexHtml(url, template)

      // Load the server entry
      const { render } = (await vite.ssrLoadModule('/src/entry-server.ts')) as {
        render: (url: string) => Promise<{ html: string; state: string }>
      }

      const { html: appHtml, state } = await render(url)

      // Inject the rendered HTML and state into the template
      const page = html.replace(
        '<div id="app"></div>',
        `<div id="app">${appHtml}</div><script id="__llui_state" type="application/json">${state}</script>`,
      )

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(page)
    } catch (e) {
      vite.ssrFixStacktrace(e as Error)
      console.error(e)
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end((e as Error).message)
    }
  })

  // Forward WebSocket upgrade events to the agent's WS handler.
  server.on('upgrade', agent.wsUpgrade)

  server.listen(PORT, () => {
    serverPort = PORT
    console.log(`SSR dev server: http://localhost:${PORT}`)
    console.log(`Agent endpoint:  http://localhost:${PORT}/agent/mint  (POST to mint a token)`)
  })
}

main()
