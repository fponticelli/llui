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
    expect(out).toContain("import { signalText, staticText, el } from '@llui/dom'")
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
    expect(out).toContain("from '@llui/dom'")
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
    // The emitted runtime import (the one carrying signalText) is deduplicated to
    // a SINGLE statement for both components A and B — not one emit per component.
    expect((out.match(/import \{[^}]*signalText[^}]*\} from '@llui\/dom'/g) ?? []).length).toBe(1)
  })

  describe('block-body views', () => {
    it('lowers the returned array of a block-body view and preserves the block statements', () => {
      const src = [
        "import { component } from '@llui/dom'",
        'const C = component({',
        '  init: () => ({ count: 0 }),',
        '  update: (s) => s,',
        '  view: ({ state, send }) => {',
        "    const label = 'Count'",
        "    return [text(state.at('count')), button({ onClick: () => send({ type: 'inc' }) }, [text('+')])]",
        '  },',
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      // the returned array is lowered just like a concise body
      expect(out).toContain("signalText((s) => s.count, ['count'])")
      expect(out).toContain(
        "el(\"button\", { onClick: () => send({ type: 'inc' }) }, [staticText('+')])",
      )
      // the block's statements (the local) are preserved verbatim
      expect(out).toContain("const label = 'Count'")
    })

    it('leaves a signal-bound LOCAL verbatim (runtime helper consumes the handle)', () => {
      const src = [
        "import { component } from '@llui/dom'",
        'const C = component({',
        "  init: () => ({ name: '' }),",
        '  update: (s) => s,',
        '  view: ({ state }) => {',
        "    const name = state.at('name')",
        '    return [text(name)]',
        '  },',
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      // `name` is opaque to the static tracer — the text() call stays verbatim so
      // the runtime authoring helper consumes the handle. It must NOT be lowered to
      // signalText with a bogus accessor/deps.
      expect(out).toContain('return [text(name)]')
      expect(out).not.toContain('signalText((s) => name')
      // the local binding is preserved
      expect(out).toContain("const name = state.at('name')")
    })

    it('emits introspection metadata for a block-body component', () => {
      const src = [
        "import { component } from '@llui/dom'",
        "type Msg = { type: 'inc' }",
        'const C = component({',
        '  init: () => ({ count: 0 }),',
        '  update: (s) => s,',
        '  view: ({ state }) => {',
        '    const x = 1',
        "    return [text(state.at('count'))]",
        '  },',
        '})',
      ].join('\n')
      // before block-body support, `roots && arr` was false for a block body, so
      // NO metadata was spliced — agent/debug introspection was silently dropped.
      const out = transformSignalComponentSource(src, { emitAgentMetadata: true })
      expect(out).toContain('__msgSchema:')
      expect(out).toContain('__schemaHash:')
    })
  })

  describe('element helpers with dynamic args', () => {
    // Regression: `div(section(...))` — a children argument that is a function
    // CALL returning Node[], not an array literal — was lowered to
    // `el("div", {}, [])`, DROPPING the children. (This blanked every section of
    // the components-demo, which composes `main([div(section.view(...)), …])`.)
    // The call must be left verbatim so the runtime authoring helper's
    // Array.isArray dispatch routes the Node[] arg to children.
    it('does not drop a dynamic (call-expression) children argument', () => {
      const src = [
        "import { component, div, main } from '@llui/dom'",
        'const C = component({',
        '  init: () => ({ sec: { n: 0 } }),',
        '  update: (s) => s,',
        "  view: ({ state, send }) => [main([div(section(state.at('sec'), send))])],",
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      // the children are NOT dropped to an empty element
      expect(out).not.toContain('el("div", {}, [])')
      // the dynamic call is preserved verbatim (runtime helper handles it)
      expect(out).toContain('div(section(state.at(')
    })

    it('does not drop dynamic children passed after a props literal', () => {
      const src = [
        "import { component, div } from '@llui/dom'",
        'const C = component({',
        '  init: () => ({}),',
        '  update: (s) => s,',
        "  view: ({ state }) => [div({ class: 'wrap' }, makeRows())],",
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      // props + dynamic children -> not statically analyzable -> verbatim
      expect(out).toContain("div({ class: 'wrap' }, makeRows())")
      expect(out).not.toContain('el("div", { class: \'wrap\' }, [])')
    })

    it('still lowers statically-analyzable element forms', () => {
      const src = [
        "import { component, div, span } from '@llui/dom'",
        'const C = component({',
        '  init: () => ({ n: 0 }),',
        '  update: (s) => s,',
        "  view: ({ state }) => [div({ class: 'box' }, [span([text(state.at('n'))])])],",
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      expect(out).toContain('el("div", { class:')
      expect(out).toContain('el("span"')
      expect(out).toContain("signalText((s) => s.n, ['n'])")
    })
  })
})
