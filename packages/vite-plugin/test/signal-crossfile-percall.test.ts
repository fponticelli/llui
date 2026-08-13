import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Plugin } from 'vite'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import llui from '../src/index'

/**
 * Issue #91 — cross-file pre-resolution must be per `component()` call.
 *
 * The plugin used to pre-resolve from the FIRST `component<>` call in the file
 * and hand that one result to the transform, where it OVERRODE per-call
 * extraction. A second component whose `Msg` is declared locally was therefore
 * emitted with the first component's schema and annotations — wrong metadata on
 * the agent/devtools ABI, which is worse than missing metadata.
 */

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'llui-percall-'))
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
): Promise<{ code: string }> {
  const transform = plugin.transform as (this: unknown, c: string, i: string) => unknown
  const out = (await transform.call(ctx, code, id)) as { code: string } | undefined
  if (!out) throw new Error('transform returned undefined')
  return out
}

function makeCtx(resolveMap: Record<string, string>): Ctx {
  return {
    warn: vi.fn(),
    error: vi.fn(() => {
      throw new Error('this.error')
    }),
    resolve: vi.fn(async (spec: string) => {
      const hit = resolveMap[spec]
      return hit ? { id: hit, external: false } : null
    }),
    addWatchFile: vi.fn(),
  }
}

/** The emitted config slice for the component bound to `name`. */
function sliceFor(out: string, name: string): string {
  const start = out.indexOf(`const ${name} = component<`)
  expect(start).toBeGreaterThanOrEqual(0)
  const next = out.indexOf('\nexport const ', start + 6)
  return next < 0 ? out.slice(start) : out.slice(start, next)
}

const SIBLING_MSG = [
  'export type SiblingMsg =',
  '  /** @intent("Tick the sibling clock") */',
  "  | { type: 'siblingTick' }",
  "  | { type: 'siblingReset' }",
  "export type SiblingEffect = { type: 'siblingFx' }",
].join('\n')

const IMPORTED = [
  'export const Imported = component<ImportedState, SiblingMsg, SiblingEffect>({',
  '  init: () => ({ i: 0 }),',
  '  update: (s) => s,',
  "  view: ({ state }) => [text(state.at('i'))],",
  '})',
].join('\n')

const LOCAL = [
  'export const Local = component<LocalState, LocalMsg, LocalEffect>({',
  '  init: () => ({ l: 0 }),',
  '  update: (s) => s,',
  "  view: ({ state }) => [text(state.at('l'))],",
  '})',
].join('\n')

function componentFile(first: 'imported' | 'local'): string {
  return [
    "import { component, text } from '@llui/dom'",
    "import type { SiblingMsg, SiblingEffect } from './sibling'",
    "import type { ImportedState } from './sibling-state'",
    'type LocalMsg =',
    '  /** @intent("Flip the local switch") */',
    "  | { type: 'localFlip' }",
    "  | { type: 'localNoop' }",
    "type LocalEffect = { type: 'localFx' }",
    'type LocalState = { l: number }',
    ...(first === 'imported' ? [IMPORTED, LOCAL] : [LOCAL, IMPORTED]),
  ].join('\n')
}

describe('cross-file pre-resolution is per component() call (#91)', () => {
  for (const order of ['imported', 'local'] as const) {
    it(`each component gets its own Msg/Effect schema, annotations and State (${order} first)`, async () => {
      const siblingPath = join(dir, 'sibling.ts')
      const statePath = join(dir, 'sibling-state.ts')
      const compPath = join(dir, 'app.ts')
      writeFileSync(siblingPath, `${SIBLING_MSG}\n`)
      writeFileSync(statePath, 'export type ImportedState = { i: number }\n')
      const code = componentFile(order)
      writeFileSync(compPath, code)

      const ctx = makeCtx({ './sibling': siblingPath, './sibling-state': statePath })
      const out = await runTransform(llui({ agent: true }), code, compPath, ctx)

      const imported = sliceFor(out.code, 'Imported')
      const local = sliceFor(out.code, 'Local')

      // The component with the sibling Msg keeps its cross-file metadata.
      expect(imported).toContain('siblingTick')
      expect(imported).toContain('siblingReset')
      expect(imported).toContain('siblingFx')
      expect(imported).toContain('Tick the sibling clock')
      expect(imported).toContain('"i":"number"')

      // The component with a LOCAL Msg gets ITS OWN — never the sibling's.
      expect(local).toContain('localFlip')
      expect(local).toContain('localFx')
      expect(local).toContain('Flip the local switch')
      expect(local).toContain('"l":"number"')
      expect(local).not.toContain('siblingTick')
      expect(local).not.toContain('siblingReset')
      expect(local).not.toContain('siblingFx')
      expect(local).not.toContain('Tick the sibling clock')
      expect(local).not.toContain('"i":"number"')
    })
  }

  it('resolves a SECOND distinct cross-file Msg, not just the first call the file declares', async () => {
    const oneMsg = join(dir, 'one.ts')
    const twoMsg = join(dir, 'two.ts')
    const compPath = join(dir, 'two-siblings.ts')
    writeFileSync(oneMsg, "export type OneMsg = { type: 'oneA' }\n")
    writeFileSync(twoMsg, "export type TwoMsg = { type: 'twoB' }\n")
    const code = [
      "import { component, text } from '@llui/dom'",
      "import type { OneMsg } from './one'",
      "import type { TwoMsg } from './two'",
      'type OneState = { o: number }',
      'type TwoState = { t: number }',
      'export const One = component<OneState, OneMsg>({',
      '  init: () => ({ o: 0 }),',
      '  update: (s) => s,',
      "  view: ({ state }) => [text(state.at('o'))],",
      '})',
      'export const Two = component<TwoState, TwoMsg>({',
      '  init: () => ({ t: 0 }),',
      '  update: (s) => s,',
      "  view: ({ state }) => [text(state.at('t'))],",
      '})',
    ].join('\n')
    writeFileSync(compPath, code)

    const ctx = makeCtx({ './one': oneMsg, './two': twoMsg })
    const out = await runTransform(llui({ agent: true }), code, compPath, ctx)

    expect(sliceFor(out.code, 'One')).toContain('oneA')
    expect(sliceFor(out.code, 'One')).not.toContain('twoB')
    // The second call's imported Msg was never resolved before — the pre-resolver
    // stopped at the first `component<>` in the file.
    expect(sliceFor(out.code, 'Two')).toContain('twoB')
    expect(sliceFor(out.code, 'Two')).not.toContain('oneA')

    // Both sibling type files are watched, so editing either re-transforms.
    const watched = ctx.addWatchFile.mock.calls.map((c) => c[0])
    expect(watched).toContain(oneMsg)
    expect(watched).toContain(twoMsg)
  })
})
