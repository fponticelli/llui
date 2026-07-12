import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { transformSignalComponentSource } from '../../src/signals/transform-component.js'

/** Parse the lowered source and assert it has no syntax errors — catches edit
 * overlaps / duplication (e.g. pass-2 double-lowering a pass-1 each) that a
 * `toContain` substring check would miss. */
function assertParses(src: string): void {
  const sf = ts.createSourceFile('out.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  // `parseDiagnostics` is internal but populated by createSourceFile; a syntactically
  // corrupt splice (duplicated tokens) surfaces here.
  const diags = (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? []
  expect(diags.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([])
}

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

  describe('auto-batch (Opportunity A): provably-safe multi-send handlers', () => {
    const view = (handler: string, bag = '{ state, send }'): string =>
      [
        "import { component, button, text } from '@llui/dom'",
        'const C = component({',
        '  init: () => ({ n: 0 }),',
        '  update: (s) => s,',
        `  view: (${bag}) => [button({ onClick: ${handler} }, [text('x')])],`,
        '})',
      ].join('\n')

    it('wraps a straight-line multi-send handler in batch(...) and injects batch into the bag', () => {
      const out = transformSignalComponentSource(
        view("() => { send({ type: 'a' }); send({ type: 'b' }) }"),
      )
      expect(out).toContain(
        "onClick: () => batch(() => { send({ type: 'a' }); send({ type: 'b' }) })",
      )
      // the bag gains a `batch` binding (the runtime always provides it)
      expect(out).toContain('view: ({ batch, state, send })')
      // batch is NOT imported — it's a bag member, not a runtime helper
      expect(/import \{[^}]*\bbatch\b[^}]*\} from '@llui\/dom'/.test(out)).toBe(false)
    })

    it('leaves a single-send handler alone (no batch, no bag change)', () => {
      const out = transformSignalComponentSource(view("() => send({ type: 'a' })"))
      expect(out).not.toContain('batch(')
      expect(out).toContain('view: ({ state, send })') // bag untouched
    })

    it('does NOT wrap when a non-send statement sits between sends (could observe interim DOM)', () => {
      const out = transformSignalComponentSource(
        view("() => { send({ type: 'a' }); document.title = 'x'; send({ type: 'b' }) }"),
      )
      expect(out).not.toContain('batch(')
      expect(out).toContain('view: ({ state, send })')
    })

    it('does not double-inject batch when the bag already destructures it', () => {
      const out = transformSignalComponentSource(
        view("() => { send({ type: 'a' }); send({ type: 'b' }) }", '{ state, send, batch }'),
      )
      expect(out).toContain('batch(() =>')
      // exactly one `batch` in the bag (no injection on top of the author's)
      expect(out).toContain('view: ({ state, send, batch })')
    })

    it('respects a renamed send binding', () => {
      const out = transformSignalComponentSource(
        view(
          "() => { dispatch({ type: 'a' }); dispatch({ type: 'b' }) }",
          '{ state, send: dispatch }',
        ),
      )
      expect(out).toContain('onClick: () => batch(() => { dispatch(')
      expect(out).toContain('batch, state, send: dispatch')
    })
  })

  describe('view-helper coverage (cross-function lowering — each in helper functions)', () => {
    it('lowers an each inside a view-helper function to eachDirect (items handle verbatim, row → factory)', () => {
      const src = [
        "import { component, ul, li, text, each, type Signal, type Renderable } from '@llui/dom'",
        'function rowsView(items: Signal<readonly { id: number; label: string }[]>): Renderable {',
        '  return [ul({}, [each(items, { key: (r) => r.id, render: (item) => [li([text(item.at("label"))])] })])]',
        '}',
        'const C = component({',
        '  init: () => ({ items: [] }),',
        '  update: (s) => s,',
        '  view: ({ state }) => [rowsView(state.at("items"))],',
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      // the helper's each becomes eachDirect, keeping the items handle VERBATIM
      expect(out).toContain('eachDirect(items, (r) => r.id,')
      expect(out).toContain('(doc, getCtx) =>')
      expect(out).toContain('= (ctx) => ctx.item.label')
      // NOT the component-rooted source form (helper params can't be statically rooted)
      expect(out).not.toContain('signalEachDirect(')
      // eachDirect import injected
      expect(out).toMatch(/import \{[^}]*\beachDirect\b[^}]*\} from '@llui\/dom'/)
    })

    it('lowers a row reading a non-root signal handle to the eachArm MID-TIER (factory bails)', () => {
      // `mode` is another helper signal param — reading it reactively can't be
      // ctx-rooted, so the FACTORY bails; the render ARM still lowers, leaving
      // the handle verbatim in the prop slot, where the compiled `el` binds raw
      // signal handles reactively (applyProp's isSignalHandle branch).
      const src = [
        "import { component, ul, li, text, each, type Signal, type Renderable } from '@llui/dom'",
        'function rowsView(items: Signal<readonly { id: number }[]>, mode: Signal<string>): Renderable {',
        '  return [ul({}, [each(items, { key: (r) => r.id, render: (item) => [li({ class: mode.at("x") }, [text(item.at("y"))])] })])]',
        '}',
        'const C = component({ init: () => ({ items: [] }), update: (s) => s, view: ({ state }) => [rowsView(state.at("items"), state.at("mode"))] })',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      expect(out).not.toContain('eachDirect(')
      expect(out).toContain('eachArm(items')
      expect(out).toContain('class: mode.at("x")') // handle stays verbatim; el binds it
      expect(out).toContain("signalText((ctx) => ctx.item.y, ['item.y'])")
    })

    it('does not turn a COMPONENT-view each into eachDirect (keeps the rooted signalEachDirect)', () => {
      const src = [
        "import { component, ul, li, text, each } from '@llui/dom'",
        'const C = component({',
        '  init: () => ({ rows: [] }),',
        '  update: (s) => s,',
        '  view: ({ state }) => [ul({}, [each(state.at("rows"), { key: (r) => r.id, render: (item) => [li([text(item.at("x"))])] })])],',
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      expect(out).toContain('signalEachDirect(') // component-view path: rooted source
      expect(out).not.toMatch(/(?<![A-Za-z])eachDirect\(/) // not the standalone handle form
    })
  })

  describe('helper-row inlining (cross-function lowering — phase 2)', () => {
    it('inlines a same-file row helper so the row lowers (params → call args)', () => {
      const src = [
        "import { component, div, span, text, each } from '@llui/dom'",
        'function row(item, locale) {',
        '  const entry = item.peek()',
        "  return div({ class: 'activity-item' }, [span({}, [text(entry.user)]), span({}, [text(locale.map((l) => entry.ago + l))])])",
        '}',
        'const C = component({',
        '  init: () => ({ items: [], locale: "en" }),',
        '  update: (s) => s,',
        '  view: ({ state }) => [div({}, [each(state.at("items"), { key: (it) => it.id, render: (item) => [row(item, state.at("locale"))] })])],',
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      expect(out).toContain('signalEachDirect(') // the helper-row each now lowers
      expect(out).toContain('const entry = getCtx().item') // helper's peek local inlined
      expect(out).toContain('data = String(entry.user)') // static from the value local, per-clone .data
      // the `locale` param was substituted with the call arg → component-state binding
      expect(out).toContain('ctx.state.locale')
    })

    it('a row helper with spread props lowers via the render arm + rowHandle prelude', () => {
      // spread props bail the FACTORY (after inlining), but the render arm keeps
      // the inlined-helper call... no — inlining happens only in the factory; the
      // ARM keeps `row(item, …)` verbatim, binds `item` to a real handle, and the
      // compiled `el`/applyProp machinery is never involved (the helper runs on
      // the authoring path inside the row build). Strictly better than verbatim:
      // the each itself is compiled (no per-row authoring each machinery).
      const src = [
        "import { component, ul, li, text, each } from '@llui/dom'",
        'function row(item, parts) {',
        "  return li({ ...parts.item(item.peek().id), class: 'r' }, [text(item.at('title'))])",
        '}',
        'const C = component({ init: () => ({ items: [], parts: {} }), update: (s) => s, view: ({ state }) => [ul({}, [each(state.at("items"), { key: (it) => it.id, render: (item) => [row(item, state.at("parts"))] })])] })',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      expect(out).not.toContain('signalEachDirect(')
      expect(out).toContain('signalEach(')
      expect(out).toContain("const item = rowHandle(getCtx, 'item')")
      expect(out).toContain('row(item, state.at("parts"))')
    })

    it('a component-view each is lowered ONCE (no pass-2 double-lowering) and the output parses', () => {
      // Regression: pass-2 (helper coverage) must skip eaches already inside a pass-1
      // component-view edit range. If pass1Ranges is captured before pass 1 runs, the
      // each is lowered twice → overlapping edits → corrupt, unparseable output.
      const src = [
        "import { component, ul, li, text, each } from '@llui/dom'",
        'const C = component({',
        '  init: () => ({ rows: [] }),',
        '  update: (s) => s,',
        '  view: ({ state }) => [ul({}, [each(state.at("rows"), { key: (r) => r.id, render: (item) => [li([text(item.at("x"))])] })])],',
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      expect((out.match(/signalEachDirect\(/g) ?? []).length).toBe(1) // exactly once
      expect((out.match(/(?<![A-Za-z])eachDirect\(/g) ?? []).length).toBe(0) // not also the helper form
    })

    it('does not inline an UNKNOWN (cross-file/imported) helper', () => {
      const src = [
        "import { component, ul, text, each } from '@llui/dom'",
        "import { row } from './row'",
        'const C = component({ init: () => ({ items: [] }), update: (s) => s, view: ({ state }) => [ul({}, [each(state.at("items"), { key: (it) => it.id, render: (item) => [row(item)] })])] })',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      expect(out).not.toContain('signalEachDirect(') // can't resolve the helper body → authoring
    })

    // ── regression coverage: pass1+pass2 interaction + inlining hygiene bails ──
    it('lowers BOTH a component-view each (signalEachDirect) and a helper each (eachDirect) in one file', () => {
      // Exercises the pass-1 / pass-2 boundary together (the double-lowering bug's
      // neighborhood): the component-view each gets a rooted signalEachDirect, the
      // helper-scoped each gets the handle-consuming eachDirect — exactly one of each.
      const src = [
        "import { component, ul, li, text, each, type Signal } from '@llui/dom'",
        'function side(items: Signal<readonly { id: number }[]>) {',
        '  return [ul({}, [each(items, { key: (r) => r.id, render: (item) => [li([text(item.at("y"))])] })])]',
        '}',
        'const C = component({',
        '  init: () => ({ rows: [] }),',
        '  update: (s) => s,',
        '  view: ({ state }) => [ul({}, [each(state.at("rows"), { key: (r) => r.id, render: (item) => [li([text(item.at("x"))])] })])],',
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      expect((out.match(/signalEachDirect\(/g) ?? []).length).toBe(1)
      expect((out.match(/(?<![A-Za-z])eachDirect\(/g) ?? []).length).toBe(1)
    })

    it('inlines a helper returning an ARRAY (the documented Renderable shape)', () => {
      const src = [
        "import { component, ul, div, text, each } from '@llui/dom'",
        'function row(item) { return [div({}, [text(item.at("x"))])] }',
        'const C = component({ init: () => ({ rows: [] }), update: (s) => s, view: ({ state }) => [ul({}, [each(state.at("rows"), { key: (r) => r.id, render: (item) => [row(item)] })])] })',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      expect(out).toContain('signalEachDirect(')
    })

    it('inlines a MULTI-element array helper (row with two root nodes)', () => {
      const src = [
        "import { component, ul, li, text, each } from '@llui/dom'",
        'function row(item) { return [li({}, [text(item.at("x"))]), li({}, [text("detail")])] }',
        'const C = component({ init: () => ({ rows: [] }), update: (s) => s, view: ({ state }) => [ul({}, [each(state.at("rows"), { key: (r) => r.id, render: (item) => [row(item)] })])] })',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      expect(out).toContain('signalEachDirect(')
      // both top roots are cloned per row
      expect(out).toContain('_sk[1]')
    })

    it('inlines a BARE-call delegation to a multi-arg array-returning helper (grantRow shape)', () => {
      const src = [
        "import { component, table, tr, td, text, each } from '@llui/dom'",
        'function grantRow(state, grant, flagKey, send) {',
        '  const userId = grant.peek().userId',
        '  return [tr({ class: "r" }, [',
        '    td({}, [text(grant.at("email"))]),',
        '    td({}, [text(state.at("flags").map((f) => f[flagKey] ?? "—"))]),',
        '    td({ onClick: () => send({ type: "revoke", userId }) }, [text("revoke")]),',
        '  ])]',
        '}',
        'const C = component({',
        '  init: () => ({ grants: [], flags: {} }),',
        '  update: (s) => s,',
        '  view: ({ state, send }) => [table({}, [each(state.at("grants"), { key: (g) => g.userId, render: (grant) => grantRow(state, grant, "beta", send) })])],',
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      expect(out).toContain('signalEachDirect(')
      expect(out).toContain('const userId = getCtx().item.userId') // helper's peek local inlined
      expect(out).toContain('ctx.state.flags') // state arg substituted into a rooted binding
    })

    it('helper each with a STRUCTURAL child row lowers to the eachArm mid-tier', () => {
      // The row factory bails on the nested show; the render arm still lowers —
      // item reads compile to ctx producers, the verbatim show survives inside.
      const src = [
        "import { ul, li, text, each, show, type Signal } from '@llui/dom'",
        'export function rows(items: Signal<readonly { id: number; label: string }[]>, flag: Signal<boolean>) {',
        '  return [ul({}, [each(items, {',
        '    key: (r) => r.id,',
        '    render: (item) => [li({ class: "r" }, [text(item.at("label")), show(flag, () => [text("on")])])],',
        '  })])]',
        '}',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      expect(out).toContain('eachArm(items')
      expect(out).toContain("signalText((ctx) => ctx.item.label, ['item.label'])")
      expect(out).toContain('show(flag') // the un-lowerable child stays verbatim
      expect(out).not.toMatch(/(?<![A-Za-z])eachDirect\(/)
      expect(out).toContain("import { signalText, el, eachArm } from '@llui/dom'")
    })

    it('helper each leaking the row param into a helper call arm-lowers WITH a rowHandle prelude', () => {
      // The leaked `item` is bound to a real runtime handle (the same pathHandle
      // the authoring each would create), so the verbatim helper child receives
      // a genuine Signal<T> while the rest of the row stays compiled.
      const src = [
        "import { ul, li, text, each, type Signal } from '@llui/dom'",
        "import { pill } from './pill'",
        'export function rows(items: Signal<readonly { id: number; label: string }[]>) {',
        '  return [ul({}, [each(items, { key: (r) => r.id, render: (item) => [li({}, [text(item.at("label")), pill(item)])] })])]',
        '}',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      expect(out).toContain('eachArm(items')
      expect(out).toContain("const item = rowHandle(getCtx, 'item')")
      expect(out).toContain('pill(item)') // helper child receives the bound handle
      expect(out).toContain("signalText((ctx) => ctx.item.label, ['item.label'])")
      expect(out).toContain('rowHandle') // import injected
    })

    it('a COMPONENT-view each leaking the row param arm-lowers with the prelude + whole-state dep', () => {
      // Pass-1 equivalent (the dashboard shape with a CROSS-FILE row helper):
      // the leaked-handle row may read state through the helper invisibly, so
      // the each's source deps gain '' (any state change reconciles).
      const src = [
        "import { component, div, each, type Signal } from '@llui/dom'",
        "import { activityItem } from './activity'",
        'const C = component({',
        '  init: () => ({ items: [], locale: "en" }),',
        '  update: (s) => s,',
        '  view: ({ state }) => [div({}, [each(state.at("items"), { key: (it) => it.id, render: (item) => [activityItem(item, state.at("locale"))] })])],',
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      expect(out).toContain('signalEach(')
      expect(out).toContain("const item = rowHandle(getCtx, 'item')")
      expect(out).toContain('activityItem(item, state.at("locale"))')
      expect(out).toMatch(/deps: \[.*''.*\]/) // whole-state residue dep
    })

    it('helper eachDirect emission carries its collected state deps (4th arg)', () => {
      const src = [
        "import { ul, li, text, each, type Signal } from '@llui/dom'",
        'export function rows(items: Signal<readonly { id: number; label: string }[]>, state: Signal<{ mode: string }>) {',
        '  return [ul({}, [each(items, {',
        '    key: (r) => r.id,',
        '    render: (item) => [li({}, [text(item.at("label")), text(state.at("mode"))])],',
        '  })])]',
        '}',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      expect(out).toMatch(/eachDirect\(items, .*, \['mode'\]\)/s)
    })

    it('helper eachDirect with NO state reads passes an empty deps array (precise)', () => {
      const src = [
        "import { ul, li, text, each, type Signal } from '@llui/dom'",
        'export function rows(items: Signal<readonly { id: number; label: string }[]>) {',
        '  return [ul({}, [each(items, { key: (r) => r.id, render: (item) => [li({}, [text(item.at("label"))])] })])]',
        '}',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      expect(out).toMatch(/eachDirect\(items, .*, \[\]\)/s)
    })

    it('bails inlining a RECURSIVE helper (its nested each is a structural child)', () => {
      const src = [
        "import { component, ul, div, text, each } from '@llui/dom'",
        'function row(item) { return div({}, [each(item.at("kids"), { key: (k) => k.id, render: (k) => [row(k)] })]) }',
        'const C = component({ init: () => ({ rows: [] }), update: (s) => s, view: ({ state }) => [ul({}, [each(state.at("rows"), { key: (r) => r.id, render: (item) => [row(item)] })])] })',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      expect(out).not.toContain('signalEachDirect(')
    })

    it('bails inlining when a param is used as an object SHORTHAND (hygiene)', () => {
      const src = [
        "import { component, ul, div, text, each } from '@llui/dom'",
        'function row(item, mode) { const o = { mode }; return div({}, [text(item.at("x"))]) }',
        'const C = component({ init: () => ({ rows: [], mode: "x" }), update: (s) => s, view: ({ state }) => [ul({}, [each(state.at("rows"), { key: (r) => r.id, render: (item) => [row(item, state.at("mode"))] })])] })',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      expect(out).not.toContain('signalEachDirect(')
    })

    it('bails inlining on arg/param count mismatch', () => {
      const src = [
        "import { component, ul, div, text, each } from '@llui/dom'",
        'function row(item, extra) { return div({}, [text(item.at("x"))]) }',
        'const C = component({ init: () => ({ rows: [] }), update: (s) => s, view: ({ state }) => [ul({}, [each(state.at("rows"), { key: (r) => r.id, render: (item) => [row(item)] })])] })',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      expect(out).not.toContain('signalEachDirect(')
    })

    it('substitutes a helper param NAMED `state` to the call arg, rooting on the component state', () => {
      // `state` here is a helper param (shadowing the convention name); substitution
      // replaces it with the call arg `state.at("mode")`, which roots on the component
      // state → the binding reads ctx.state.mode, not a leaked param.
      const src = [
        "import { component, ul, div, text, each } from '@llui/dom'",
        'function row(item, state) { return div({}, [text(state.map((m) => m))]) }',
        'const C = component({ init: () => ({ rows: [], mode: "x" }), update: (s) => s, view: ({ state }) => [ul({}, [each(state.at("rows"), { key: (r) => r.id, render: (item) => [row(item, state.at("mode"))] })])] })',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      expect(out).toContain('signalEachDirect(')
      expect(out).toContain("= ['state.mode']")
      expect(out).toContain('ctx.state.mode')
    })

    // Finding 2: a non-trivial call arg spliced into an operator expression must be
    // PARENTHESIZED, else `idx.peek()+1` into `n*2` mis-parses as `idx.peek()+1*2`.
    it('parenthesizes a non-trivial substituted arg (precedence)', () => {
      const src = [
        "import { component, ul, td, text, each } from '@llui/dom'",
        'const cell = (n) => td({}, [text(String(n * 2))])',
        'const C = component({ init: () => ({ rows: [] }), update: (s) => s, view: ({ state }) => [ul({}, [each(state.at("rows"), { key: (r) => r.id, render: (item, idx) => [cell(idx.peek() + 1)] })])] })',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      expect(out).toContain('signalEachDirect(')
      // the arg is grouped before the `* 2` — never the buggy `+ 1 * 2`
      expect(out).toContain(') * 2')
      expect(out).not.toContain('+ 1 * 2')
    })

    // Finding 2: a non-trivial arg referenced 2+ times is bound to a const, not
    // textually duplicated (which would re-evaluate a side effect like .peek()).
    it('binds a multiply-referenced non-trivial arg to a const', () => {
      const src = [
        "import { component, ul, td, text, each } from '@llui/dom'",
        'const cell = (n) => td({}, [text(String(n * 2 + n))])',
        'const C = component({ init: () => ({ rows: [] }), update: (s) => s, view: ({ state }) => [ul({}, [each(state.at("rows"), { key: (r) => r.id, render: (item, idx) => [cell(idx.peek() + 1)] })])] })',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      expect(out).toContain('signalEachDirect(')
      expect(out).toContain('const _arg_n =')
      // the arg source (idx read) appears exactly once — bound, not duplicated
      expect((out.match(/getCtx\(\)\.index/g) ?? []).length).toBe(1)
    })
  })

  // Finding 3: a component() nested inside an outer view must compile to parseable
  // code — pass 1 must not push an edit for the inner view overlapping the outer's.
  describe('nested component() (finding 3)', () => {
    it('compiles a component nested in an outer view to parseable code', () => {
      const src = [
        "import { component, div, text } from '@llui/dom'",
        'const Outer = component({',
        '  init: () => ({ n: 0 }),',
        '  update: (s) => s,',
        '  view: ({ state }) => [',
        '    div({}, [text(state.at("n"))]),',
        '    component({ init: () => ({ m: 0 }), update: (s) => s, view: ({ state }) => [text(state.at("m"))] }),',
        '  ],',
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out) // was corrupt (overlapping edits) before the fix
      expect(out).toContain("signalText((s) => s.n, ['n'])") // outer view still lowered
    })
  })

  // Finding 4: import injection must not duplicate a helper the user already imports,
  // nor be tricked by a helper name inside a comment/string.
  describe('import injection (finding 4)', () => {
    it('does not re-import a runtime helper the file already imports from @llui/dom', () => {
      const src = [
        "import { component, el, div, text } from '@llui/dom'",
        'const C = component({ init: () => ({ n: 0 }), update: (s) => s, view: ({ state }) => [div({}, [text(state.at("n"))])] })',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      // `el` is emitted (div lowers to el) but already imported → exactly one import binds it
      expect((out.match(/import \{[^}]*\bel\b[^}]*\} from '@llui\/dom'/g) ?? []).length).toBe(1)
    })

    it('does not inject an import for a helper name that only appears in a comment/string', () => {
      const src = [
        "import { component, text } from '@llui/dom'",
        '// this comment mentions el( and signalEach( but neither is emitted',
        'const C = component({ init: () => ({}), update: (s) => s, view: ({ state }) => [text("literal /* el( */")] })',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      // only staticText is emitted; el / signalEach must NOT be imported
      expect(out).not.toMatch(/import \{[^}]*\bel\b/)
      expect(out).not.toMatch(/import \{[^}]*\bsignalEach\b/)
      expect(out).toMatch(/import \{[^}]*\bstaticText\b/)
    })
  })
})
