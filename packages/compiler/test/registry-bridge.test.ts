import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform.js'

/**
 * v2c bridge — registry-into-transformLlui integration.
 *
 * The bridge collects emissions from active CompilerModules during a
 * single AST pass over the source file and splices them into the
 * matching `component()` call's config-arg, replacing the inline
 * `inject*` helpers progressively. This commit migrates the first
 * inline injector — `injectComponentMeta` — through the bridge.
 *
 * The dev-mode gating semantics are preserved: `componentMetaModule`
 * is in the active list iff `devMode === true`, matching the
 * monolith's previous `if (devMode) injectComponentMeta(...)`.
 *
 * Future bridge wins (deferred):
 *   - `__prefixes` migration (reactivePathsModule already exists; needs
 *     the monolith's structural-mask emission path to step out of the
 *     way first — `__prefixes` is currently constructed inline by
 *     `buildPrefixesProp`).
 *   - `__schemaHash` activation (waits for msg-schema + state-schema +
 *     msg-annotations modules to populate the inputs slot).
 *   - `__msgSchema`, `__msgAnnotations`, `__effectSchema` migrations.
 */

const FIXTURE = `
import { component, div, text } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'inc' }

export const C = component<State, Msg>({
  name: 'C',
  init: () => [{ count: 0 }, []],
  update: (s, _m) => [s, []],
  view: ({ text }) => [div({}, [text((s) => String(s.count))])],
})
`

describe('v2c bridge — componentMetaModule via registry', () => {
  it('emits __componentMeta in dev mode', () => {
    const result = transformLlui(FIXTURE, '/page.ts', /*devMode*/ true, false)
    expect(result).not.toBeNull()
    expect(result!.output).toContain('__componentMeta')
    // The emission should carry both `file` and `line` keys per the
    // module's emit shape.
    expect(result!.output).toMatch(/__componentMeta\s*:\s*\{[^}]*file\s*:\s*['"]\/page\.ts['"]/)
    expect(result!.output).toMatch(/__componentMeta\s*:\s*\{[^}]*line\s*:\s*\d+/)
  })

  it('does not emit __componentMeta in production mode', () => {
    const result = transformLlui(FIXTURE, '/page.ts', /*devMode*/ false, false)
    expect(result).not.toBeNull()
    expect(result!.output).not.toContain('__componentMeta')
  })

  it('keeps __compilerVersion + __lluiCompilerEmitted regardless of mode', () => {
    // Sanity: the bridge migration of __componentMeta does not affect
    // the always-on integrity + version stamping path.
    const dev = transformLlui(FIXTURE, '/page.ts', true, false)
    const prod = transformLlui(FIXTURE, '/page.ts', false, false)
    expect(dev!.output).toContain('__compilerVersion')
    expect(dev!.output).toContain('__lluiCompilerEmitted')
    expect(prod!.output).toContain('__compilerVersion')
    expect(prod!.output).toContain('__lluiCompilerEmitted')
  })

  it('emits __componentMeta with line matching the component() call site', () => {
    // Two-component file: each component() must get its own
    // __componentMeta whose `line` points at the right source line.
    const src = `
import { component, div, text } from '@llui/dom'

type S = { n: number }

export const A = component<S, { type: 'a' }>({
  name: 'A',
  init: () => [{ n: 0 }, []],
  update: (s) => [s, []],
  view: ({ text }) => [div({}, [text((s) => String(s.n))])],
})

export const B = component<S, { type: 'b' }>({
  name: 'B',
  init: () => [{ n: 0 }, []],
  update: (s) => [s, []],
  view: ({ text }) => [div({}, [text((s) => String(s.n))])],
})
`
    const result = transformLlui(src, '/multi.ts', true, false)
    expect(result).not.toBeNull()
    // Two __componentMeta emissions, each with a distinct line.
    const lineMatches = [
      ...result!.output.matchAll(/__componentMeta\s*:\s*\{[^}]*line\s*:\s*(\d+)/g),
    ]
    expect(lineMatches.length).toBe(2)
    const lines = lineMatches.map((m) => Number(m[1]!)).sort((a, b) => a - b)
    expect(lines[0]).toBeLessThan(lines[1]!)
  })
})
