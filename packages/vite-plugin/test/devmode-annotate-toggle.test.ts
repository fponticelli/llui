// Verifies the `devmodeAnnotate` plugin option gates the notes
// middleware registration. The option is opt-in; when omitted or false,
// no notes routes are mounted.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import llui from '../src/index'

interface FakeViteServer {
  /** Number of non-path-prefixed `use(handler)` calls — the notes
   *  middleware uses this form. */
  globalUses: number
  /** Paths passed to `use(path, handler)` calls. */
  pathUses: string[]
  middlewares: { use: (...args: unknown[]) => void }
  ws: { send: () => void; on: () => void }
  httpServer: {
    on: () => void
    once: () => void
    address: () => null
  } | null
}

function makeFakeServer(): FakeViteServer {
  const server: FakeViteServer = {
    globalUses: 0,
    pathUses: [],
    middlewares: {
      use(...args: unknown[]) {
        if (args.length === 1 && typeof args[0] === 'function') {
          server.globalUses++
        } else if (typeof args[0] === 'string') {
          server.pathUses.push(args[0])
        }
      },
    },
    ws: { send() {}, on() {} },
    httpServer: { on() {}, once() {}, address: () => null },
  }
  return server
}

function invokeConfigResolved(plugin: Plugin, root: string): void {
  const hook = plugin.configResolved as (config: { root: string; command: string }) => void
  hook({ root, command: 'serve' })
}

let tmpRoot: string

beforeEach(() => {
  tmpRoot = mkdtempSync(resolve(tmpdir(), 'llui-devmode-annotate-toggle-'))
  // Minimal scaffolded project so configResolved doesn't blow up.
  writeFileSync(resolve(tmpRoot, 'package.json'), JSON.stringify({ name: 'test' }))
  mkdirSync(resolve(tmpRoot, 'node_modules'), { recursive: true })
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('devmodeAnnotate plugin option', () => {
  it('registers the notes middleware by default (option is undefined)', () => {
    const plugin = llui()
    invokeConfigResolved(plugin, tmpRoot)
    const server = makeFakeServer()
    ;(plugin.configureServer as (s: unknown) => void)(server)
    expect(server.globalUses).toBe(1)
  })

  it('does NOT register the notes middleware when option is explicitly false', () => {
    const plugin = llui({ devmodeAnnotate: false })
    invokeConfigResolved(plugin, tmpRoot)
    const server = makeFakeServer()
    ;(plugin.configureServer as (s: unknown) => void)(server)
    expect(server.globalUses).toBe(0)
  })

  it('registers the notes middleware when option is true', () => {
    const plugin = llui({ devmodeAnnotate: true })
    invokeConfigResolved(plugin, tmpRoot)
    const server = makeFakeServer()
    ;(plugin.configureServer as (s: unknown) => void)(server)
    expect(server.globalUses).toBe(1)
  })

  it('registers the notes middleware when option is an object', () => {
    const plugin = llui({
      devmodeAnnotate: { notesDir: 'custom-notes', captureTimeoutMs: 5000 },
    })
    invokeConfigResolved(plugin, tmpRoot)
    const server = makeFakeServer()
    ;(plugin.configureServer as (s: unknown) => void)(server)
    expect(server.globalUses).toBe(1)
  })
})
