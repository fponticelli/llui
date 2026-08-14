import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { transformSignalComponentSource } from '../parsed.js'
import { parseModule } from '../../src/parse.js'
import { COMPILER_META_KEYS } from '../../src/emit-names.js'
import { crossFileKey, type CrossFileResolution } from '../../src/cross-file-resolver.js'

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

/** Every identifier the module's TOP-LEVEL statements bind in the value namespace —
 * imports of any kind, `const`/`let`/`var` (destructuring included), function/class/
 * enum declarations. Written independently of the compiler's own collector so the
 * duplicate-binding assertions below fail if that collector stops being consulted. */
function topLevelBindingNames(src: string): string[] {
  const sf = ts.createSourceFile('out.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const out: string[] = []
  const addBindingName = (n: ts.BindingName): void => {
    if (ts.isIdentifier(n)) out.push(n.text)
    else for (const el of n.elements) if (ts.isBindingElement(el)) addBindingName(el.name)
  }
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) {
      const clause = st.importClause
      if (!clause) continue
      if (clause.name) out.push(clause.name.text)
      const nb = clause.namedBindings
      if (nb && ts.isNamespaceImport(nb)) out.push(nb.name.text)
      else if (nb && ts.isNamedImports(nb)) for (const spec of nb.elements) out.push(spec.name.text)
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) addBindingName(d.name)
    } else if (
      (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) &&
      st.name &&
      ts.isIdentifier(st.name)
    ) {
      out.push(st.name.text)
    } else if (ts.isEnumDeclaration(st)) {
      out.push(st.name.text)
    }
  }
  return out
}

/** A duplicate top-level binding is a SyntaxError in the emitted module (issue #90) —
 * and one the parser alone does NOT report, so it needs its own check. */
function assertNoDuplicateTopLevelBindings(src: string): void {
  const names = topLevelBindingNames(src)
  expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([])
}

/** The local name any `@llui/dom` import in `src` binds the export `helper` to
 * (its canonical name, or the alias chosen around a collision), or null when the
 * file imports it under no name at all. */
function injectedBindingFor(src: string, helper: string): string | null {
  const sf = ts.createSourceFile('out.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  for (const st of sf.statements) {
    if (
      !ts.isImportDeclaration(st) ||
      !ts.isStringLiteral(st.moduleSpecifier) ||
      st.moduleSpecifier.text !== '@llui/dom'
    ) {
      continue
    }
    const nb = st.importClause?.namedBindings
    if (!nb || !ts.isNamedImports(nb)) continue
    for (const spec of nb.elements) {
      if ((spec.propertyName ?? spec.name).text === helper) return spec.name.text
    }
  }
  return null
}

/** One node built by the stub runtime below. */
interface StubNode {
  helper: string
  tag?: unknown
}

/** Execute a transformed module against a STUB `@llui/dom` and return what its
 * component's `view` builds. This is the behavioural half of the #90 gate: it
 * proves WHICH binding the lowered call reached, where a text assertion could
 * not — a skipped injection (or an alias not threaded into the call sites) makes
 * the view call the fixture's own `el`, which throws.
 *
 * The transform's output is ESM; rewrite its `@llui/dom` imports to a destructure
 * of the stub (and drop `export`) so it runs as a plain function body. Fixtures
 * used here are written without type annotations so the result is valid JS. */
