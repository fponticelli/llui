import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform.js'

/**
 * v2c pipeline integration — `transformLlui` accepts a `crossFilePaths`
 * argument that merges into the file's reactive-path set before bit
 * assignment.
 *
 * The Vite adapter computes `crossFilePaths` via `crossFileAccessorPaths`
 * over a project-wide `ts.Program`; the engine itself stays AST-only
 * (v2a §2.2 floor). These tests verify the path-merging plumbing
 * without needing a Program — the adapter wiring is exercised
 * separately by the Vite-plugin integration tests.
 */

const FOCAL = `
import { component, div, text } from '@llui/dom'

type State = { count: number; label: string; remoteFlag: boolean }
type Msg = { type: 'inc' }

export const C = component<State, Msg>({
  name: 'C',
  init: () => [{ count: 0, label: 'x', remoteFlag: false }, []],
  update: (s, _m) => [s, []],
  view: ({ text }) => [div({}, [text((s) => String(s.count))])],
})
`

describe('transformLlui cross-file-paths plumbing (v2c)', () => {
  it('without crossFilePaths, only `count` lands in __prefixes', () => {
    const result = transformLlui(FOCAL, '/test.ts', false, false)
    expect(result).not.toBeNull()
    expect(result!.output).toContain('count')
    // The other state fields are declared in the type but no accessor
    // reads them — they should NOT appear in the __prefixes table.
    const prefixesMatch = result!.output.match(/__prefixes:\s*\[([^\]]*)\]/)
    expect(prefixesMatch).not.toBeNull()
    expect(prefixesMatch![1]).not.toMatch(/\bremoteFlag\b/)
  })

  it('with crossFilePaths, the extra paths land in __prefixes alongside the local ones', () => {
    const result = transformLlui(
      FOCAL,
      '/test.ts',
      false,
      false,
      null,
      false,
      undefined,
      undefined,
      new Set(['remoteFlag', 'label']),
    )
    expect(result).not.toBeNull()
    const prefixesMatch = result!.output.match(/__prefixes:\s*\[([^\]]*)\]/)
    expect(prefixesMatch).not.toBeNull()
    expect(prefixesMatch![1]).toMatch(/\bcount\b/)
    expect(prefixesMatch![1]).toMatch(/\bremoteFlag\b/)
    expect(prefixesMatch![1]).toMatch(/\blabel\b/)
  })

  it('crossFilePaths that duplicate file-local paths do not double-count', () => {
    // `count` is already read by the local accessor; passing it via
    // crossFilePaths must not produce two bits.
    const result = transformLlui(
      FOCAL,
      '/test.ts',
      false,
      false,
      null,
      false,
      undefined,
      undefined,
      new Set(['count', 'remoteFlag']),
    )
    expect(result).not.toBeNull()
    const prefixesMatch = result!.output.match(/__prefixes:\s*\[([^\]]*)\]/)
    expect(prefixesMatch).not.toBeNull()
    const countOccurrences = ((prefixesMatch![1] ?? '').match(/\bs\.count\b/g) ?? []).length
    expect(countOccurrences).toBe(1)
  })
})
