import { describe, it, expect, vi } from 'vitest'
import { SourceMap } from 'node:module'
import type { Plugin } from 'vite'
import llui from '../src/index'

/**
 * Issue #87 — the dev-relay prepend must never happen without the compensating
 * source-map shift.
 *
 * In dev + MCP the plugin prepends a 3-line relay bootstrap to every routed
 * module. The signal transform returns `map: null` when it lowered NOTHING
 * (a helper-only module whose `each()` bails), and the map compensation used to
 * be skipped in exactly that case — so every line in such a module reported 3
 * lines too low for the whole dev session.
 *
 * The offset is asserted numerically (generated line === original line +
 * BOOTSTRAP_LINES), never eyeballed.
 */

/** Lines of the relay bootstrap the plugin prepends (see `index.ts`). */
const BOOTSTRAP_LINES = 3

interface TransformOut {
  code: string
  map: { version: number; sources: string[]; mappings: string; sourcesContent?: string[] } | null
}

interface RollupCtxStub {
  warn: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
  resolve: ReturnType<typeof vi.fn>
}

async function devPlugin(): Promise<Plugin> {
  const plugin = llui({ mcpPort: 5200, devmodeAnnotate: false })
  const configResolved = plugin.configResolved as (c: {
    root: string
    command: string
  }) => void | Promise<void>
  await configResolved({ root: '/proj', command: 'serve' })
  return plugin
}

async function runTransform(plugin: Plugin, code: string, id: string): Promise<TransformOut> {
  const ctx: RollupCtxStub = {
    warn: vi.fn(),
    error: vi.fn(() => {
      throw new Error('this.error')
    }),
    resolve: vi.fn(async () => null),
  }
  const transform = plugin.transform as (this: unknown, c: string, i: string) => unknown
  return (await transform.call(ctx, code, id)) as TransformOut
}

/** 0-based line + column of a substring occurrence. */
function lineColOf(text: string, needle: string): { line: number; column: number } {
  const idx = text.indexOf(needle)
  if (idx < 0) throw new Error(`needle not found: ${needle}`)
  const before = text.slice(0, idx)
  const line = before.split('\n').length - 1
  const lastNl = before.lastIndexOf('\n')
  return { line, column: idx - (lastNl + 1) }
}

/**
 * Helper-only modules (no `component(`) that the plugin routes for their
 * `each(` — one per lowering-bail shape named in #87. Each must come back
 * VERBATIM from the transform (asserted below), which is what makes the
 * `map: null` path the one under test.
 */
const BAILING_HELPERS: ReadonlyArray<{ name: string; source: string; tokens: string[] }> = [
  {
    // `each(items, rowOpts)` — options are a variable, not an object literal.
    name: 'each options passed as a variable',
    source: [
      "import { each, li, text } from '@llui/dom'",
      'const rowOpts = { key: (t) => t.id, render: (t) => [li(text(t.name))] }',
      'export const optionVariableList = (items) => [each(items, rowOpts)]',
    ].join('\n'),
    tokens: ['rowOpts', 'optionVariableList'],
  },
  {
    // A spread in the options literal — the option walker bails conservatively.
    name: 'spread in the each options literal',
    source: [
      "import { each, li, text } from '@llui/dom'",
      'const baseOpts = { key: (t) => t.id }',
      'export const spreadOptionList = (items) =>',
      '  [each(items, { ...baseOpts, render: (t) => [li(text(t.name))] })]',
    ].join('\n'),
    tokens: ['baseOpts', 'spreadOptionList'],
  },
  {
    // A `function` render expression whose body doesn't reduce to a node array.
    name: 'function render expression with a non-array body',
    source: [
      "import { each, li, text } from '@llui/dom'",
      'export const functionRenderList = (items) =>',
      '  [each(items, { key: (t) => t.id, render: function (t) { return li(text(t.name)) } })]',
    ].join('\n'),
    tokens: ['functionRenderList', 'return li'],
  },
  {
    // A `function` render passed by reference — the row body is out of reach.
    name: 'function render passed by reference',
    source: [
      "import { each, li, text } from '@llui/dom'",
      'function renderRow(t) { return [li(text(t.name))] }',
      'export const functionRefList = (items) => [each(items, { key: (t) => t.id, render: renderRow })]',
    ].join('\n'),
    tokens: ['renderRow', 'functionRefList'],
  },
]

