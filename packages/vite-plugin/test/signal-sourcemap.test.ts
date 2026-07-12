import { describe, it, expect, vi } from 'vitest'
import { SourceMap } from 'node:module'
import type { Plugin } from 'vite'
import llui from '../src/index'

/**
 * Finding 3: the transform must return a REAL source map (not the
 * `{ mappings: '' }` sentinel). A token in the generated output must map
 * back to its original line via the returned map.
 */

interface TransformOut {
  code: string
  map: { version: number; sources: string[]; mappings: string; sourcesContent?: string[] } | null
}

async function runTransform(plugin: Plugin, code: string, id: string): Promise<TransformOut> {
  const ctx = {
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
  const column = idx - (lastNl + 1)
  return { line, column }
}

const SOURCE = [
  "import { component, text } from '@llui/dom'",
  'type State = { n: number }',
  'export const UniqueCounter = component<State>({',
  '  init: () => ({ n: 0 }),',
  '  update: (s) => s,',
  "  view: ({ state }) => [text(state.at('n'))],",
  '})',
].join('\n')

describe('signal transform source map', () => {
  it('returns a real v3 map (not the empty-mappings sentinel)', async () => {
    const out = await runTransform(llui(), SOURCE, '/proj/counter.ts')
    expect(out.map).not.toBeNull()
    expect(out.map!.version).toBe(3)
    expect(out.map!.mappings.length).toBeGreaterThan(0)
    expect(out.map!.sources.length).toBeGreaterThan(0)
  })

  it('maps the component identifier back to its original line', async () => {
    const out = await runTransform(llui(), SOURCE, '/proj/counter.ts')
    const gen = lineColOf(out.code, 'UniqueCounter')
    const orig = lineColOf(SOURCE, 'UniqueCounter')

    const sm = new SourceMap(out.map as unknown as ConstructorParameters<typeof SourceMap>[0])
    const entry = sm.findEntry(gen.line, gen.column)
    // findEntry returns {} when there's no mapping; a real map resolves it.
    expect('originalLine' in entry).toBe(true)
    if (!('originalLine' in entry)) throw new Error('no mapping entry')
    expect(entry.originalLine).toBe(orig.line)
  })
})
