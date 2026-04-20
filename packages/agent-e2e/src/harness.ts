import { chromium, type Browser, type Page } from '@playwright/test'
import {
  createLluiAgentServer,
  InMemoryTokenStore,
  type AgentServerHandle,
} from '@llui/agent/server'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { IncomingMessage } from 'node:http'
import { bundleHost } from './build.js'
// Internal bridge imports — llui-agent exposes ./internal/* sub-paths that
// give e2e tests direct access to bridge internals without going through the
// CLI. These sub-paths are not part of the public API.
import { createBridgeServer } from 'llui-agent/internal/bridge'
import { BindingMap } from 'llui-agent/internal/binding'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export type MintResult = {
  token: string
  wsUrl: string
  lapUrl: string
  tid: string
}

export type E2EContext = {
  browser: Browser
  page: Page
  server: Server
  httpPort: number
  agent: AgentServerHandle
  mcpClient: Client
  /**
   * Mint a new agent token via the server's /agent/mint endpoint and
   * immediately open the WS in the browser via the __lluiE2eClient global.
   * Returns the token metadata so tests can call bindClaude().
   */
  mintToken: () => Promise<MintResult>
  /**
   * Tell the MCP bridge to bind this Claude session to the given LAP URL +
   * token. After this call, all mcpClient tool calls are forwarded to the app.
   */
  bindClaude: (lapUrl: string, token: string) => Promise<void>
  close: () => Promise<void>
}

// ── setup ─────────────────────────────────────────────────────────────────────

export async function setup(): Promise<E2EContext> {
  // 1. Bundle the browser-side host app.
  const bundle = await bundleHost()

  // 2. Create the LLui agent server (manages minting, LAP routing, WS pairing).
  const agent = createLluiAgentServer({
    signingKey: 'x'.repeat(32),
    tokenStore: new InMemoryTokenStore(),
    identityResolver: async () => 'e2e-user',
    auditSink: { write: async () => undefined },
  })

  // 3. Spin up an ephemeral Node http server.
  //    Routes: /         → inline HTML page
  //            /app.js   → the esbuild bundle
  //            /agent/*  → delegated to the LLui agent router
  //            upgrade   → WS pairing
  const server = createServer(async (req, res) => {
    const url = req.url ?? '/'

    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(
        '<!doctype html><html><head><meta charset="utf-8"></head>' +
          '<body><div id="app"></div><script src="/app.js"></script></body></html>',
      )
      return
    }

    if (url === '/app.js') {
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' })
      res.end(bundle)
      return
    }

    if (url.startsWith('/agent/')) {
      // Convert Node's IncomingMessage to a Web Request for the agent router.
      // Buffer is not BodyInit in the DOM types, so convert to Uint8Array first.
      const rawBody =
        req.method && !['GET', 'HEAD'].includes(req.method) ? await readBody(req) : undefined
      const body: BodyInit | undefined = rawBody ? new Uint8Array(rawBody) : undefined
      const webReq = new Request(`http://localhost${url}`, {
        method: req.method ?? 'GET',
        headers: nodeHeadersToRecord(req),
        body,
      })
      const webRes = await agent.router(webReq)
      if (!webRes) {
        res.writeHead(404)
        res.end('not found')
        return
      }
      res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()))
      res.end(Buffer.from(await webRes.arrayBuffer()))
      return
    }

    res.writeHead(404)
    res.end('not found')
  })

  // Forward WS upgrade events to the agent's WS handler.
  server.on('upgrade', agent.wsUpgrade)

  await new Promise<void>((resolve) => server.listen(0, resolve))
  const httpPort = (server.address() as AddressInfo).port

  // 4. Create an in-process MCP bridge (createBridgeServer) paired with an
  //    MCP Client via InMemoryTransport so tests can issue tool calls without
  //    stdio or network MCP transport.
  const bindings = new BindingMap()
  const bridge = createBridgeServer({
    sessionId: 'e2e-session',
    bindings,
    version: '0.0.0',
    // Inject a fetch that is pre-bound to the ephemeral server port.
    fetch: makeBoundFetch(httpPort),
  })

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await bridge.connect(serverTransport)
  const mcpClient = new Client({ name: 'e2e-mcp-client', version: '0.0.0' }, { capabilities: {} })
  await mcpClient.connect(clientTransport)

  // 5. Launch headless Chromium and navigate to the test page.
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(`http://localhost:${httpPort}/`)
  // Wait until host.ts has finished bootstrapping and exposed the globals.
  await page.waitForFunction(() => typeof (window as unknown as Record<string, unknown>)['__lluiE2eClient'] !== 'undefined', undefined, {
    timeout: 10_000,
  })

  // ── Helper: mint + open WS ────────────────────────────────────────────────
  const mintToken = async (): Promise<MintResult> => {
    const res = await fetch(`http://localhost:${httpPort}/agent/mint`, { method: 'POST' })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`mint failed: ${res.status} ${text}`)
    }
    const body = (await res.json()) as MintResult

    // Ask the browser's AgentClient to open the WS for this token.
    await page.evaluate(async (b: MintResult) => {
      const client = (window as unknown as Record<string, unknown>)['__lluiE2eClient'] as {
        effectHandler: (e: unknown) => Promise<void>
      }
      await client.effectHandler({ type: 'AgentOpenWS', token: b.token, wsUrl: b.wsUrl })
    }, body)

    return body
  }

  // ── Helper: bind the MCP bridge to the app session ───────────────────────
  const bindClaude = async (lapUrl: string, token: string): Promise<void> => {
    const result = await mcpClient.callTool({
      name: 'llui_connect_session',
      arguments: { url: lapUrl, token },
    })
    // If the tool returned an error result, surface it.
    const content = result.content as Array<{ type: string; text?: string }>
    if (result.isError) {
      const msg = content.map((c) => c.text ?? '').join(' ')
      throw new Error(`bindClaude failed: ${msg}`)
    }
  }

  // ── Teardown ──────────────────────────────────────────────────────────────
  const close = async () => {
    await browser.close()
    await mcpClient.close()
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    )
  }

  return {
    browser,
    page,
    server,
    httpPort,
    agent,
    mcpClient,
    mintToken,
    bindClaude,
    close,
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

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

/**
 * Returns a `fetch` function that rewrites requests targeting
 * `http://localhost/agent/*` to `http://localhost:<port>/agent/*`.
 * This lets the bridge's forwardLap() reach our ephemeral test server.
 */
function makeBoundFetch(port: number): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    let url: string
    if (typeof input === 'string') {
      url = input
    } else if (input instanceof URL) {
      url = input.toString()
    } else {
      url = (input as Request).url
    }
    // Rewrite bare /agent/* paths or http://localhost/... to use the right port.
    if (url.startsWith('/')) {
      url = `http://localhost:${port}${url}`
    } else if (url.startsWith('http://localhost/')) {
      url = `http://localhost:${port}${url.slice('http://localhost'.length)}`
    }
    return fetch(url, init)
  }
}
