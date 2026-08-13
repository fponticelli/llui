import { describe, it, expect } from 'vitest'
import { parseModule, rangeFromOffsets as rangeIn, relativizeFile } from '../src/index.js'

/** `rangeFromOffsets` resolves through the SourceFile's line map (#93), so the
 * text arrives parsed. */
const rangeFromOffsets = (source: string, start: number, end: number) =>
  rangeIn(parseModule('d.ts', source).sourceFile(), start, end)

/**
 * Canonical Diagnostic schema.
 *
 * Verifies offset→line/column resolution and path relativization.
 */

describe('rangeFromOffsets', () => {
  const SOURCE = 'line 0\nline 1\nline 2'
  // chars:        0123456 7890123 4567890

  it('resolves offset 0 to line 0, column 0', () => {
    const r = rangeFromOffsets(SOURCE, 0, 1)
    expect(r.start).toEqual({ line: 0, column: 0 })
    expect(r.end).toEqual({ line: 0, column: 1 })
  })

  it('resolves offsets crossing a newline', () => {
    // Start at "line 1" (offset 7), end at "line 2" (offset 14).
    const r = rangeFromOffsets(SOURCE, 7, 14)
    expect(r.start).toEqual({ line: 1, column: 0 })
    expect(r.end).toEqual({ line: 2, column: 0 })
  })

  it('resolves offset within a line to a non-zero column', () => {
    // Offset 9 is "n" inside "line 1" (line 1, column 2).
    const r = rangeFromOffsets(SOURCE, 9, 10)
    expect(r.start).toEqual({ line: 1, column: 2 })
  })

  it('clamps an out-of-range offset instead of throwing (#93)', () => {
    // The line map replaced a total linear scan. `getLineAndCharacterOfPosition`
    // THROWS a `Debug Failure` on a negative position — an emitter handing over a
    // stale or synthesized offset must still get a diagnostic, not a crash out of
    // the diagnostic path. (Past the end it does not throw, but is clamped too so
    // the position stays inside the file.)
    expect(() => rangeFromOffsets(SOURCE, -5, -1)).not.toThrow()
    expect(rangeFromOffsets(SOURCE, -5, -1).start).toEqual({ line: 0, column: 0 })
    expect(rangeFromOffsets(SOURCE, SOURCE.length + 99, SOURCE.length + 99).start).toEqual({
      line: 2,
      column: 6,
    })
  })

  it('agrees with the TypeScript line map on CRLF', () => {
    // The deleted scan counted `\n` only; the map also treats a lone `\r` (and
    // U+2028/9) as a break. CRLF is the common case and is identical either way.
    const crlf = 'line 0\r\nline 1'
    expect(rangeFromOffsets(crlf, 8, 9).start).toEqual({ line: 1, column: 0 })
  })
})

describe('relativizeFile', () => {
  it('strips a project root prefix', () => {
    expect(relativizeFile('/Users/u/p/src/main.ts', '/Users/u/p')).toBe('src/main.ts')
  })

  it('handles a root with trailing slash', () => {
    expect(relativizeFile('/Users/u/p/src/main.ts', '/Users/u/p/')).toBe('src/main.ts')
  })

  it('returns absolute path when the file is not under the root', () => {
    expect(relativizeFile('/elsewhere/file.ts', '/Users/u/p')).toBe('/elsewhere/file.ts')
  })

  it('returns absolute path when root is empty', () => {
    expect(relativizeFile('/abs/file.ts', '')).toBe('/abs/file.ts')
  })
})
