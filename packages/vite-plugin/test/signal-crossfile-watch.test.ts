import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Plugin } from 'vite'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import llui from '../src/index'
import { COMPILER_META_KEYS } from '@llui/compiler'

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
    expect(out!.code).toContain(`${COMPILER_META_KEYS.msgSchema}:`)
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

  // ── agent-annotation-syntax on a TYPE-ONLY-imported sibling (issue #89) ──
  // `import type { Msg } from './msg'` is ERASED by esbuild: `msg.ts` never
  // enters the module graph and is never transformed, so the transform-hook
  // lint never sees it — yet the resolver reads it right here and emits its
  // annotations as `$ma`. That is the canonical layout, so without this the
  // gate ships open in the most common case.
  const COMPONENT = [
    "import { component, text } from '@llui/dom'",
    "import type { Msg } from './msg'",
    'type State = { mode: string }',
    'export const C = component<State, Msg>({',
    "  init: () => ({ mode: 'viewer' }),",
    '  update: (s) => s,',
    "  view: ({ state }) => [text(state.at('mode'))],",
    '})',
  ].join('\n')

  function ctxFor(msgPath: string): { ctx: Ctx; errors: unknown[] } {
    const errors: unknown[] = []
    const ctx: Ctx = {
      warn: vi.fn(),
      error: vi.fn((e: unknown) => {
        errors.push(e)
        throw new Error('this.error')
      }),
      resolve: vi.fn(async (spec: string) =>
        spec === './msg' ? { id: msgPath, external: false } : null,
      ),
      addWatchFile: vi.fn(),
    }
    return { ctx, errors }
  }

  it('halts the build for a malformed annotation in a type-only-imported sibling', async () => {
    const msgPath = join(dir, 'msg.ts')
    const compPath = join(dir, 'c.ts')
    writeFileSync(
      msgPath,
      [
        'export type Msg =',
        '  /** @routeGated("state.mode === "admin"") */',
        "  | { type: 'purge' }",
        "  | { type: 'noop' }",
        '',
      ].join('\n'),
    )
    writeFileSync(compPath, COMPONENT)
    const { ctx, errors } = ctxFor(msgPath)
    await expect(runTransform(llui({ agent: true }), COMPONENT, compPath, ctx)).rejects.toThrow(
      'this.error',
    )
    const err = errors[0] as { message: string; loc: { file: string } }
    expect(err.message).toContain('agent-annotation-syntax')
    // Reported against the SIBLING that carries the annotation, not the
    // importer — the author needs the file they have to edit.
    expect(err.message).toContain('msg.ts')
    expect(err.loc.file).toBe(msgPath)
  })

  it('halts the build for an UNCOMPILABLE predicate in a type-only-imported sibling', async () => {
    const msgPath = join(dir, 'msg.ts')
    const compPath = join(dir, 'c.ts')
    writeFileSync(
      msgPath,
      [
        'export type Msg =',
        '  /** @routeGated("f(state)) === 1") */',
        "  | { type: 'purge' }",
        '',
      ].join('\n'),
    )
    writeFileSync(compPath, COMPONENT)
    const { ctx, errors } = ctxFor(msgPath)
    await expect(runTransform(llui({ agent: true }), COMPONENT, compPath, ctx)).rejects.toThrow(
      'this.error',
    )
    expect((errors[0] as { message: string }).message).toContain('agent-annotation-syntax')
  })

  it('leaves a WELL-FORMED sibling annotation alone and inlines its routeGate', async () => {
    const msgPath = join(dir, 'msg.ts')
    const compPath = join(dir, 'c.ts')
    writeFileSync(
      msgPath,
      [
        'export type Msg =',
        '  /** @routeGated("state.mode === \\"admin\\"", "admins only") */',
        "  | { type: 'purge' }",
        '',
      ].join('\n'),
    )
    writeFileSync(compPath, COMPONENT)
    const { ctx, errors } = ctxFor(msgPath)
    const out = await runTransform(llui({ agent: true }), COMPONENT, compPath, ctx)
    expect(errors).toEqual([])
    expect(out).toBeDefined()
    expect(out!.code).toContain(`${COMPILER_META_KEYS.msgAnnotations}:`)
    expect(out!.code).toContain('state.mode === \\"admin\\"')
  })
})
