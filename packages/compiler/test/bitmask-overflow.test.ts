// Compiler-side tests for the `llui/bitmask-overflow` diagnostic
// (migrated from `@llui/eslint-plugin/test/rules/bitmask-overflow.test.ts`).
//
// The rule was an ESLint warning that fired on components reading more
// than 62 unique state paths. Promoted to a compiler error so the
// LLM-first authoring path cannot silently ship overflowing components.

import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform.js'

// Build a view body that reads N distinct state paths via text() calls.
function manyPaths(n: number): string {
  const calls: string[] = []
  for (let i = 0; i < n; i++) calls.push(`text((s) => s.f${i})`)
  return calls.join(', ')
}

function makeComponentSource(pathCount: number): string {
  return `
    import { component, div, text } from '@llui/dom'
    const App = component({
      name: 'X',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: ({ text }) => [div([${manyPaths(pathCount)}])],
    })
  `
}

describe('bitmask-overflow diagnostic', () => {
  it('emits no diagnostic at exactly 62 paths (the two-word limit)', () => {
    const result = transformLlui(makeComponentSource(62), 'fixture.ts')
    expect(result).not.toBeNull()
    const overflows = result!.diagnostics.filter((d) => d.id === 'llui/bitmask-overflow')
    expect(overflows).toHaveLength(0)
  })

  it('emits `llui/bitmask-overflow` (severity error) when a component reads 63 paths', () => {
    const result = transformLlui(makeComponentSource(63), 'fixture.ts')
    expect(result).not.toBeNull()
    const overflows = result!.diagnostics.filter((d) => d.id === 'llui/bitmask-overflow')
    expect(overflows).toHaveLength(1)
    const diag = overflows[0]!
    expect(diag.severity).toBe('error')
    expect(diag.category).toBe('perf')
    expect(diag.location.file).toBe('fixture.ts')
    expect(diag.message).toContain('63 unique state access paths')
    expect(diag.message).toContain('1 past the 62-path limit')
  })

  it('emits when a component reads 80 paths and reports the correct overflow count', () => {
    const result = transformLlui(makeComponentSource(80), 'fixture.ts')
    expect(result).not.toBeNull()
    const overflows = result!.diagnostics.filter((d) => d.id === 'llui/bitmask-overflow')
    expect(overflows).toHaveLength(1)
    expect(overflows[0]!.message).toContain('80 unique state access paths')
    expect(overflows[0]!.message).toContain('18 past the 62-path limit')
  })

  it('is silent on files without a component() call', () => {
    const source = `
      import { text } from '@llui/dom'
      export function utility() {
        return [${manyPaths(80)}]
      }
    `
    const result = transformLlui(source, 'utility.ts')
    // No component() = no compilation = either null OR a result without the
    // diagnostic. Both are fine; the contract is "don't fire on utilities".
    const overflows = (result?.diagnostics ?? []).filter((d) => d.id === 'llui/bitmask-overflow')
    expect(overflows).toHaveLength(0)
  })

  it('anchors the diagnostic on the component() call site', () => {
    const result = transformLlui(makeComponentSource(63), 'fixture.ts')
    const diag = result!.diagnostics.find((d) => d.id === 'llui/bitmask-overflow')!
    // Range start should land on the `component(` token (line > 0, since
    // the fixture has a leading newline + import).
    expect(diag.location.range.start.line).toBeGreaterThan(0)
    expect(diag.location.range.end.line).toBeGreaterThanOrEqual(diag.location.range.start.line)
  })
})
