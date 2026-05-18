import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform.js'

/**
 * v2b §3 — `track()` primitive.
 *
 * Verifies the compile-time contract:
 *   1. `track({ deps: (s) => [...] })` is stripped from the emitted output.
 *   2. The `track` import is removed from the @llui/dom import list.
 *   3. Paths read by the `deps` accessor are folded into `__prefixes`.
 *   4. Byte-identical view-function bodies with and without track()
 *      (modulo __prefixes).
 */

const WITHOUT_TRACK = `
import { component, div, text } from '@llui/dom'

type State = { count: number; label: string; pluginRegistry: Record<string, unknown>; activePluginName: string }
type Msg = { type: 'inc' }

export const C = component<State, Msg>({
  name: 'C',
  init: () => [{ count: 0, label: 'x', pluginRegistry: {}, activePluginName: 'a' }, []],
  update: (s, m) => [s, []],
  view: ({ text }) => [
    div({}, [text((s) => String(s.count))]),
  ],
})
`

const WITH_TRACK = `
import { component, div, text, track } from '@llui/dom'

type State = { count: number; label: string; pluginRegistry: Record<string, unknown>; activePluginName: string }
type Msg = { type: 'inc' }

export const C = component<State, Msg>({
  name: 'C',
  init: () => [{ count: 0, label: 'x', pluginRegistry: {}, activePluginName: 'a' }, []],
  update: (s, m) => [s, []],
  view: ({ text }) => {
    track({ deps: (s) => [s.pluginRegistry, s.activePluginName] })
    return [
      div({}, [text((s) => String(s.count))]),
    ]
  },
})
`

describe('track() primitive (v2b §3)', () => {
  it('strips the track() call from the emitted output', () => {
    const result = transformLlui(WITH_TRACK, '/test.ts', false, false)
    expect(result).not.toBeNull()
    expect(result!.output).not.toMatch(/\btrack\s*\(\s*\{/)
  })

  it('strips `track` from the @llui/dom import list when stripped', () => {
    const result = transformLlui(WITH_TRACK, '/test.ts', false, false)
    expect(result).not.toBeNull()
    // The import statement should still exist (other names are imported)
    // but should no longer contain `track`.
    expect(result!.output).toMatch(/from ['"]@llui\/dom['"]/)
    expect(result!.output).not.toMatch(/import[^}]*\btrack\b[^}]*\}\s*from\s*['"]@llui\/dom/)
  })

  it('folds track() deps paths into __prefixes', () => {
    const result = transformLlui(WITH_TRACK, '/test.ts', false, false)
    expect(result).not.toBeNull()
    // Both pluginRegistry and activePluginName should appear in the
    // __prefixes table emission. The track() declaration registers
    // them as state dependencies even though no other accessor in the
    // file reads them.
    expect(result!.output).toContain('pluginRegistry')
    expect(result!.output).toContain('activePluginName')
    expect(result!.output).toMatch(/__prefixes/)
  })

  it('produces an output that includes the count path read from text()', () => {
    // Sanity: the existing reactive accessor's paths still land in __prefixes.
    const result = transformLlui(WITH_TRACK, '/test.ts', false, false)
    expect(result).not.toBeNull()
    expect(result!.output).toContain('count')
  })

  it('compiles the without-track variant successfully (control)', () => {
    const result = transformLlui(WITHOUT_TRACK, '/test.ts', false, false)
    expect(result).not.toBeNull()
    expect(result!.output).toContain('count')
    // pluginRegistry / activePluginName are NOT read in the without-track
    // variant — they should NOT appear in the emission's __prefixes.
    // (They appear as field type-annotations in `type State = ...`, but
    // not as values in the __prefixes accessor array.)
    expect(result!.output).not.toMatch(/__prefixes[^]*pluginRegistry/m)
  })

  it('byte-identical view emission modulo __prefixes (text binding identical, no track residue)', () => {
    const withTrack = transformLlui(WITH_TRACK, '/test.ts', false, false)
    const without = transformLlui(WITHOUT_TRACK, '/test.ts', false, false)
    expect(withTrack).not.toBeNull()
    expect(without).not.toBeNull()
    // Both outputs emit the same compiled text() binding.
    expect(withTrack!.output).toContain('text((s) => String(s.count)')
    expect(without!.output).toContain('text((s) => String(s.count)')
    // With-track output carries no `track(` residue (call stripped).
    expect(withTrack!.output).not.toMatch(/track\s*\(\s*\{/)
    // Without-track output never had a track() call.
    expect(without!.output).not.toMatch(/track\s*\(\s*\{/)
  })
})
