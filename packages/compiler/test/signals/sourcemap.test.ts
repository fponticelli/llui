import { describe, it, expect } from 'vitest'
import { decode } from '@jridgewell/sourcemap-codec'
import { transformSignalComponentSourceWithMap } from '../../src/signals/transform-component.js'

/** 0-based line + column of the first occurrence of `needle` in `text`. */
function posOf(text: string, needle: string): { line: number; column: number } {
  const idx = text.indexOf(needle)
  if (idx < 0) throw new Error(`not found: ${needle}`)
  const before = text.slice(0, idx)
  const line = before.split('\n').length - 1
  const column = idx - (before.lastIndexOf('\n') + 1)
  return { line, column }
}

describe('transformSignalComponentSourceWithMap — source map (finding 9)', () => {
  const src = [
    "import { component, text } from '@llui/dom'",
    'const Counter = component({',
    '  init: () => ({ count: 0 }),',
    '  update: (s) => s,',
    "  view: ({ state }) => [text(state.at('count'))],",
    '})',
  ].join('\n')

  it('returns a v3 map with the file as its source', () => {
    const { code, map } = transformSignalComponentSourceWithMap(src, { fileName: 'counter.tsx' })
    expect(map).not.toBeNull()
    expect(code).toContain("signalText((s) => s.count, ['count'])")
    expect(map!.version).toBe(3)
    expect(map!.sources).toContain('counter.tsx')
    expect(map!.mappings.length).toBeGreaterThan(0)
  })

  it('maps a lowered-view token back to the original view line', () => {
    const { code, map } = transformSignalComponentSourceWithMap(src, { fileName: 'counter.tsx' })
    const decoded = decode(map!.mappings)

    // where the lowered call lands in the OUTPUT (the bare name also appears in the
    // injected import line, so match the call form), and the original view line
    const gen = posOf(code, 'signalText((s)')
    const origViewLine = posOf(src, 'text(state').line

    const segments = decoded[gen.line] ?? []
    expect(segments.length).toBeGreaterThan(0)
    // find the segment covering the generated column of `signalText`
    let covering = segments[0]!
    for (const seg of segments) {
      if (seg[0] <= gen.column) covering = seg
      else break
    }
    // seg = [genCol, srcIdx, srcLine, srcCol, ...] — the original line must be the
    // view line (the overwrite maps the lowered chunk to its original span's start).
    expect(covering.length).toBeGreaterThanOrEqual(4)
    expect(covering[2]).toBe(origViewLine)
  })

  it('returns a null map when there is no signal component (source unchanged)', () => {
    const plain = 'export const x = 1'
    const { code, map } = transformSignalComponentSourceWithMap(plain)
    expect(code).toBe(plain)
    expect(map).toBeNull()
  })
})
