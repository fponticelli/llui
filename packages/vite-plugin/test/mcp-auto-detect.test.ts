import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import type { Plugin } from 'vite'
import llui from '../src/index'

// Helper: build a minimal project root with a package.json. Optionally
// install a stub @llui/mcp under node_modules so auto-detect picks it up.

function scaffoldRoot(withMcp: boolean): string {
  const root = resolve(
    tmpdir(),
    `llui-plugin-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(root, { recursive: true })
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({ name: 'test-app' }))
  if (withMcp) {
    const mcpDir = resolve(root, 'node_modules/@llui/mcp')
    mkdirSync(mcpDir, { recursive: true })
    writeFileSync(
      resolve(mcpDir, 'package.json'),
      JSON.stringify({ name: '@llui/mcp', version: '0.0.15', main: 'index.js' }),
    )
    writeFileSync(resolve(mcpDir, 'index.js'), '')
  }
  return root
}

function cleanupRoot(root: string): void {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true })
}

function invokeConfigResolved(plugin: Plugin, root: string): void {
  const hook = plugin.configResolved as (config: { root: string; command: string }) => void
  hook({ root, command: 'serve' })
}

describe('mcpPort auto-detection', () => {
  let roots: string[] = []

  afterEach(() => {
    for (const r of roots) cleanupRoot(r)
    roots = []
  })

  function mkRoot(withMcp: boolean): string {
    const r = scaffoldRoot(withMcp)
    roots.push(r)
    return r
  }

  it('defaults mcpPort to 5200 when @llui/mcp resolves', () => {
    const root = mkRoot(true)
    const plugin = llui()
    invokeConfigResolved(plugin, root)
    // Indirect observation: configureServer guards on mcpPort === null.
    // With auto-detect on, it should NOT early-return; we simulate by
    // checking the internal state via a follow-on transform call that
    // embeds the port. Easier: spy on the internal guard by triggering
    // the no-mcp console.warn path and asserting the OPPOSITE.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fakeServer = makeFakeViteServer(root)
    ;(plugin.configureServer as (s: unknown) => void)(fakeServer)
    // If mcpPort had been null, configureServer would have logged the
    // "@llui/mcp server is running …" warning (only if marker exists).
    // Since there's no marker, both cases are silent — so assert via a
    // different path: calling transform with a visible mcpPort token.
    warn.mockRestore()
    // The definitive test is "was the HTTP middleware registered?" —
    // which only happens when mcpPort !== null. Fake server tracks it.
    expect(fakeServer.middlewareRegistered).toBe(true)
  })

  it('stays disabled when @llui/mcp does NOT resolve', () => {
    const root = mkRoot(false)
    const plugin = llui()
    invokeConfigResolved(plugin, root)
    const fakeServer = makeFakeViteServer(root)
    ;(plugin.configureServer as (s: unknown) => void)(fakeServer)
    expect(fakeServer.middlewareRegistered).toBe(false)
  })

  it('explicit mcpPort: false wins over auto-detect', () => {
    const root = mkRoot(true) // would auto-detect ON
    const plugin = llui({ mcpPort: false })
    invokeConfigResolved(plugin, root)
    const fakeServer = makeFakeViteServer(root)
    ;(plugin.configureServer as (s: unknown) => void)(fakeServer)
    expect(fakeServer.middlewareRegistered).toBe(false)
  })

  it('explicit numeric mcpPort wins over auto-detect', () => {
    const root = mkRoot(false) // would auto-detect OFF
    const plugin = llui({ mcpPort: 5555 })
    invokeConfigResolved(plugin, root)
    const fakeServer = makeFakeViteServer(root)
    ;(plugin.configureServer as (s: unknown) => void)(fakeServer)
    expect(fakeServer.middlewareRegistered).toBe(true)
  })
})

describe('mcpPort mismatch warning', () => {
  let roots: string[] = []
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
    for (const r of roots) cleanupRoot(r)
    roots = []
  })

  it('warns when mcpPort is disabled but marker file exists', () => {
    const root = scaffoldRoot(false)
    roots.push(root)
    // Scaffold the marker file under the WORKSPACE root, which findWorkspaceRoot
    // will locate. For this test we make the scaffolded root the workspace
    // root by including a .git dir.
    mkdirSync(resolve(root, '.git'), { recursive: true })
    const markerDir = resolve(root, 'node_modules/.cache/llui-mcp')
    mkdirSync(markerDir, { recursive: true })
    writeFileSync(resolve(markerDir, 'active.json'), JSON.stringify({ port: 5200 }))

    const prevCwd = process.cwd()
    process.chdir(root)
    try {
      const plugin = llui({ mcpPort: false })
      invokeConfigResolved(plugin, root)
      const fakeServer = makeFakeViteServer(root)
      ;(plugin.configureServer as (s: unknown) => void)(fakeServer)
      const messages = warnSpy.mock.calls.map((c: unknown[]) => (c[0] as string) ?? '')
      expect(messages.some((m: string) => /@llui\/mcp server is running/.test(m))).toBe(true)
    } finally {
      process.chdir(prevCwd)
    }
  })

  it('does NOT warn when both plugin and MCP are opted in', () => {
    const root = scaffoldRoot(true)
    roots.push(root)
    mkdirSync(resolve(root, '.git'), { recursive: true })
    const markerDir = resolve(root, 'node_modules/.cache/llui-mcp')
    mkdirSync(markerDir, { recursive: true })
    writeFileSync(resolve(markerDir, 'active.json'), JSON.stringify({ port: 5200 }))

    const prevCwd = process.cwd()
    process.chdir(root)
    try {
      const plugin = llui()
      invokeConfigResolved(plugin, root)
      const fakeServer = makeFakeViteServer(root)
      ;(plugin.configureServer as (s: unknown) => void)(fakeServer)
      const messages = warnSpy.mock.calls.map((c: unknown[]) => (c[0] as string) ?? '')
      expect(messages.some((m: string) => /@llui\/mcp server is running/.test(m))).toBe(false)
    } finally {
      process.chdir(prevCwd)
    }
  })
})

// ── Fake Vite server ──────────────────────────────────────────────
// Minimal shape the plugin touches. Tracks whether the HTTP endpoint
// middleware was registered — the tell for mcpPort !== null.

interface FakeServer {
  middlewareRegistered: boolean
  middlewares: { use: (path: string, handler: unknown) => void }
  ws: { send: (m: unknown) => void; on: (event: string, cb: () => void) => void }
  httpServer: {
    on: (event: string, cb: () => void) => void
    once: (event: string, cb: () => void) => void
    address: () => null
  } | null
}

function makeFakeViteServer(_root: string): FakeServer {
  const server: FakeServer = {
    middlewareRegistered: false,
    middlewares: {
      use(_path: string, _handler: unknown) {
        server.middlewareRegistered = true
      },
    },
    ws: { send() {}, on() {} },
    httpServer: {
      on() {},
      once() {},
      address: () => null,
    },
  }
  return server
}