function runLoweredView(out: string): StubNode[] {
  const js = out
    .replace(
      /import \{([^}]*)\} from '@llui\/dom'/g,
      (_m, names: string) => `const { ${names.replace(/(\w+) as (\w+)/g, '$1: $2')} } = __dom`,
    )
    .replace(/^export /gm, '')
  const node = (helper: string) => (tag?: unknown) => ({ helper, tag })
  const stub = {
    component: (config: unknown) => config,
    el: node('el'),
    signalText: node('signalText'),
    staticText: node('staticText'),
    div: () => {
      throw new Error('authoring `div` must not run in lowered output')
    },
    text: () => {
      throw new Error('authoring `text` must not run in lowered output')
    },
  }
  const build = new Function('__dom', `${js}\nreturn C.view({ state: {}, send: () => {} })`)
  const built: unknown = build(stub)
  if (!Array.isArray(built)) throw new Error('view did not return an array')
  return built.map((n: unknown) => {
    if (typeof n !== 'object' || n === null || !('helper' in n) || typeof n.helper !== 'string') {
      throw new Error(`unexpected view node: ${String(n)}`)
    }
    return { helper: n.helper, tag: 'tag' in n ? n.tag : undefined }
  })
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
      "  view: ({ state }) => [ul([signalEach(state.at('items'), {})])],",
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
      expect(out).not.toContain(`${COMPILER_META_KEYS.msgSchema}:`)
      expect(out).not.toContain(`${COMPILER_META_KEYS.schemaHash}:`)
    })

    it('emits agent schemas + hash when emitAgentMetadata is set', () => {
      const out = transformSignalComponentSource(SRC, { emitAgentMetadata: true })
      expect(out).toContain(`${COMPILER_META_KEYS.msgSchema}:`)
      expect(out).toContain('"discriminant":"type"')
      expect(out).toContain(`${COMPILER_META_KEYS.stateSchema}:`)
      expect(out).toContain(`${COMPILER_META_KEYS.schemaHash}:`)
      // still a valid lowered view
      expect(out).toContain("signalText((s) => s.count, ['count'])")
    })

    it('emits NO msg annotations when the Msg has zero source annotations', () => {
      // SRC's Msg union carries no @intent/@requiresConfirm/etc. — a fully-default
      // annotation record is reconstructable from absence, so emitting it is dead bytes.
      const out = transformSignalComponentSource(SRC, { emitAgentMetadata: true })
      expect(out).toContain(`${COMPILER_META_KEYS.msgSchema}:`) // schema still emitted
      expect(out).not.toContain(`${COMPILER_META_KEYS.msgAnnotations}:`)
    })

    it('emits SPARSE msg annotations — only non-default fields of annotated variants', () => {
      const annotated = [
        "import { component } from '@llui/dom'",
        'type Msg =',
        '  /** @intent("Increment") @example("{ type: \'inc\' }") */',
        "  | { type: 'inc' }",
        "  | { type: 'noop' }",
        'type State = { count: number }',
        'export const Counter = component({',
        '  init: () => ({ count: 0 }),',
        '  update: (s) => s,',
        "  view: ({ state }) => [text(state.at('count'))],",
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(annotated, { emitAgentMetadata: true })
      // isolate the emitted annotations object literal (noop also appears in the
      // msg schema, so assert against the annotations value specifically).
      const ann =
        out.match(new RegExp(`\\${COMPILER_META_KEYS.msgAnnotations}: (\\{.*?\\}\\})`))?.[1] ?? ''
      expect(ann).not.toBe('')
      // the annotated variant carries only its authored fields...
      expect(ann).toContain('"inc"')
      expect(ann).toContain('"intent":"Increment"')
      expect(ann).toContain('"examples":["{ type: \'inc\' }"]')
      // ...and NOT the default-valued fields
      expect(ann).not.toContain('"dispatchMode":"shared"')
      expect(ann).not.toContain('"alwaysAffordable":false')
      // the fully-default `noop` variant is omitted entirely
      expect(ann).not.toContain('"noop"')
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
      // them and passes the resolution keyed by this call's type-arg names.
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
        crossFile: new Map([
          [
            crossFileKey({ state: 'State', msg: 'Msg', effect: 'Effect' }),
            {
              preExtracted: { msgSchema: { discriminant: 'type', variants: { tick: {} } } },
              typeSources: {
                state: {
                  module: parseModule('state.ts', 'type S = { n: number }'),
                  typeName: 'S',
                },
              },
            },
          ],
        ]),
      })
      expect(out).toContain('"variants":{"tick":{}}') // from preExtracted (cross-file)
      expect(out).toContain(`${COMPILER_META_KEYS.stateSchema}:`) // from external state source
      expect(out).toContain('"n":"number"')
    })

    it('emits component meta { file, line } in devMode', () => {
      const out = transformSignalComponentSource(SRC, { devMode: true, fileName: 'src/counter.ts' })
      expect(out).toContain(`${COMPILER_META_KEYS.componentMeta}:`)
      expect(out).toContain('"file":"src/counter.ts"')
    })

    it('does not duplicate a metadata field the author already wrote', () => {
      const withOwn = SRC.replace('view:', `${COMPILER_META_KEYS.schemaHash}: 'mine', view:`)
      const out = transformSignalComponentSource(withOwn, { emitAgentMetadata: true })
      const written = out.split(`${COMPILER_META_KEYS.schemaHash}:`).length - 1
      expect(written).toBe(1)
      expect(out).toContain(`${COMPILER_META_KEYS.schemaHash}: 'mine'`)
    })
  })

  it('compiles a generic-arrow `.ts` component (not misparsed as JSX)', () => {
    // `const clone = <T>(x: T): T => x` is a generic arrow in TS but an unterminated
    // JSX element under TSX — which swallows the whole component so it never compiles.
    // Selecting ScriptKind from the `.ts` filename fixes it.
    const src = [
      "import { component, div, text, button } from '@llui/dom'",
      'const clone = <T>(x: T): T => x',
      'export const Counter = component({',
      '  init: () => ({ n: 0 }),',
      '  update: (s) => s,',
      '  view: ({ state, send }) => [',
      '    div([',
      "      text(state.at('n').map((n) => clone(String(n)))),",
      "      button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),",
      '    ]),',
      '  ],',
      '})',
    ].join('\n')
    const out = transformSignalComponentSource(src, { fileName: 'widget.ts' })
    // The component was compiled: the view lowered to runtime helpers.
    expect(out).not.toBe(src)
    expect(out).toContain('signalText')
    // The generic arrow survives verbatim.
    expect(out).toContain('const clone = <T>(x: T): T => x')
    // Under the OLD TSX behavior the component is swallowed and never lowered.
    expect(transformSignalComponentSource(src, { fileName: 'widget.tsx' })).toBe(src)
  })

  it('computes metadata PER component() call — distinct Msg/State get distinct schemas', () => {
    // Two components in one file with different type args must NOT share the first's
    // schema/hash. The type NAMES come from each call's own `component<State, Msg>`.
    const src = [
      "import { component } from '@llui/dom'",
      "type MsgA = { type: 'inc' }",
      "type MsgB = { type: 'toggle' } | { type: 'reset' }",
      'type StateA = { a: number }',
      'type StateB = { b: boolean }',
      "const A = component<StateA, MsgA>({ init: () => ({a:0}), update: (s)=>s, view: ({ state }) => [text(state.at('a'))] })",
      "const B = component<StateB, MsgB>({ init: () => ({b:false}), update: (s)=>s, view: ({ state }) => [text(state.at('b'))] })",
    ].join('\n')
    const out = transformSignalComponentSource(src, { emitAgentMetadata: true })
    // Each component carries its OWN Msg union's variants.
    expect(out).toContain('"variants":{"inc":{}}')
    expect(out).toContain('"variants":{"toggle":{},"reset":{}}')
    // ...and its OWN State fields.
    expect(out).toContain('{"fields":{"a":"number"}}')
    expect(out).toContain('{"fields":{"b":"boolean"}}')
    // The two schema hashes differ (the bug reused the first for both).
    const hashes = [
      ...out.matchAll(new RegExp(`\\${COMPILER_META_KEYS.schemaHash}: "([^"]+)"`, 'g')),
    ].map((m) => m[1])
    expect(hashes).toHaveLength(2)
    expect(hashes[0]).not.toBe(hashes[1])
  })

  describe('cross-file resolutions are per component() call (#91)', () => {
    // A adopts an imported Msg (the adapter resolved it); B declares its own
    // LOCALLY. The pre-extracted result used to be a FILE-WIDE override, so B
    // was handed A's schema/annotations — wrong metadata on the agent ABI, which
    // is worse than none. Keyed per call, B falls back to file-local extraction.
    const importedMsgSchema = {
      discriminant: 'type',
      variants: { fromSibling: {} },
    } as const

    const componentSrc = (first: 'imported' | 'local'): string => {
      const imported =
        "const Imported = component<ImportedState, ImportedMsg>({ init: () => ({i:0}), update: (s)=>s, view: ({ state }) => [text(state.at('i'))] })"
      const local =
        "const Local = component<LocalState, LocalMsg>({ init: () => ({l:0}), update: (s)=>s, view: ({ state }) => [text(state.at('l'))] })"
      return [
        "import { component, text } from '@llui/dom'",
        "import type { ImportedMsg } from './msg'",
        "import type { ImportedState } from './state'",
        "type LocalMsg = { type: 'localOnly' }",
        'type LocalState = { l: number }',
        ...(first === 'imported' ? [imported, local] : [local, imported]),
      ].join('\n')
    }

    const resolutions = new Map<string, CrossFileResolution>([
      [
        crossFileKey({ state: 'ImportedState', msg: 'ImportedMsg', effect: 'Effect' }),
        {
          preExtracted: {
            msgSchema: importedMsgSchema,
            msgAnnotations: {
              fromSibling: {
                intent: 'From the sibling module',
                alwaysAffordable: false,
                requiresConfirm: false,
                dispatchMode: 'shared',
                examples: [],
                warning: null,
                emits: [],
                routeGate: null,
                routeGateReason: null,
              },
            },
            effectSchema: { discriminant: 'type', variants: { siblingFx: {} } },
          },
          typeSources: {
            state: {
              module: parseModule('sibling-state.ts', 'type ImportedState = { i: number }'),
              typeName: 'ImportedState',
            },
          },
        },
      ],
    ])

    /** The metadata slice emitted for the component bound to `name`. */
    const sliceFor = (out: string, name: string): string => {
      const start = out.indexOf(`const ${name} = component<`)
      expect(start).toBeGreaterThanOrEqual(0)
      const next = out.indexOf('const ', start + 6)
      return next < 0 ? out.slice(start) : out.slice(start, next)
    }

    for (const order of ['imported', 'local'] as const) {
      it(`gives each call its own schema, annotations and Effect schema (${order} first)`, () => {
        const out = transformSignalComponentSource(componentSrc(order), {
          emitAgentMetadata: true,
          crossFile: resolutions,
        })
        assertParses(out)
        const imported = sliceFor(out, 'Imported')
        const local = sliceFor(out, 'Local')

        // The call whose types the adapter resolved gets the cross-file result…
        expect(imported).toContain('"variants":{"fromSibling":{}}')
        expect(imported).toContain('"From the sibling module"')
        expect(imported).toContain('"variants":{"siblingFx":{}}')
        expect(imported).toContain('"i":"number"') // external State source

        // …and the call with a LOCAL Msg never sees it.
        expect(local).toContain('"variants":{"localOnly":{}}')
        expect(local).not.toContain('fromSibling')
        expect(local).not.toContain('From the sibling module')
        expect(local).not.toContain('siblingFx')
        expect(local).toContain('"l":"number"') // file-local State, not the external one
        expect(local).not.toContain('"i":"number"')
      })
    }

    it('falls back to file-local extraction when the call has no resolution entry', () => {
      const out = transformSignalComponentSource(componentSrc('local'), {
        emitAgentMetadata: true,
        crossFile: new Map(),
      })
      expect(sliceFor(out, 'Local')).toContain('"variants":{"localOnly":{}}')
    })

    it('keys an untyped component() call by the State/Msg/Effect convention', () => {
      // The transform falls back to the convention names for an untyped call, so
      // the adapter must key its resolution the same way or the lookup silently
      // misses. `crossFileKey` + `componentTypeNames` are the shared derivation.
      const src = [
        "import { component, text } from '@llui/dom'",
        "import type { Msg } from './msg'",
        "const Untyped = component({ init: () => ({n:0}), update: (s)=>s, view: ({ state }) => [text(state.at('n'))] })",
      ].join('\n')
      const out = transformSignalComponentSource(src, {
        emitAgentMetadata: true,
        crossFile: new Map([
          [
            crossFileKey({ state: 'State', msg: 'Msg', effect: 'Effect' }),
            { preExtracted: { msgSchema: importedMsgSchema } },
          ],
        ]),
      })
      expect(out).toContain('"variants":{"fromSibling":{}}')
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
      expect(out).toContain(`${COMPILER_META_KEYS.msgSchema}:`)
      expect(out).toContain(`${COMPILER_META_KEYS.schemaHash}:`)
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

    it('keeps a `function` handler as a function (preserves this/arguments)', () => {
      const out = transformSignalComponentSource(
        view("function (e) { send({ type: 'a' }); send({ type: 'b' }) }"),
      )
      // The wrapped handler is STILL a function — not rewritten to an arrow, which
      // would rebind `this`/`arguments`. The batch wrap is a nested arrow (which
      // preserves the enclosing function's this/arguments).
      expect(out).toContain('function(e) { return batch(() => {')
      expect(out).toContain("send({ type: 'a' }); send({ type: 'b' })")
      // it did NOT become an arrow handler
      expect(out).not.toContain('onClick: (e) => batch(')
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
        '  return [ul([each(items, { key: (r) => r.id, render: (item) => [li([text(item.at("label"))])] })])]',
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
        '  return [ul([each(items, { key: (r) => r.id, render: (item) => [li({ class: mode.at("x") }, [text(item.at("y"))])] })])]',
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
        '  view: ({ state }) => [ul([each(state.at("rows"), { key: (r) => r.id, render: (item) => [li([text(item.at("x"))])] })])],',
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
        "  return div({ class: 'activity-item' }, [span([text(entry.user)]), span([text(locale.map((l) => entry.ago + l))])])",
        '}',
        'const C = component({',
        '  init: () => ({ items: [], locale: "en" }),',
        '  update: (s) => s,',
        '  view: ({ state }) => [div([each(state.at("items"), { key: (it) => it.id, render: (item) => [row(item, state.at("locale"))] })])],',
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
        'const C = component({ init: () => ({ items: [], parts: {} }), update: (s) => s, view: ({ state }) => [ul([each(state.at("items"), { key: (it) => it.id, render: (item) => [row(item, state.at("parts"))] })])] })',
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
        '  view: ({ state }) => [ul([each(state.at("rows"), { key: (r) => r.id, render: (item) => [li([text(item.at("x"))])] })])],',
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
        'const C = component({ init: () => ({ items: [] }), update: (s) => s, view: ({ state }) => [ul([each(state.at("items"), { key: (it) => it.id, render: (item) => [row(item)] })])] })',
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
        '  return [ul([each(items, { key: (r) => r.id, render: (item) => [li([text(item.at("y"))])] })])]',
        '}',
        'const C = component({',
        '  init: () => ({ rows: [] }),',
        '  update: (s) => s,',
        '  view: ({ state }) => [ul([each(state.at("rows"), { key: (r) => r.id, render: (item) => [li([text(item.at("x"))])] })])],',
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
        'function row(item) { return [div([text(item.at("x"))])] }',
        'const C = component({ init: () => ({ rows: [] }), update: (s) => s, view: ({ state }) => [ul([each(state.at("rows"), { key: (r) => r.id, render: (item) => [row(item)] })])] })',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      expect(out).toContain('signalEachDirect(')
    })

    it('inlines a MULTI-element array helper (row with two root nodes)', () => {
      const src = [
        "import { component, ul, li, text, each } from '@llui/dom'",
        'function row(item) { return [li([text(item.at("x"))]), li([text("detail")])] }',
        'const C = component({ init: () => ({ rows: [] }), update: (s) => s, view: ({ state }) => [ul([each(state.at("rows"), { key: (r) => r.id, render: (item) => [row(item)] })])] })',
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
        '    td([text(grant.at("email"))]),',
        '    td([text(state.at("flags").map((f) => f[flagKey] ?? "—"))]),',
        '    td({ onClick: () => send({ type: "revoke", userId }) }, [text("revoke")]),',
        '  ])]',
        '}',
        'const C = component({',
        '  init: () => ({ grants: [], flags: {} }),',
        '  update: (s) => s,',
        '  view: ({ state, send }) => [table([each(state.at("grants"), { key: (g) => g.userId, render: (grant) => grantRow(state, grant, "beta", send) })])],',
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
        '  return [ul([each(items, {',
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
        '  return [ul([each(items, { key: (r) => r.id, render: (item) => [li([text(item.at("label")), pill(item)])] })])]',
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
        '  view: ({ state }) => [div([each(state.at("items"), { key: (it) => it.id, render: (item) => [activityItem(item, state.at("locale"))] })])],',
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
        '  return [ul([each(items, {',
        '    key: (r) => r.id,',
        '    render: (item) => [li([text(item.at("label")), text(state.at("mode"))])],',
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
        '  return [ul([each(items, { key: (r) => r.id, render: (item) => [li([text(item.at("label"))])] })])]',
        '}',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      expect(out).toMatch(/eachDirect\(items, .*, \[\]\)/s)
    })

    it('bails inlining a RECURSIVE helper (its nested each is a structural child)', () => {
      const src = [
        "import { component, ul, div, text, each } from '@llui/dom'",
        'function row(item) { return div([each(item.at("kids"), { key: (k) => k.id, render: (k) => [row(k)] })]) }',
        'const C = component({ init: () => ({ rows: [] }), update: (s) => s, view: ({ state }) => [ul([each(state.at("rows"), { key: (r) => r.id, render: (item) => [row(item)] })])] })',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      expect(out).not.toContain('signalEachDirect(')
    })

    it('bails inlining when a param is used as an object SHORTHAND (hygiene)', () => {
      const src = [
        "import { component, ul, div, text, each } from '@llui/dom'",
        'function row(item, mode) { const o = { mode }; return div([text(item.at("x"))]) }',
        'const C = component({ init: () => ({ rows: [], mode: "x" }), update: (s) => s, view: ({ state }) => [ul([each(state.at("rows"), { key: (r) => r.id, render: (item) => [row(item, state.at("mode"))] })])] })',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      expect(out).not.toContain('signalEachDirect(')
    })

    it('bails inlining on arg/param count mismatch', () => {
      const src = [
        "import { component, ul, div, text, each } from '@llui/dom'",
        'function row(item, extra) { return div([text(item.at("x"))]) }',
        'const C = component({ init: () => ({ rows: [] }), update: (s) => s, view: ({ state }) => [ul([each(state.at("rows"), { key: (r) => r.id, render: (item) => [row(item)] })])] })',
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
        'function row(item, state) { return div([text(state.map((m) => m))]) }',
        'const C = component({ init: () => ({ rows: [], mode: "x" }), update: (s) => s, view: ({ state }) => [ul([each(state.at("rows"), { key: (r) => r.id, render: (item) => [row(item, state.at("mode"))] })])] })',
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
        'const cell = (n) => td([text(String(n * 2))])',
        'const C = component({ init: () => ({ rows: [] }), update: (s) => s, view: ({ state }) => [ul([each(state.at("rows"), { key: (r) => r.id, render: (item, idx) => [cell(idx.peek() + 1)] })])] })',
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
        'const cell = (n) => td([text(String(n * 2 + n))])',
        'const C = component({ init: () => ({ rows: [] }), update: (s) => s, view: ({ state }) => [ul([each(state.at("rows"), { key: (r) => r.id, render: (item, idx) => [cell(idx.peek() + 1)] })])] })',
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
        '    div([text(state.at("n"))]),',
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
        'const C = component({ init: () => ({ n: 0 }), update: (s) => s, view: ({ state }) => [div([text(state.at("n"))])] })',
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

  describe('import-binding recognition', () => {
    it('does NOT lower a user function that shadows a helper name (`text`)', () => {
      const src = [
        "import { component, div } from '@llui/dom'",
        'function text(x: string) { return x }', // user's OWN text, not the dom helper
        'const C = component({',
        '  init: () => ({ n: 0 }),',
        '  update: (s) => s,',
        "  view: ({ state }) => [div([text('hi')])],",
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      // div IS a dom import -> lowers to el(...)
      expect(out).toContain('el("div"')
      // the user's text(...) must stay verbatim — NOT signalText/staticText
      expect(out).toContain("text('hi')")
      expect(out).not.toContain('staticText')
      expect(out).not.toContain('signalText')
    })

    it('does NOT lower a user const named `each`', () => {
      const src = [
        "import { component, ul } from '@llui/dom'",
        'const each = (xs: number[]) => xs.length', // user's OWN each
        'const C = component({',
        '  init: () => ({ items: [1, 2] }),',
        '  update: (s) => s,',
        '  view: ({ state }) => [ul([]), each([1, 2]) as unknown as never],',
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      // no each-family lowering of the user each(...)
      expect(out).not.toMatch(/signalEach|eachDirect|eachArm/)
      expect(out).toContain('each([1, 2])')
    })

    it('lowers ALIASED helper imports (`each as loop`, `div as box`) using canonical names', () => {
      const src = [
        "import { component, each as loop, div as box, text } from '@llui/dom'",
        'const C = component({',
        '  init: () => ({ items: [{ id: 1 }] as { id: number }[] }),',
        '  update: (s) => s,',
        "  view: ({ state }) => [box([loop(state.at('items'), { key: (i) => i.id, render: (item) => [text(item.at('id'))] })])],",
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      // box -> canonical div element helper
      expect(out).toContain('el("div"')
      // loop -> each structural lowering (direct factory or render arm)
      expect(out).toMatch(/signalEach/)
    })

    it('leaves an element-helper name shadowed by a render param alone', () => {
      // The row param is named `div`; the row body `div([...])` refers to the
      // PARAM (the row item signal), not the element helper — must stay verbatim
      // so the runtime authoring path binds the real handle.
      const src = [
        "import { component, ul, each } from '@llui/dom'",
        'const C = component({',
        '  init: () => ({ rows: [] as { id: number }[] }),',
        '  update: (s) => s,',
        "  view: ({ state }) => [ul([each(state.at('rows'), { key: (r) => r.id, render: (div) => [div([])] })])],",
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      // the shadowed `div([])` must NOT become el("div", ...)
      expect(out).not.toContain('el("div"')
    })

    // ── issue #153: a function/class EXPRESSION binds its OWN name ─────────
    // The fix lives in `scopeIntroduces` — the repo's ONE shadowing predicate —
    // so it is shared with `HelperBindings.isShadowed`, i.e. with LOWERING.
    // These two tests are that blast radius, stated as behaviour: before the
    // fix both lowered a call that does not denote the framework helper at all.
    it('leaves an element-helper name shadowed by a NAMED FUNCTION EXPRESSION alone', () => {
      // A recursive row renderer: inside `function div(row) { … }` the name
      // `div` is the function expression itself, so `div([])` is a self-call.
      // It used to lower to a real `<div>` element — the user's recursion
      // silently replaced by an element, with nothing to see in the output.
      const src = [
        "import { component, ul, each } from '@llui/dom'",
        'const C = component({',
        '  init: () => ({ rows: [] as { id: number }[] }),',
        '  update: (s) => s,',
        "  view: ({ state }) => [ul([each(state.at('rows'), { key: (r) => r.id, render: function div(row) { return [div([])] } })])],",
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      expect(out).not.toContain('createElement("div")')
      expect(out).toContain('div([])')
    })

    it('does NOT treat a `component(` call inside a self-named factory as the framework helper', () => {
      // `export const make = function component(…) { return component({…}) }`
      // is a recursive factory: the inner `component` is the function
      // expression. The transform used to recognize it and LOWER the object
      // literal's `view` — compiling a call that never reaches `@llui/dom`.
      const src = [
        "import { component, div, text } from '@llui/dom'",
        'const make = function component(): unknown {',
        '  return component({',
        '    init: () => ({ a: "" }),',
        '    update: (s: { a: string }) => s,',
        "    view: ({ state }) => [div({}, [text(state.at('a'))])],",
        '  })',
        '}',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      expect(out).not.toContain('el("div"')
      expect(out).not.toContain('signalText')
      expect(out).toContain("div({}, [text(state.at('a'))])")
    })

    it('still lowers a component whose factory is named something ELSE (control)', () => {
      const src = [
        "import { component, div, text } from '@llui/dom'",
        'const make = function build(): unknown {',
        '  return component({',
        '    init: () => ({ a: "" }),',
        '    update: (s: { a: string }) => s,',
        "    view: ({ state }) => [div({}, [text(state.at('a'))])],",
        '  })',
        '}',
      ].join('\n')
      const out = transformSignalComponentSource(src)
      assertParses(out)
      expect(out).toContain('el("div"')
      expect(out).toContain('signalText')
    })
  })

  // Issue #90: the injected `import { … } from '@llui/dom'` declares TOP-LEVEL
  // bindings, so it must consult EVERY top-level declaration in the file — not
  // just the file's other `@llui/dom` import specifiers. A collision is resolved
  // by ALIASING (and emitting the alias at the lowered call sites), never by
  // skipping: a skipped import silently leaves the lowered call bound to the
  // user's value.
  describe('import injection: top-level name collisions (#90)', () => {
    const COLLIDING_DECLARATIONS: ReadonlyArray<readonly [label: string, decl: string]> = [
      ['const', "const el = document.createElement('span')"],
      ['function', 'function el() { return 1 }'],
      ['class', 'class el {}'],
      ['let', 'let el'],
      ['var', 'var el = 1'],
      ['destructuring', 'const { el } = { el: 1 }'],
      ['array destructuring', 'const [el] = [1]'],
      ['export const', "export const el = 'mine'"],
      ['enum', 'enum el { a }'],
      ['non-dom named import', "import { el } from './my-helpers.js'"],
      ['default import', "import el from './my-helpers.js'"],
      ['type-only import', "import type { el } from './my-types.js'"],
      ['namespace import', "import * as el from './my-helpers.js'"],
    ]

    /** A component whose `div(...)` lowers to the runtime `el(...)`, prefixed by
     * a user declaration that takes the `el` name. */
    const sourceWith = (decl: string): string =>
      [
        "import { component, div, text } from '@llui/dom'",
        decl,
        'export const C = component({',
        '  init: () => ({ n: 0 }),',
        '  update: (s) => s,',
        "  view: ({ state }) => [div([text(state.at('n'))])],",
        '})',
      ].join('\n')

    for (const [label, decl] of COLLIDING_DECLARATIONS) {
      it(`aliases the injected helper around a top-level ${label} of the same name`, () => {
        const out = transformSignalComponentSource(sourceWith(decl), { fileName: 'x.tsx' })
        assertParses(out)
        assertNoDuplicateTopLevelBindings(out)
        const bound = injectedBindingFor(out, 'el')
        expect(bound).not.toBeNull()
        expect(bound).not.toBe('el') // the canonical name is taken → aliased
        // the lowered call must use the ALIAS, so it reaches the runtime helper
        expect(out).toContain(`${bound!}("div"`)
      })
    }

    it('the lowered call reaches the runtime helper, not the user binding', () => {
      const src = [
        "import { component, div, text } from '@llui/dom'",
        "const el = () => { throw new Error('user el called') }",
        'export const C = component({',
        '  init: () => ({ n: 0 }),',
        '  update: (s) => s,',
        "  view: ({ state }) => [div([text(state.at('n'))])],",
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src, { fileName: 'x.ts' })
      assertParses(out)
      // Executed against a stub `@llui/dom`: if the injection were skipped (or the
      // alias not threaded into the call sites) this throws from the user's `el`.
      const nodes = runLoweredView(out)
      expect(nodes).toEqual([{ helper: 'el', tag: 'div' }])
    })

    it('dodges a binding that shadows the helper only INSIDE the lowered view', () => {
      // Block-body views ARE lowered, so the emitted call lands in a scope the
      // user's own `const el` shadows. A top-level-only collision scan misses it
      // and the lowered `el("div", …)` silently calls the user's function.
      const src = [
        "import { component, div, text } from '@llui/dom'",
        'export const C = component({',
        '  init: () => ({ n: 0 }),',
        '  update: (s) => s,',
        '  view: ({ state }) => {',
        "    const el = () => { throw new Error('user el called') }",
        "    return [div([text(state.at('n'))])]",
        '  },',
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src, { fileName: 'x.ts' })
      assertParses(out)
      expect(injectedBindingFor(out, 'el')).not.toBe('el')
      expect(runLoweredView(out)).toEqual([{ helper: 'el', tag: 'div' }])
    })

    it('dodges a `var` hoisted out of a top-level block', () => {
      // `var` in a block hoists to MODULE scope, so it collides with the injected
      // import — but it is invisible to a scan of the file's top-level statements.
      const src = [
        "import { component, div, text } from '@llui/dom'",
        "if (globalThis) { var el = () => { throw new Error('user el called') } }",
        'export const C = component({',
        '  init: () => ({ n: 0 }),',
        '  update: (s) => s,',
        "  view: ({ state }) => [div([text(state.at('n'))])],",
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src, { fileName: 'x.ts' })
      assertParses(out)
      expect(injectedBindingFor(out, 'el')).not.toBe('el')
      // executing proves the duplicate declaration is gone AND the call routes right
      expect(runLoweredView(out)).toEqual([{ helper: 'el', tag: 'div' }])
    })

    it('a namespace import does not trigger a false collision on its members', () => {
      const src = [
        "import * as dom from '@llui/dom'",
        "import { component, div, text } from '@llui/dom'",
        'export const C = component({',
        '  init: () => ({ n: 0 }),',
        '  update: (s) => s,',
        "  view: ({ state }) => [div([text(state.at('n'))])],",
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src, { fileName: 'x.ts' })
      assertParses(out)
      assertNoDuplicateTopLevelBindings(out)
      // `el` is free (only `dom` is bound) → injected under its canonical name
      expect(injectedBindingFor(out, 'el')).toBe('el')
      expect(out).toContain('el("div"')
    })

    it('still subtracts a helper the file already imports from @llui/dom', () => {
      const src = [
        "import { component, el, div, text } from '@llui/dom'",
        'export const C = component({',
        '  init: () => ({ n: 0 }),',
        '  update: (s) => s,',
        "  view: ({ state }) => [div([text(state.at('n'))])],",
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src, { fileName: 'x.ts' })
      assertParses(out)
      assertNoDuplicateTopLevelBindings(out)
      // exactly one binding of `el`, the user's own — no alias, no re-import
      expect(injectedBindingFor(out, 'el')).toBe('el')
      expect(topLevelBindingNames(out).filter((n) => n === 'el')).toEqual(['el'])
      expect(out).toContain('el("div"')
    })

    it('aliases when a @llui/dom import binds the helper name to a DIFFERENT export', () => {
      // `text as el` takes the name `el` — subtracting on the LOCAL name alone
      // would leave the lowered `el(...)` calling the text helper.
      const src = [
        "import { component, text as el, div } from '@llui/dom'",
        'export const C = component({',
        '  init: () => ({ n: 0 }),',
        '  update: (s) => s,',
        "  view: ({ state }) => [div([el(state.at('n'))])],",
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src, { fileName: 'x.ts' })
      assertParses(out)
      assertNoDuplicateTopLevelBindings(out)
      const bound = injectedBindingFor(out, 'el')
      expect(bound).not.toBeNull()
      expect(bound).not.toBe('el')
      expect(out).toContain(`${bound!}("div"`)
    })

    it('over-approximates on a type-only declaration, and stays correct', () => {
      // A `type`/`interface` name lives in the TYPE namespace and could not
      // actually collide with a value import, so the alias here is unnecessary.
      // That is the deliberate trade: the collision test is "does this identifier
      // occur at all", which cannot miss a real collision (a hoisted `var`, a
      // shadow inside a lowered block-body view) at the price of the occasional
      // alias nobody needed. What must hold either way is that the lowered call
      // reaches whatever the injected import binds.
      const src = [
        "import { component, div, text } from '@llui/dom'",
        'type el = string',
        'interface signalText { x: number }',
        'export const C = component({',
        '  init: () => ({ n: 0 }),',
        '  update: (s) => s,',
        "  view: ({ state }) => [div([text(state.at('n'))])],",
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src, { fileName: 'x.ts' })
      assertParses(out)
      assertNoDuplicateTopLevelBindings(out)
      const el = injectedBindingFor(out, 'el')
      const signalText = injectedBindingFor(out, 'signalText')
      expect(el).not.toBeNull()
      expect(signalText).not.toBeNull()
      expect(out).toContain(`${el!}("div"`)
      expect(out).toContain(`${signalText!}((s) => s.n`)
    })

    it('picks a fresh alias when the obvious one is itself taken', () => {
      const src = [
        "import { component, div, text } from '@llui/dom'",
        "const el = 'mine'",
        "const el$llui = 'also mine'",
        'export const C = component({',
        '  init: () => ({ n: 0 }),',
        '  update: (s) => s,',
        "  view: ({ state }) => [div([text(state.at('n'))])],",
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src, { fileName: 'x.ts' })
      assertParses(out)
      assertNoDuplicateTopLevelBindings(out)
      const bound = injectedBindingFor(out, 'el')
      expect(bound).not.toBeNull()
      expect(bound).not.toBe('el')
      expect(bound).not.toBe('el$llui')
      expect(out).toContain(`${bound!}("div"`)
    })

    it('aliases in a .ts file with a generic arrow (ScriptKind is per filename)', () => {
      const src = [
        "import { component, div, text } from '@llui/dom'",
        'const identity = <T,>(x: T): T => x',
        "const el = 'mine'",
        'export const C = component({',
        '  init: () => ({ n: identity(0) }),',
        '  update: (s) => s,',
        "  view: ({ state }) => [div([text(state.at('n'))])],",
        '})',
      ].join('\n')
      const out = transformSignalComponentSource(src, { fileName: 'x.ts' })
      assertParses(out)
      assertNoDuplicateTopLevelBindings(out)
      const bound = injectedBindingFor(out, 'el')
      expect(bound).not.toBe('el')
      expect(out).toContain(`${bound!}("div"`)
    })
  })
})
