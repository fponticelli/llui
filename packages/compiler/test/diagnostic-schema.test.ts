import { describe, it, expect } from 'vitest'
import {
  rangeFromOffsets,
  relativizeFile,
  toCanonicalDiagnostic,
  type Diagnostic,
  type WalkerDiagnostic,
} from '../src/index.js'

/**
 * v2c §3 — canonical Diagnostic schema.
 *
 * Verifies offset→line/column resolution, path relativization, and the
 * walker-diagnostic adapter that produces a fully-formed canonical
 * Diagnostic with stable id, severity, category, and a project-relative
 * file path.
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

describe('toCanonicalDiagnostic', () => {
  const SOURCE = 'import { foo } from "./a"\nfoo()\n'
  // chars:        01234567890123456789012345 678901
  //                                              26-31 = "foo()" approximately

  it('maps an opaque-view-call WalkerDiagnostic to the canonical shape', () => {
    const walker: WalkerDiagnostic = {
      id: 'llui/opaque-view-call',
      file: '/Users/u/p/src/page.ts',
      pos: 26,
      end: 31,
      message: 'opaque call to foo',
      helperName: 'foo',
    }
    const canonical: Diagnostic = toCanonicalDiagnostic(walker, SOURCE, '/Users/u/p')
    expect(canonical.id).toBe('llui/opaque-view-call')
    expect(canonical.severity).toBe('warning')
    expect(canonical.category).toBe('reactivity')
    expect(canonical.message).toBe('opaque call to foo')
    expect(canonical.location.file).toBe('src/page.ts')
    expect(canonical.location.range.start.line).toBe(1)
    expect(canonical.location.range.end.line).toBe(1)
    expect(canonical.documentation).toBeDefined()
    expect(canonical.documentation).toMatch(/v2b\.md/)
  })

  it('maps async-view-helper to severity: error, category: composition', () => {
    const walker: WalkerDiagnostic = {
      id: 'llui/async-view-helper',
      file: '/Users/u/p/src/page.ts',
      pos: 0,
      end: 5,
      message: 'async helper',
      helperName: 'asyncFoo',
    }
    const canonical = toCanonicalDiagnostic(walker, SOURCE, '/Users/u/p')
    expect(canonical.severity).toBe('error')
    expect(canonical.category).toBe('composition')
  })

  it('maps helper-cycle to severity: warning, category: composition', () => {
    const walker: WalkerDiagnostic = {
      id: 'llui/helper-cycle',
      file: '/Users/u/p/src/page.ts',
      pos: 0,
      end: 5,
      message: 'cycle',
      helperName: 'rec',
    }
    const canonical = toCanonicalDiagnostic(walker, SOURCE, '/Users/u/p')
    expect(canonical.severity).toBe('warning')
    expect(canonical.category).toBe('composition')
  })
})
