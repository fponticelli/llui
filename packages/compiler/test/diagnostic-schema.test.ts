import { describe, it, expect } from 'vitest'
import { rangeFromOffsets, relativizeFile } from '../src/index.js'

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
