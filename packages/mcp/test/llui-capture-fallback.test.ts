// Tests for the Playwright fallback path in llui_capture (P5b).
// We don't launch a real browser — we install a mock CdpTransport on
// the MCP server's tool context via direct dispatch, which lets us
// drive the fallback without Playwright touching the network.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createCaptureRegistry,
  createEventBus,
  createNotesMiddleware,
} from '@llui/vite-plugin/notes'
import { ToolRegistry, type CdpTransport, type ToolContext } from '../src/tool-registry'
import { registerNotesTools } from '../src/tools/notes'

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

interface Fixture {
  notesRoot: string
  server: Server
  base: string
  bus: ReturnType<typeof createEventBus>
  registry: ReturnType<typeof createCaptureRegistry>
  toolRegistry: ToolRegistry
}

function startFixture(): Promise<Fixture> {
  const notesRoot = mkdtempSync(join(tmpdir(), 'llui-capture-fb-'))
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
  const toolRegistry = new ToolRegistry()
  registerNotesTools(toolRegistry)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      resolve({
        notesRoot,
        server,
        base: `http://127.0.0.1:${addr.port}`,
        bus,
        registry,
        toolRegistry,
      })
    })
  })
}

function stopFixture(f: Fixture): Promise<void> {
  rmSync(f.notesRoot, { recursive: true, force: true })
  return new Promise((resolve) => f.server.close(() => resolve()))
}

// Mock CdpTransport — returns canned screenshots + a synthetic page
// telemetry response, so the fallback path runs end-to-end without
// touching Playwright.
function mockCdp(opts: { screenshotOk?: boolean; telemetry?: unknown } = {}): CdpTransport {
  return {
    call: async () => null,
    isAvailable: () => true,
    screenshot: async () => {
      if (opts.screenshotOk === false) throw new Error('Playwright not installed')
      return { data: TINY_PNG_BASE64, format: 'png', mimeType: 'image/png' }
    },
    accessibilitySnapshot: async () => null,
    evaluatePage: async <T = unknown>(expr: string): Promise<T> => {
      // Distinguish the two known expressions (meta vs telemetry) by a
      // substring match — survives prettier reflow without being too
      // tight.
      if (expr.includes('location.href')) {
        return {
          url: 'http://localhost:5173/',
          viewport: { w: 1440, h: 900, dpr: 2 },
          llui: { runtime: '0.4.3', compiler: '0.5.6' },
        } as T
      }
      return (opts.telemetry ?? { stateSnapshot: {} }) as T
    },
    getConsoleBuffer: () => [],
    getNetworkBuffer: () => [],
    getErrorBuffer: () => [],
    closeBrowser: async () => ({ closed: true }),
  }
}

let f: Fixture

beforeEach(async () => {
  f = await startFixture()
})

afterEach(async () => {
  await stopFixture(f)
})

function makeCtx(cdp: CdpTransport | null, base: string, notesRoot: string): ToolContext {
  return {
    relay: null,
    cdp,
    notesRoot,
    devServerUrl: base,
  }
}

describe('llui_capture — Playwright fallback', () => {
  it('writes a note via createNote when middleware returns no-client and cdp is available', async () => {
    const ctx = makeCtx(mockCdp(), f.base, f.notesRoot)
    const result = (await f.toolRegistry.dispatch(
      'llui_capture',
      { prose: 'headless capture' },
      ctx,
    )) as {
      status: string
      mode: string
      noteId: string
      filename: string
      frontmatter: { author: string; kind: string; screenshot: string | null }
    }
    expect(result.status).toBe('fulfilled')
    expect(result.mode).toBe('playwright')
    expect(result.noteId).toBe('001')
    expect(result.filename).toMatch(/^001-llm-capture-/)
    expect(result.frontmatter.author).toBe('llm')
    expect(result.frontmatter.kind).toBe('capture')
    // The store rewrote screenshot to the canonical sibling name
    expect(result.frontmatter.screenshot).toMatch(/^001-llm-capture-.*\.png$/)
    // Confirm the .png landed on disk
    const sessionDir = readdirSync(f.notesRoot).find((d) => d.startsWith('session-'))!
    const files = readdirSync(join(f.notesRoot, sessionDir))
    expect(files.some((file) => file.endsWith('.png'))).toBe(true)
  })

  it('returns fallback-failed when cdp.screenshot throws (Playwright not installed)', async () => {
    const ctx = makeCtx(mockCdp({ screenshotOk: false }), f.base, f.notesRoot)
    const result = (await f.toolRegistry.dispatch('llui_capture', { prose: 'try' }, ctx)) as {
      status: string
      mode: string
      error: string
    }
    expect(result.status).toBe('fallback-failed')
    expect(result.mode).toBe('playwright')
    expect(result.error).toMatch(/playwright/i)
  })

  it('skips the HUD round-trip entirely when forceMode is playwright', async () => {
    const ctx = makeCtx(mockCdp(), f.base, f.notesRoot)
    const result = (await f.toolRegistry.dispatch(
      'llui_capture',
      { prose: 'force playwright', forceMode: 'playwright' },
      ctx,
    )) as { status: string; mode: string }
    expect(result.status).toBe('fulfilled')
    expect(result.mode).toBe('playwright')
  })

  it('does NOT fall back when forceMode is hud', async () => {
    const ctx = makeCtx(mockCdp(), f.base, f.notesRoot)
    const result = (await f.toolRegistry.dispatch(
      'llui_capture',
      { prose: 'hud only', forceMode: 'hud' },
      ctx,
    )) as { status: string; mode: string }
    expect(result.status).toBe('no-client')
    expect(result.mode).toBe('hud')
  })

  it('returns no-client+mode:hud when cdp is null and no HUD is connected', async () => {
    const ctx = makeCtx(null, f.base, f.notesRoot)
    const result = (await f.toolRegistry.dispatch('llui_capture', { prose: 'no cdp' }, ctx)) as {
      status: string
      mode: string
    }
    expect(result.status).toBe('no-client')
    expect(result.mode).toBe('hud')
  })

  it('captures the page telemetry into NoteBody via evaluatePage', async () => {
    const ctx = makeCtx(
      mockCdp({ telemetry: { stateSnapshot: { App: { v: 1 } }, messageLog: [] } }),
      f.base,
      f.notesRoot,
    )
    const result = (await f.toolRegistry.dispatch(
      'llui_capture',
      { forceMode: 'playwright' },
      ctx,
    )) as { body: { stateSnapshot?: Record<string, unknown> } }
    expect(result.body.stateSnapshot).toEqual({ App: { v: 1 } })
  })

  it('survives telemetry evaluation throwing — note still written', async () => {
    const cdp = mockCdp()
    cdp.evaluatePage = async <T = unknown>(expr: string): Promise<T> => {
      if (expr.includes('location.href')) {
        return {
          url: 'http://localhost:5173/',
          viewport: { w: 1, h: 1, dpr: 1 },
          llui: { runtime: 'x', compiler: 'y' },
        } as T
      }
      throw new Error('eval failed')
    }
    const ctx = makeCtx(cdp, f.base, f.notesRoot)
    const result = (await f.toolRegistry.dispatch(
      'llui_capture',
      { forceMode: 'playwright' },
      ctx,
    )) as { status: string }
    expect(result.status).toBe('fulfilled')
  })
})
