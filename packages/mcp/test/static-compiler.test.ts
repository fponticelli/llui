import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ToolRegistry } from '../src/tool-registry.js'
import { registerStaticCompilerTools } from '../src/tools/static-compiler.js'

/**
 * v2c §4 — MCP static-mode tools.
 *
 * Exercises the static counterparts of `llui_show_compiled` /
 * `llui_explain_mask`. The tools take a file path on disk, read it, run
 * the engine, and return the same shape the live variants produce.
 *
 * Tests use a temp directory + `writeFileSync` rather than an in-memory
 * file map because the tool reads from `fs.readFileSync`. The temp dir
 * is cleaned up after each test.
 */

describe('llui_static_show_compiled', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'llui-static-tools-'))
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  function runTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const registry = new ToolRegistry()
    registerStaticCompilerTools(registry)
    return registry.dispatch(toolName, args, { relay: null, cdp: null })
  }

  it('returns pre/post for a compiled signal component file', async () => {
    const file = join(tmp, 'comp.ts')
    writeFileSync(
      file,
      `
        import { component, text } from '@llui/dom'
        type State = { n: number }
        type Msg = { type: 'inc' }
        export const C = component<State, Msg>({
          name: 'C',
          init: () => ({ n: 0 }),
          update: (s) => s,
          view: ({ state }) => [text(state.at('n'))],
        })
      `,
    )
    const result = (await runTool('llui_static_show_compiled', { file })) as {
      pre: string
      post: string | null
    }
    expect(result.pre).toContain('component<State, Msg>')
    expect(result.post).not.toBeNull()
    expect(result.post).toContain("from '@llui/dom'")
    expect(result.post).toContain('signalText')
  })

  it('returns null + note for a file with no signal component', async () => {
    const file = join(tmp, 'plain.ts')
    writeFileSync(file, `export const x = 1`)
    const result = (await runTool('llui_static_show_compiled', { file })) as {
      pre: string
      post: string | null
      note?: string
    }
    expect(result.post).toBeNull()
    expect(result.note).toMatch(/nothing to transform/)
  })

  it('returns an error string when the file cannot be read', async () => {
    const result = (await runTool('llui_static_show_compiled', {
      file: '/definitely/not/a/real/path.ts',
    })) as { error?: string }
    expect(result.error).toMatch(/Could not read/)
  })
})

describe('llui_static_collect_paths', () => {
  let tmp: string
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'llui-static-tools-'))
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  function runTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const registry = new ToolRegistry()
    registerStaticCompilerTools(registry)
    return registry.dispatch(toolName, args, { relay: null, cdp: null })
  }

  it('returns the reactive paths + per-top-level breakdown', async () => {
    const file = join(tmp, 'comp.ts')
    writeFileSync(
      file,
      `
        import { component, div, text } from '@llui/dom'
        type S = { user: { name: string; email: string }; theme: string }
        type M = { type: 'noop' }
        export const C = component<S, M>({
          name: 'C',
          init: () => [{ user: { name: '', email: '' }, theme: 'light' }, []],
          update: (s) => [s, []],
          view: ({ text }) => [
            div({}, [text((s) => s.user.name)]),
            div({}, [text((s) => s.user.email)]),
            div({}, [text((s) => s.theme)]),
          ],
        })
      `,
    )
    const result = (await runTool('llui_static_collect_paths', { file })) as {
      total: number
      opaque: boolean
      breakdown: Array<{ field: string; count: number }>
      paths: string[]
    }
    expect(result.total).toBe(3) // user.name + user.email + theme
    expect(result.opaque).toBe(false)
    expect(result.breakdown.map((b) => b.field).sort()).toEqual(['theme', 'user'])
    const userEntry = result.breakdown.find((b) => b.field === 'user')
    expect(userEntry?.count).toBe(2)
    expect(result.paths.slice().sort()).toEqual(['theme', 'user.email', 'user.name'])
  })

  it('reports a large path set without a fixed ceiling (chunked mask has no budget)', async () => {
    // 65 top-level state reads — the old two-word bitmask capped at 62; the
    // chunked-mask runtime has no ceiling, so all 65 paths are reported.
    const reads = Array.from({ length: 65 }, (_, i) => `text((s) => s.f${i})`).join(', ')
    const file = join(tmp, 'big.ts')
    writeFileSync(
      file,
      `
        import { component, div, text } from '@llui/dom'
        type S = { ${Array.from({ length: 65 }, (_, i) => `f${i}: string`).join(';')} }
        type M = { type: 'noop' }
        export const C = component<S, M>({
          name: 'C',
          init: () => [{} as S, []],
          update: (s) => [s, []],
          view: ({ text }) => [div({}, [${reads}])],
        })
      `,
    )
    const result = (await runTool('llui_static_collect_paths', { file })) as {
      total: number
      paths: string[]
    }
    expect(result.total).toBe(65)
    expect(result.paths).toHaveLength(65)
  })
})

// vitest's `beforeEach` / `afterEach` are top-level imports — bring them in.
import { beforeEach, afterEach } from 'vitest'
