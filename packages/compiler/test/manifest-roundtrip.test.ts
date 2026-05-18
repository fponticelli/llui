import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import {
  substituteHelperCall,
  type HelperEntry,
  type SubstitutionContext,
  type ContextProvider,
} from '../src/manifest.js'

/**
 * v2b §4.3 worked-example round-trips.
 *
 * Hand-authored manifest entries for the four canonical helper shapes
 * (`carousel.connect`, `popover.overlay`, `pagination.connect`, `withSlice`)
 * substituted through the algorithm in §4.4 against synthetic consumer
 * call sites. The expected `__prefixes` paths come from the proposal —
 * see v2b.md §4.3.{1..4}.
 */

/**
 * Minimal path extractor — walks an arrow body for `s.foo.bar` style
 * member accesses rooted at the given param name. Returns dotted depth-2
 * paths. This is the same algorithm `@llui/compiler.collectStatePathsFromSource`
 * uses for real paths; we inline a simpler version here to keep the test
 * independent of the full engine.
 */
function makeExtractPaths(
  rootName: string,
): (fn: ts.ArrowFunction | ts.FunctionExpression, paramName: string) => string[] {
  return (fn, paramName) => {
    void rootName
    const out: string[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAccessExpression(node)) {
        const chain = resolveChain(node, paramName)
        if (chain) out.push(chain)
      }
      ts.forEachChild(node, visit)
    }
    if (fn.body) visit(fn.body)
    return out
  }
}

function resolveChain(node: ts.PropertyAccessExpression, paramName: string): string | null {
  const parts: string[] = []
  let current: ts.Expression = node
  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text)
    current = current.expression
  }
  if (!ts.isIdentifier(current) || current.text !== paramName) return null
  return parts.slice(0, 2).join('.')
}

function parseExpr(source: string): ts.CallExpression {
  // Wrap in a statement so we can parse, then extract the call expression.
  const sf = ts.createSourceFile('test.ts', `const _ = ${source};`, ts.ScriptTarget.Latest, true)
  const stmt = sf.statements[0] as ts.VariableStatement
  const decl = stmt.declarationList.declarations[0]!
  const init = decl.initializer!
  if (!ts.isCallExpression(init)) throw new Error('expected call expression')
  return init
}

function defaultCtx(): SubstitutionContext {
  return {
    providers: new Map(),
    extractPaths: makeExtractPaths('s'),
  }
}

describe('§4.3.1 carousel.connect — parts-helper with param-result-path reads', () => {
  const entry: HelperEntry = {
    kind: 'parts-helper',
    helperLocalPaths: [],
    viaParams: [
      {
        index: 0,
        shape: 'accessor',
        innerReads: [
          { kind: 'param-result-path', from: 0, path: 'paused' },
          { kind: 'param-result-path', from: 0, path: 'current' },
          { kind: 'param-result-path', from: 0, path: 'count' },
          { kind: 'param-result-path', from: 0, path: 'loop' },
        ],
      },
      { index: 1, shape: 'send' },
      { index: 2, shape: 'opaque' },
    ],
  }

  it('substitutes `s.carousel` lift into carousel.{paused,current,count,loop}', () => {
    const call = parseExpr(`connect((s) => s.carousel, send, { id: 'x' })`)
    const result = substituteHelperCall(entry, call.arguments, defaultCtx(), 'carousel.connect')
    expect(result.fullMask).toBe(false)
    expect(result.paths.sort()).toEqual(
      ['carousel.paused', 'carousel.current', 'carousel.count', 'carousel.loop'].sort(),
    )
  })

  it('substitutes a nested lift `s.app.carousel` into carousel.{paused,current,count,loop} (depth-2 collapses)', () => {
    // Depth-2 normalisation: `s.app.carousel` collapses to `app.carousel`
    // in the lift; the manifest's sub-paths compose to `app.carousel.paused`.
    // But the path extractor here is depth-2-only — it returns `app.carousel`
    // and the composition produces `app.carousel.paused`. Real consumers
    // would normalise further; this test verifies the composition formula.
    const call = parseExpr(`connect((s) => s.app.carousel, send, {})`)
    const result = substituteHelperCall(entry, call.arguments, defaultCtx(), 'carousel.connect')
    expect(result.paths).toContain('app.carousel.paused')
    expect(result.paths).toContain('app.carousel.current')
  })
})

describe('§4.3.2 popover.overlay — options-bag with nested accessor field', () => {
  const entry: HelperEntry = {
    kind: 'view-helper',
    helperLocalPaths: [],
    viaParams: [
      {
        index: 0,
        shape: 'options-bag',
        fields: {
          get: {
            shape: 'accessor',
            innerReads: [{ kind: 'param-result-path', from: 0, path: 'open' }],
          },
          send: { shape: 'send' },
          parts: { shape: 'opaque' },
          content: { shape: 'thunk-returning-nodes' },
        },
      },
    ],
  }

  it('unpacks the options-bag, walks the `get` accessor, composes to popover.open', () => {
    const call = parseExpr(`overlay({ get: (s) => s.popover, send, parts: pp, content: () => [] })`)
    const result = substituteHelperCall(entry, call.arguments, defaultCtx(), 'popover.overlay')
    expect(result.fullMask).toBe(false)
    expect(result.paths).toEqual(['popover.open'])
  })

  it('falls back to FULL_MASK when the options-bag arg is not an object literal', () => {
    const call = parseExpr(`overlay(prebuiltOptions)`)
    const result = substituteHelperCall(entry, call.arguments, defaultCtx(), 'popover.overlay')
    expect(result.fullMask).toBe(true)
    expect(result.diagnostics.some((d) => d.id === 'llui/opaque-options-bag')).toBe(true)
  })
})

