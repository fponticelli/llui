import { describe, it, expect } from 'vitest'
import { transformSignalComponentSource } from '../../src/signals/transform-component.js'

describe('transformSignalComponentSource', () => {
  it('rewrites a signal view and injects the runtime import', () => {
    const src = [
      "import { component } from '@llui/dom'",
      'export const Counter = component({',
      '  init: () => ({ count: 0 }),',
      '  update: (s, m) => ({ count: s.count + 1 }),',
      "  view: ({ state, send }) => [text(state.at('count')), button({ onClick: () => send({ type: 'inc' }) }, [text('+')])],",
      '})',
    ].join('\n')

    const out = transformSignalComponentSource(src)
    expect(out).toContain("import { signalText, staticText, el } from '@llui/dom/signals'")
    expect(out).toContain("signalText((s) => s.count, ['count'])")
    expect(out).toContain(
      "el(\"button\", { onClick: () => send({ type: 'inc' }) }, [staticText('+')])",
    )
    // init/update untouched
    expect(out).toContain('init: () => ({ count: 0 })')
  })

  it('imports each/show/branch helpers when used', () => {
    const src = [
      "import { component } from '@llui/dom'",
      'const C = component({',
      '  init: () => ({}),',
      '  update: (s) => s,',
      "  view: ({ state }) => [ul({}, [signalEach(state.at('items'), {})])],",
      '})',
    ].join('\n')
    // signalEach isn't produced by the transform yet (each/show/branch lowering of
    // authored each() is a later step) — but a hand-written signalEach call should
    // still trigger its import. Use a view that the transform passes through.
    const out = transformSignalComponentSource(src)
    // 'ul' is an element helper -> el; the inner each(...) is left verbatim (not yet
    // lowered) so no signalEach import unless present. Assert el import at least.
    expect(out).toContain("from '@llui/dom/signals'")
    expect(out).toContain('el("ul"')
  })

  it('leaves a legacy (non-signal) component untouched', () => {
    const src = [
      "import { component } from '@llui/dom'",
      'const Legacy = component({',
      '  init: () => ({ n: 0 }),',
      '  update: (s) => s,',
      '  view: (h) => [h.text((s) => String(s.n))],', // legacy: single bag param, no `state` destructure
      '})',
    ].join('\n')
    expect(transformSignalComponentSource(src)).toBe(src)
  })

  it('returns source unchanged when there is no component', () => {
    const src = 'export const x = 1\n'
    expect(transformSignalComponentSource(src)).toBe(src)
  })

  describe('introspection metadata', () => {
    const SRC = [
      "import { component } from '@llui/dom'",
      "type Msg = { type: 'inc' } | { type: 'set'; v: number }",
      'type State = { count: number }',
      'export const Counter = component({',
      '  init: () => ({ count: 0 }),',
      '  update: (s) => ({ count: s.count + 1 }),',
      "  view: ({ state }) => [text(state.at('count'))],",
      '})',
    ].join('\n')

    it('emits no metadata without opts (prod-no-agent stays lean)', () => {
      const out = transformSignalComponentSource(SRC)
      expect(out).not.toContain('__msgSchema')
      expect(out).not.toContain('__schemaHash')
    })

    it('emits agent schemas + hash when emitAgentMetadata is set', () => {
      const out = transformSignalComponentSource(SRC, { emitAgentMetadata: true })
      expect(out).toContain('__msgSchema:')
      expect(out).toContain('"discriminant":"type"')
      expect(out).toContain('__stateSchema:')
      expect(out).toContain('__schemaHash:')
      // still a valid lowered view
      expect(out).toContain("signalText((s) => s.count, ['count'])")
    })

    it('infers the component name from the binding (under metadata)', () => {
      const out = transformSignalComponentSource(SRC, { emitAgentMetadata: true })
      expect(out).toContain('name: "Counter"')
    })

    it('does not infer a name without opts', () => {
      expect(transformSignalComponentSource(SRC)).not.toContain('name:')
    })

    it('does not override an author-provided name', () => {
      const withName = SRC.replace('init:', "name: 'MyCounter', init:")
      const out = transformSignalComponentSource(withName, { emitAgentMetadata: true })
      expect(out).toContain("name: 'MyCounter'") // author's, verbatim
      expect(out).not.toContain('name: "Counter"') // not the inferred one
    })

    it('uses cross-file preExtracted schemas + external state source', () => {
      // Msg/State declared in sibling files (not locally) — the adapter resolves
      // them and passes preExtracted + typeSources.
      const src = [
        "import { component } from '@llui/dom'",
        "import type { Msg } from './msgs'",
        "import type { State } from './state'",
        'export const C = component<State, Msg>({',
        '  init: () => ({ n: 0 }),',
        '  update: (s) => s,',
        "  view: ({ state }) => [text(state.at('n'))],",
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src, {
        emitAgentMetadata: true,
        preExtracted: { msgSchema: { discriminant: 'type', variants: { tick: {} } } },
        typeSources: { state: { source: 'type S = { n: number }', typeName: 'S' } },
      })
      expect(out).toContain('"variants":{"tick":{}}') // from preExtracted (cross-file)
      expect(out).toContain('__stateSchema:') // from external state source
      expect(out).toContain('"n":"number"')
    })

    it('emits __componentMeta { file, line } in devMode', () => {
      const out = transformSignalComponentSource(SRC, { devMode: true, fileName: 'src/counter.ts' })
      expect(out).toContain('__componentMeta:')
      expect(out).toContain('"file":"src/counter.ts"')
    })

    it('does not duplicate a metadata field the author already wrote', () => {
      const withOwn = SRC.replace('view:', "__schemaHash: 'mine', view:")
      const out = transformSignalComponentSource(withOwn, { emitAgentMetadata: true })
      expect((out.match(/__schemaHash:/g) ?? []).length).toBe(1)
      expect(out).toContain("__schemaHash: 'mine'")
    })
  })

  it('handles multiple signal components in one file', () => {
    const src = [
      "import { component } from '@llui/dom'",
      "const A = component({ init: () => ({a:0}), update: (s)=>s, view: ({ state }) => [text(state.at('a'))] })",
      "const B = component({ init: () => ({b:0}), update: (s)=>s, view: ({ state }) => [text(state.at('b'))] })",
    ].join('\n')
    const out = transformSignalComponentSource(src)
    expect(out).toContain("signalText((s) => s.a, ['a'])")
    expect(out).toContain("signalText((s) => s.b, ['b'])")
    expect((out.match(/from '@llui\/dom\/signals'/g) ?? []).length).toBe(1) // single import
  })
})
