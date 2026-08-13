import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createModuleCache, parseModule } from '../src/parse.js'
import { collectSignalDeps } from '../src/signals/collect-signal-deps.js'
import { extractStateSchema } from '../src/state-schema.js'
import { lintSignalSource, transformSignalComponentSource } from './parsed.js'

/**
 * Issue #93 — one parse per module per pass, threaded into every entry point.
 *
 * Threading ONE `ts.SourceFile` everywhere means a single wrong ScriptKind is
 * wrong EVERYWHERE at once, so the extension→ScriptKind mapping is pinned per
 * extension and through the consumers that inherit it.
 */

/** A component whose file-local helper uses the generic-arrow form. Parsed as
 * TSX, `<T>` opens a JSX element: the file misparses, the component is NOT
 * lowered, and the lint rules fire on the mangled tree. Parsed as TS it is
 * ordinary code. */
const GENERIC_ARROW = [
  "import { component, div, text } from '@llui/dom'",
  'const identity = <T>(x: T): T => x',
  'type State = { count: number }',
  "type Msg = { type: 'inc' }",
  'export const Counter = component<State, Msg>({',
  '  init: () => ({ count: identity(0) }),',
  '  update: (s: State) => s,',
  "  view: ({ state }) => [div([text(state.at('count'))])],",
  '})',
].join('\n')

/** A `.tsx` module that really does contain JSX — only parseable as TSX. */
const WITH_JSX = ['const el = <span className="x">hi</span>', 'export const v = el'].join('\n')

/** The JSX shape that actually COSTS something when parsed as TS: recovery here
 * consumes the statement that follows, so the `State` alias below it disappears.
 * Most JSX forms survive a TS parse via error recovery — this one does not, and
 * it is why the old hard-coded `input.ts` was a real defect and not just untidy. */
const JSX_THAT_EATS_THE_NEXT_STATEMENT = [
  'const list = <ul>{xs.map(x => <li key={x}>{x}</li>)}</ul>',
  'export type State = { count: number }',
].join('\n')

/** Parse errors reported by the parser itself (an internal but populated field —
 * the same probe `transform-component.test.ts` uses). */
