import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Plugin } from 'vite'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import llui from '../src/index'

/**
 * Finding 4/5: the transform must `this.addWatchFile()` every sibling file
 * it reads while resolving cross-file Msg/State/Effect types, so that
 * editing a Msg union re-transforms the importing component. It also merges
 * the two former pre-resolution passes into one (single focal-file parse,
 * shared caching ResolveContext).
 */

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'llui-xfile-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

interface Ctx {
  warn: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
  resolve: ReturnType<typeof vi.fn>
  addWatchFile: ReturnType<typeof vi.fn>
}

async function runTransform(
  plugin: Plugin,
  code: string,
  id: string,
  ctx: Ctx,
): Promise<{ code: string } | undefined> {
  const transform = plugin.transform as (this: unknown, c: string, i: string) => unknown
  return (await transform.call(ctx, code, id)) as { code: string } | undefined
}

describe('cross-file type resolution — watch + merged pre-resolution', () => {
  it('addWatchFile is called for the sibling Msg type file, and its schema is inlined', async () => {
    const msgPath = join(dir, 'msg.ts')
    const compPath = join(dir, 'counter.ts')
    writeFileSync(msgPath, `export type Msg = { type: 'inc' } | { type: 'reset' }\n`)
    const code = [
      "import { component, text } from '@llui/dom'",
      "import type { Msg } from './msg'",
      'type State = { n: number }',
      'export const Counter = component<State, Msg>({',
      '  init: () => ({ n: 0 }),',
      '  update: (s) => s,',
      "  view: ({ state }) => [text(state.at('n'))],",
      '})',
    ].join('\n')
    writeFileSync(compPath, code)

    const addWatchFile = vi.fn()
    const resolve = vi.fn(async (spec: string) =>
      spec === './msg' ? { id: msgPath, external: false } : null,
    )
    const ctx: Ctx = {
      warn: vi.fn(),
      error: vi.fn(() => {
        throw new Error('this.error')
      }),
      resolve,
      addWatchFile,
    }

    // `agent: true` forces metadata emission (wantMeta) without needing a
    // configResolved dev handshake.
    const out = await runTransform(llui({ agent: true }), code, compPath, ctx)
    expect(out).toBeDefined()

    // The sibling type file was watched.
    const watched = addWatchFile.mock.calls.map((c) => c[0])
    expect(watched).toContain(msgPath)

    // The cross-file Msg union's variants were extracted into the metadata.
    expect(out!.code).toContain('__msgSchema')
    expect(out!.code).toContain('inc')
    expect(out!.code).toContain('reset')
  })

  it('tolerates a missing addWatchFile (non-Rollup callers) without throwing', async () => {
    const msgPath = join(dir, 'msg.ts')
    writeFileSync(msgPath, `export type Msg = { type: 'x' }\n`)
    const code = [
      "import { component, text } from '@llui/dom'",
      "import type { Msg } from './msg'",
      'type State = { n: number }',
      'export const C = component<State, Msg>({',
      '  init: () => ({ n: 0 }),',
      '  update: (s) => s,',
      "  view: ({ state }) => [text(state.at('n'))],",
      '})',
    ].join('\n')
    // Context WITHOUT addWatchFile (e.g. a bare unit-test invocation).
    const ctx = {
      warn: vi.fn(),
      error: vi.fn(() => {
        throw new Error('this.error')
      }),
      resolve: vi.fn(async (spec: string) =>
        spec === './msg' ? { id: msgPath, external: false } : null,
      ),
    } as unknown as Ctx
    const out = await runTransform(llui({ agent: true }), code, join(dir, 'c.ts'), ctx)
    expect(out).toBeDefined()
  })
})
