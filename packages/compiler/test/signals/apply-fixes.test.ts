import { describe, it, expect } from 'vitest'
import { lintSignalSource, applyLintFixes } from '../../src/signals/rules.js'
import { applyTextEdits, mergeNonOverlapping } from '../../src/signals/apply-edits.js'

describe('applyTextEdits', () => {
  it('applies non-adjacent edits, back-to-front, preserving offsets', () => {
    // replace 'b'(1..2) with 'X' and 'd'(3..4) with 'Y' in 'abcd'
    expect(
      applyTextEdits('abcd', [
        { start: 1, end: 2, text: 'X' },
        { start: 3, end: 4, text: 'Y' },
      ]),
    ).toBe('aXcY')
  })
  it('does not mutate the input array', () => {
    const edits = [
      { start: 2, end: 3, text: 'Z' },
      { start: 0, end: 1, text: 'A' },
    ]
    applyTextEdits('abc', edits)
    expect(edits[0]!.start).toBe(2) // still in original order
  })
})

describe('mergeNonOverlapping', () => {
  it('keeps the earliest edit at a span and skips overlappers', () => {
    const { kept, skipped } = mergeNonOverlapping([
      { start: 0, end: 4, text: 'X' },
      { start: 2, end: 6, text: 'Y' }, // overlaps the first
      { start: 6, end: 8, text: 'Z' },
    ])
    expect(kept).toHaveLength(2)
    expect(skipped).toBe(1)
  })
})

describe('applyLintFixes (round-trip)', () => {
  it('rewrites camelCase tabIndex to HTML-native lowercase and re-lints clean', () => {
    const src = "div({ role: 'button', tabIndex: 0, onClick: () => 0 }, [])"
    const msgs = lintSignalSource(src)
    const { code, applied } = applyLintFixes(src, msgs)
    expect(applied).toBe(1)
    expect(code).toContain('tabindex: 0')
    expect(code).not.toContain('tabIndex')
    // fixed source no longer carries a convention diagnostic
    expect(lintSignalSource(code).map((m) => m.rule)).not.toContain('convention')
  })

  it('fixes a miscased handler so it would bind, and clears the diagnostic', () => {
    const src = 'div({ onclick: () => 0, role: "button", tabindex: 0 }, [])'
    const { code } = applyLintFixes(src, lintSignalSource(src))
    expect(code).toContain('onClick: () => 0')
    expect(lintSignalSource(code).map((m) => m.rule)).not.toContain('event-handler-casing')
  })

  it('applies several distinct renames in one pass', () => {
    const src = "div({ className: 'x', tabIndex: 0, onclick: () => 0 }, [])"
    const { code, applied } = applyLintFixes(src, lintSignalSource(src))
    expect(applied).toBe(3)
    expect(code).toContain("class: 'x'")
    expect(code).toContain('tabindex: 0')
    expect(code).toContain('onClick: () => 0')
  })

  it('is a no-op when no message carries a fix', () => {
    const src = "div({ class: 'x' }, [])"
    const { code, applied } = applyLintFixes(src, lintSignalSource(src))
    expect(code).toBe(src)
    expect(applied).toBe(0)
  })

  it('lets a caller apply only a filtered subset (e.g. convention)', () => {
    const src = "div({ className: 'x', tabIndex: 0 }, [])"
    const conventionOnly = lintSignalSource(src).filter((m) => m.rule === 'convention')
    const { code, applied } = applyLintFixes(src, conventionOnly)
    expect(applied).toBe(1)
    expect(code).toContain('tabindex: 0')
    expect(code).toContain("className: 'x'") // broken-attr fix NOT applied
  })
})