function parseErrors(sf: ts.SourceFile): number {
  return (sf as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics!
    .length
}

describe('parseModule — ScriptKind follows the real filename', () => {
  for (const ext of ['ts', 'mts', 'cts'] as const) {
    it(`parses .${ext} as TS, so the generic arrow form is not JSX`, () => {
      const sf = parseModule(`widget.${ext}`, GENERIC_ARROW).sourceFile()
      expect(sf.languageVariant).toBe(ts.LanguageVariant.Standard)
      expect(parseErrors(sf)).toBe(0)
    })
  }

  it('parses .tsx as TSX, so real JSX is not a type assertion', () => {
    const sf = parseModule('widget.tsx', WITH_JSX).sourceFile()
    expect(sf.languageVariant).toBe(ts.LanguageVariant.JSX)
    expect(parseErrors(sf)).toBe(0)
  })

  it('does NOT parse .tsx as TS — the same JSX under a .ts name fails', () => {
    // The negative half: without the extension check this test's fixture would
    // parse identically either way and the mapping would be untested.
    expect(parseErrors(parseModule('widget.ts', WITH_JSX).sourceFile())).toBeGreaterThan(0)
  })
})

describe('every consumer inherits the module ScriptKind', () => {
  for (const ext of ['ts', 'mts', 'cts'] as const) {
    it(`lowers and lints a generic-arrow component in a .${ext} module`, () => {
      const out = transformSignalComponentSource(GENERIC_ARROW, { fileName: `widget.${ext}` })
      expect(out).toContain('signalText(')
      expect(lintSignalSource(GENERIC_ARROW, `widget.${ext}`)).toEqual([])
      expect(collectSignalDeps(parseModule(`widget.${ext}`, GENERIC_ARROW))).toEqual({
        paths: ['count'],
        wholeState: false,
        views: 1,
      })
    })
  }

  it("reads a `.tsx` module's State schema out of a TSX parse", () => {
    // The extractors used to parse every source as `input.ts` regardless of the
    // real file, so a `.tsx` component's types came out of a TS parse of JSX.
    // Error recovery masks that for most JSX forms; where it consumes the next
    // statement it does not, and the schema silently vanishes — an `agent: true`
    // build then ships no `$ss` with no error anywhere. Both halves asserted, so
    // the claim is a demonstration and not a story:
    const mod = parseModule('widget.tsx', JSX_THAT_EATS_THE_NEXT_STATEMENT)
    expect(parseErrors(mod.sourceFile())).toBe(0)
    expect(extractStateSchema(mod)).toEqual({ fields: { count: 'number' } })
    // …and the old behaviour, reproduced by naming the same text `.ts`:
    expect(
      extractStateSchema(parseModule('widget.ts', JSX_THAT_EATS_THE_NEXT_STATEMENT)),
    ).toBeNull()
    // The narrow part of the claim: a simpler JSX form DOES survive a TS parse,
    // so "every `.tsx` component was broken" would be false.
    const survives = [WITH_JSX, 'export type State = { count: number }'].join('\n')
    expect(extractStateSchema(parseModule('widget.ts', survives))).toEqual({
      fields: { count: 'number' },
    })
  })

  it('a generic-arrow .ts module read as .tsx is the failure this prevents', () => {
    // The landmine itself, asserted rather than described: under TSX the file
    // misparses, so nothing lowers and the lint rules see a mangled tree.
    expect(transformSignalComponentSource(GENERIC_ARROW, { fileName: 'widget.tsx' })).toBe(
      GENERIC_ARROW,
    )
  })
})

describe('parsing happens once', () => {
  it('memoizes the tree per module', () => {
    const mod = parseModule('a.ts', 'export const x = 1')
    expect(mod.sourceFile()).toBe(mod.sourceFile())
  })

  it('is lazy — text is available without parsing', () => {
    // No observable parse: the text is the input, and `lintAnnotationSyntaxSource`
    // relies on reading it before deciding to parse at all.
    expect(parseModule('a.ts', 'export const x = 1').text).toBe('export const x = 1')
  })

  it('the cache serves one module per path', () => {
    const cache = createModuleCache()
    expect(cache.get('a.ts', 'export const x = 1')).toBe(cache.get('a.ts', 'export const x = 1'))
  })

  it('the cache re-parses when the text changed (never serves a stale tree)', () => {
    const cache = createModuleCache()
    const first = cache.get('a.ts', 'export const x = 1')
    const second = cache.get('a.ts', 'export const x = 2')
    expect(second).not.toBe(first)
    expect(second.sourceFile().text).toBe('export const x = 2')
  })
})

describe('the single parse call site', () => {
  /** Every `.ts` file under `src/`, recursively. */
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name)
      return e.isDirectory() ? sources(p) : e.name.endsWith('.ts') ? [p] : []
    })
  }

  it('is parse.ts, and nowhere else in the package', () => {
    // The counter in `@llui/vite-plugin`'s parse-count test proves the passes
    // REUSE their parse; this proves nothing bypasses the one function that
    // applies the filename's ScriptKind. A new `ts.createSourceFile` — even for a
    // synthetic snippet — goes through `parseModule` instead.
    //
    // Honest about its reach: this is a SUBSTRING grep, so an accident is caught
    // (the shape a contributor actually writes) but an evasion is not —
    // `ts['createSourceFile']`, a destructured alias or a `createLanguageService`
    // would all slip past. It is an accident-guard, not a sandbox.
    const root = new URL('../src/', import.meta.url).pathname
    const offenders = sources(root).filter(
      (f) => f !== join(root, 'parse.ts') && readFileSync(f, 'utf8').includes('createSourceFile('),
    )
    expect(offenders.map((f) => f.slice(root.length))).toEqual([])
  })
})
