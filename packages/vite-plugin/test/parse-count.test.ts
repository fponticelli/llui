import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Plugin } from 'vite'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import llui from '../src/index'

/**
 * Issue #93 — a module is parsed ONCE per dev transform.
 *
 * Every extractor used to take `source: string` and re-parse it, so one dev
 * transform (gated on `devMode || agent` — i.e. every keystroke-save) parsed the
 * same text 17 times: the cross-file pre-resolution pass alone accounted for 10,
 * then lint, the transform, and the state-schema extractor. Sibling type files
 * were re-parsed once per lookup on top of that (8 for one `msg.ts`).
 *
 * The counts here are MEASURED, not estimated: `ts.createSourceFile` is wrapped
 * for the duration of the transform and every call recorded with the text it was
 * handed. `typescript`'s namespace object is frozen, so the wrap is a module mock
 * — the compiler package (a linked workspace dep, inlined by vitest) sees it too.
 *
 * TRAP for anyone probing this from the other side: THIS package's tests resolve
 * `@llui/compiler` to its `dist`, not its `src`. Editing compiler sources without
 * `pnpm turbo build --filter=@llui/compiler` first leaves the old code running, so
 * a deliberately-broken probe passes and the gate looks dead when it is not.
 */

/** `[fileName, sourceText]` for every `ts.createSourceFile` call, cleared per test. */
const parses = vi.hoisted(() => [] as Array<[string, string]>)

vi.mock('typescript', async () => {
  const actual = await vi.importActual<{ default: typeof import('typescript') }>('typescript')
  const base = actual.default
  const create = base.createSourceFile
  const proxy = new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === 'createSourceFile') {
        return (...args: Parameters<typeof create>) => {
          parses.push([String(args[0]), String(args[1])])
          return create(...args)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })
  return { ...base, default: proxy }
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'llui-parse-count-'))
  parses.length = 0
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

async function runTransform(
  plugin: Plugin,
  code: string,
  id: string,
  ctx: Ctx,
): Promise<string | undefined> {
  const transform = plugin.transform as (this: unknown, c: string, i: string) => unknown
  const out = (await transform.call(ctx, code, id)) as { code: string } | undefined
  return out?.code
}

const SIBLING = ["export type SiblingMsg = { type: 'tick' } | { type: 'reset' }", ''].join('\n')

/** A component with FILE-LOCAL State/Effect and an imported Msg — the layout the
 * issue measured (file-local types + one sibling lookup). */
const COMPONENT = [
  "import { component, text } from '@llui/dom'",
  "import type { SiblingMsg } from './sibling'",
  'type State = { count: number; label: string }',
  "type Effect = { type: 'fx' }",
  'export const Counter = component<State, SiblingMsg, Effect>({',
  "  init: () => ({ count: 0, label: 'hi' }),",
  '  update: (s: State) => s,',
  "  view: ({ state }) => [text(state.at('count'))],",
  '})',
  '',
].join('\n')

/** Same component, no imports — every type declared in the file. */
const LOCAL_ONLY = [
  "import { component, text } from '@llui/dom'",
  'type State = { count: number; label: string }',
  "type Msg = { type: 'inc' }",
  "type Effect = { type: 'fx' }",
  'export const Counter = component<State, Msg, Effect>({',
  "  init: () => ({ count: 0, label: 'hi' }),",
  '  update: (s: State) => s,',
  "  view: ({ state }) => [text(state.at('count'))],",
  '})',
  '',
].join('\n')

describe('parse count per dev transform (#93)', () => {
  it('parses a file-local-types component exactly once', async () => {
    const compPath = join(dir, 'app.ts')
    writeFileSync(compPath, LOCAL_ONLY)
    await runTransform(llui({ agent: true }), LOCAL_ONLY, compPath, makeCtx({}))

    // Was 17 (of 18 parses in the whole transform) before #93.
    expect(parses.filter(([, text]) => text === LOCAL_ONLY).length).toBe(1)
    // The whole transform, including synthetic snippets: the module itself plus
    // ONE `__probe.tsx` parse of the edit text the transform emitted (that probe
    // is how emitted helper calls are collected). Pinned so a re-parse creeping
    // back in anywhere fails here, not just one in the focal module.
    expect(parses.length).toBe(2)
  })

  it('parses the focal module once and each sibling once', async () => {
    const siblingPath = join(dir, 'sibling.ts')
    const compPath = join(dir, 'app.ts')
    writeFileSync(siblingPath, SIBLING)
    writeFileSync(compPath, COMPONENT)

    await runTransform(
      llui({ agent: true }),
      COMPONENT,
      compPath,
      makeCtx({ './sibling': siblingPath }),
    )

    // Was focal 14 / sibling 8 (of 23) before #93. The sibling is looked up once
    // per type argument, once per composed union member and again while the type
    // index is enriched — all of it now served from the pass's module cache.
    expect(parses.filter(([, text]) => text === COMPONENT).length).toBe(1)
    expect(parses.filter(([, text]) => text === SIBLING).length).toBe(1)
    // focal + sibling + the one `__probe.tsx` edit-text probe.
    expect(parses.length).toBe(3)
  })

  it('names the module by the id with any Vite query stripped', () => {
    // The ScriptKind is read off the extension, and a query suffix
    // (`Widget.tsx?v=abc`) hides it — the module would parse as TS and its JSX
    // misparse, in lint and the transform and the resolver at once. The parse
    // name is observable here as the importer the resolver resolves against.
    const siblingPath = join(dir, 'sibling.ts')
    const compPath = join(dir, 'app.tsx')
    writeFileSync(siblingPath, SIBLING)
    writeFileSync(compPath, COMPONENT)
    const ctx = makeCtx({ './sibling': siblingPath })

    return runTransform(llui({ agent: true }), COMPONENT, `${compPath}?v=abc`, ctx).then(
      (outCode) => {
        expect(parses.map(([name]) => name)).toContain(compPath)
        expect(parses.map(([name]) => name)).not.toContain(`${compPath}?v=abc`)
        expect([...new Set(ctx.resolve.mock.calls.map((c) => c[1]))]).toEqual([compPath])
        // …and the sibling metadata still lands, so the strip did not break
        // resolution.
        expect(outCode).toContain('"variants":{"tick":{},"reset":{}}')
      },
    )
  })
})