describe('§4.3.3 pagination.connect — context-consuming parts-helper', () => {
  const entry: HelperEntry = {
    kind: 'parts-helper',
    helperLocalPaths: [],
    viaParams: [
      {
        index: 0,
        shape: 'accessor',
        innerReads: [
          { kind: 'param-result-path', from: 0, path: 'page' },
          { kind: 'param-result-path', from: 0, path: 'disabled' },
          { kind: 'param-result-path', from: 0, path: 'pageCount' },
          { kind: 'param-result-path', from: 0, path: 'siblingCount' },
        ],
      },
      { index: 1, shape: 'send' },
      {
        index: 2,
        shape: 'options-bag',
        fields: { label: { shape: 'opaque' } },
      },
    ],
    contextReads: [
      {
        context: '@llui/components#LocaleContext',
        subPaths: ['pagination.label', 'pagination.prev', 'pagination.next'],
      },
    ],
  }

  it('substitutes accessor + context provider into a unified path set', () => {
    const call = parseExpr(`connect((s) => s.pagination, send, {})`)
    // Synthesize a provide() for LocaleContext rooted at s.i18n.
    const providerSf = ts.createSourceFile(
      'p.ts',
      `const _ = (s) => s.i18n`,
      ts.ScriptTarget.Latest,
      true,
    )
    const provDecl = (providerSf.statements[0] as ts.VariableStatement).declarationList
      .declarations[0]!
    const provAccessor = provDecl.initializer as ts.ArrowFunction
    const providers = new Map<string, ContextProvider>([
      [
        '@llui/components#LocaleContext',
        { context: '@llui/components#LocaleContext', accessor: provAccessor },
      ],
    ])
    const ctx: SubstitutionContext = { providers, extractPaths: makeExtractPaths('s') }
    const result = substituteHelperCall(entry, call.arguments, ctx, 'pagination.connect')
    expect(result.fullMask).toBe(false)
    expect(result.paths).toContain('pagination.page')
    expect(result.paths).toContain('pagination.disabled')
    expect(result.paths).toContain('pagination.pageCount')
    expect(result.paths).toContain('pagination.siblingCount')
    // Context paths
    expect(result.paths).toContain('i18n.pagination.label')
    expect(result.paths).toContain('i18n.pagination.prev')
    expect(result.paths).toContain('i18n.pagination.next')
  })

  it('warns + FULL_MASK when no matching provide(LocaleContext, ...) exists', () => {
    const call = parseExpr(`connect((s) => s.pagination, send, {})`)
    const result = substituteHelperCall(entry, call.arguments, defaultCtx(), 'pagination.connect')
    expect(result.fullMask).toBe(true)
    expect(result.diagnostics.some((d) => d.id === 'llui/missing-context-provider')).toBe(true)
    // Even with the missing provider, accessor-driven paths still flow.
    expect(result.paths).toContain('pagination.page')
  })
})

describe('§4.3.4 withSlice — two-param HOF with readsThroughResultOf', () => {
  const entry: HelperEntry = {
    kind: 'view-helper',
    helperLocalPaths: [],
    viaParams: [
      { index: 0, shape: 'accessor', innerReads: [] },
      {
        index: 1,
        shape: 'accessor',
        readsThroughResultOf: 0,
        innerReads: [{ kind: 'param-result', from: 0 }],
      },
    ],
  }

  it('extracts the slice accessor; render is walked by the consumer (Phase 3 territory)', () => {
    // For Phase 2 the substitution algorithm proves it can resolve the
    // `slice` accessor and surface its paths. Composing through `render`'s
    // `readsThroughResultOf: 0` is the Phase 3 walker's job — here we
    // verify the slice paths land in __prefixes.
    const call = parseExpr(`withSlice((s) => s.items, (sub) => [])`)
    const result = substituteHelperCall(entry, call.arguments, defaultCtx(), 'withSlice')
    expect(result.fullMask).toBe(false)
    expect(result.paths).toContain('items')
  })
})

describe('substitution depth + cycle guards', () => {
  it('contributes FULL_MASK + diagnostic when depth exceeds 8', () => {
    const entry: HelperEntry = {
      kind: 'view-helper',
      helperLocalPaths: [],
      viaParams: [],
    }
    const call = parseExpr(`helper()`)
    const result = substituteHelperCall(entry, call.arguments, defaultCtx(), 'deep', new Set(), 9)
    expect(result.fullMask).toBe(true)
    expect(result.diagnostics.some((d) => d.id === 'llui/substitution-depth-exceeded')).toBe(true)
  })
})