describe('dev-relay bootstrap source map (#87)', () => {
  for (const fixture of BAILING_HELPERS) {
    describe(fixture.name, () => {
      it('prepends the relay AND returns a map shifted by exactly the bootstrap line count', async () => {
        const plugin = await devPlugin()
        const id = '/proj/helpers.ts'
        const out = await runTransform(plugin, fixture.source, id)

        // Precondition: nothing lowered (the bail shape is still a bail), so
        // the transform handed the plugin `map: null`. If a future lowering
        // improvement covers this shape the fixture must be replaced, not the
        // assertion relaxed.
        const body = out.code.split('\n').slice(BOOTSTRAP_LINES).join('\n')
        expect(body).toBe(fixture.source)

        // The relay bootstrap really was prepended, and it is 3 lines.
        expect(out.code.startsWith('import { startRelay as __llui_startRelay }')).toBe(true)

        // …therefore a map is owed.
        expect(out.map).not.toBeNull()
        expect(out.map!.version).toBe(3)
        expect(out.map!.mappings.length).toBeGreaterThan(0)

        const sm = new SourceMap(out.map as unknown as ConstructorParameters<typeof SourceMap>[0])
        for (const token of fixture.tokens) {
          const orig = lineColOf(fixture.source, token)
          const gen = lineColOf(out.code, token)
          // Known offset — the prepend moved every line down by exactly 3.
          expect(gen.line).toBe(orig.line + BOOTSTRAP_LINES)
          const entry = sm.findEntry(gen.line, gen.column)
          expect('originalLine' in entry).toBe(true)
          if (!('originalLine' in entry)) throw new Error('no mapping entry')
          expect(entry.originalLine).toBe(orig.line)
        }
      })

      it('leaves the bootstrap lines themselves unmapped', async () => {
        const plugin = await devPlugin()
        const out = await runTransform(plugin, fixture.source, '/proj/helpers.ts')
        // K leading `;` groups = K generated lines with no segments.
        expect(out.map!.mappings.startsWith(';'.repeat(BOOTSTRAP_LINES))).toBe(true)
        expect(out.map!.mappings.startsWith(';'.repeat(BOOTSTRAP_LINES + 1))).toBe(false)
      })
    })
  }

  it('a module that DOES lower keeps its shifted map (the fixed path stays fixed)', async () => {
    const plugin = await devPlugin()
    const source = [
      "import { component, text } from '@llui/dom'",
      'type State = { n: number }',
      'export const ShiftedCounter = component<State>({',
      '  init: () => ({ n: 0 }),',
      '  update: (s) => s,',
      "  view: ({ state }) => [text(state.at('n'))],",
      '})',
    ].join('\n')
    const out = await runTransform(plugin, source, '/proj/counter.ts')
    expect(out.map).not.toBeNull()
    const orig = lineColOf(source, 'ShiftedCounter')
    const gen = lineColOf(out.code, 'ShiftedCounter')
    const sm = new SourceMap(out.map as unknown as ConstructorParameters<typeof SourceMap>[0])
    const entry = sm.findEntry(gen.line, gen.column)
    if (!('originalLine' in entry)) throw new Error('no mapping entry')
    expect(entry.originalLine).toBe(orig.line)
  })

  it('without the relay (no MCP) an untouched helper module still returns no map', async () => {
    // The compensation must not turn into an unconditional map-synthesis cost
    // on the path that prepends nothing.
    const plugin = llui({ mcpPort: false, devmodeAnnotate: false })
    const configResolved = plugin.configResolved as (c: {
      root: string
      command: string
    }) => void | Promise<void>
    await configResolved({ root: '/proj', command: 'serve' })
    const out = await runTransform(plugin, BAILING_HELPERS[0]!.source, '/proj/helpers.ts')
    expect(out.code).toBe(BAILING_HELPERS[0]!.source)
    expect(out.map).toBeNull()
  })
})
