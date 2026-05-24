// End-to-end test for the `llui_capture` MCP tool. Wires the tool
// against a real instance of the vite-plugin notes middleware (running
// on a node http server) and a fake HUD that fulfills the long-poll by
// POSTing /_llui/notes with the request id. The full long-poll +
// fulfillment + read-back path runs through real code; only the
// browser-side rendering is stubbed.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createCaptureRegistry,
  createEventBus,
  createNotesMiddleware,
} from '@llui/vite-plugin/notes'
import type { NoteFrontmatter } from '@llui/vite-plugin'
import { LluiMcpServer } from '../src/index'

const fmBase: Omit<NoteFrontmatter, 'id' | 'ts'> = {
  author: 'llm',
  kind: 'capture',
  captureLevel: 'standard',
  url: 'http://localhost:5173/',
  route: null,
  routeParams: {},
  viewport: { w: 1440, h: 900, dpr: 2 },
  componentPath: null,
  componentMeta: null,
  annotations: [],
  screenshot: null,
  agentSchemas: [],
  llui: { runtime: '0.4.3', compiler: '0.5.6' },
}

interface Fixture {
  notesRoot: string
  server: Server
  base: string
  bus: ReturnType<typeof createEventBus>
  registry: ReturnType<typeof createCaptureRegistry>
  mcp: LluiMcpServer
}

function startFixture(): Promise<Fixture> {
  const notesRoot = mkdtempSync(join(tmpdir(), 'llui-capture-test-'))
  const bus = createEventBus()
  const registry = createCaptureRegistry()
  const handler = createNotesMiddleware({
    notesRoot,
    bus,
    registry,
    defaultCaptureTimeoutMs: 5000,
  })
  const server = createServer((req, res) => {
    handler(req, res, () => {
      res.statusCode = 404
      res.end('not in /_llui')
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      const base = `http://127.0.0.1:${addr.port}`
      const mcp = new LluiMcpServer({ bridgePort: 0, notesRoot, devUrl: base })
      resolve({ notesRoot, server, base, bus, registry, mcp })
    })
  })
}

function stopFixture(f: Fixture): Promise<void> {
  rmSync(f.notesRoot, { recursive: true, force: true })
  return new Promise((resolve) => f.server.close(() => resolve()))
}

let f: Fixture

beforeEach(async () => {
  f = await startFixture()
})

afterEach(async () => {
  await stopFixture(f)
})

describe('llui_capture (MCP tool, end-to-end with middleware)', () => {
  it('returns status:no-client when no HUD is subscribed', async () => {
    const result = (await f.mcp.handleToolCall('llui_capture', {
      prose: 'try anyway',
    })) as { status: string }
    expect(result.status).toBe('no-client')
  })

  it('round-trips: MCP requests, fake HUD fulfills, MCP returns the inline note', async () => {
    // Subscribe a fake HUD to the bus so the middleware long-polls.
    const events: unknown[] = []
    f.bus.subscribe('hud', (e) => events.push(e))

    // Kick off the long-poll on the MCP side. We don't await here so
    // we can fulfill the request below.
    const responsePromise = f.mcp.handleToolCall('llui_capture', {
      prose: 'inspect the user card',
    })

    // Wait briefly for the capture-request event to land.
    await new Promise((r) => setTimeout(r, 30))
    const evt = events.find(
      (e): e is { type: 'capture-request'; requestId: string } =>
        typeof e === 'object' && e !== null && 'type' in e && e.type === 'capture-request',
    )
    expect(evt).toBeDefined()
    if (!evt) throw new Error('unreachable')

    // Fake HUD: POST a note carrying fulfillsRequestId.
    const fulfillRes = await fetch(`${f.base}/_llui/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'screenshot landed',
        frontmatter: { ...fmBase, fulfillsRequestId: evt.requestId },
        noteBody: {},
      }),
    })
    expect(fulfillRes.status).toBe(201)

    const result = (await responsePromise) as {
      status: string
      noteId: string
      filename: string
      prose: string
      markdown: string
    }
    expect(result.status).toBe('fulfilled')
    expect(result.noteId).toBe('001')
    expect(result.filename).toMatch(/^001-llm-capture-/)
    expect(result.prose.trim()).toBe('screenshot landed')
    expect(result.markdown.startsWith('---\n')).toBe(true)
  })

  it('throws a clear error when no dev-server URL is configured', async () => {
    const noUrl = new LluiMcpServer({ bridgePort: 0, notesRoot: f.notesRoot })
    await expect(noUrl.handleToolCall('llui_capture', {})).rejects.toThrow(/dev-server URL/)
  })

  it('forwards annotate + captureLevel + timeoutMs to the middleware', async () => {
    const events: unknown[] = []
    f.bus.subscribe('hud', (e) => events.push(e))

    void f.mcp.handleToolCall('llui_capture', {
      annotate: [{ type: 'rect', x: 1, y: 2, w: 3, h: 4 }],
      captureLevel: 'verbose',
      timeoutMs: 100,
    })
    await new Promise((r) => setTimeout(r, 30))
    const evt = events.find(
      (e): e is { type: 'capture-request'; payload: Record<string, unknown> } =>
        typeof e === 'object' && e !== null && 'type' in e && e.type === 'capture-request',
    )
    expect(evt).toBeDefined()
    if (!evt) throw new Error('unreachable')
    expect(evt.payload['captureLevel']).toBe('verbose')
    expect(evt.payload['annotate']).toHaveLength(1)
    // Wait for the long-poll to time out so the test cleanup completes.
    await new Promise((r) => setTimeout(r, 200))
  })
})
