import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { buildManifest } from '../src/build-manifest.js'
import { substituteHelperCall, type SubstitutionContext } from '../src/manifest.js'
import { serializeManifest, parseManifest } from '../src/manifest-io.js'

// Build an in-memory single-file Program rooted at /virt for producer tests.
function makeProgram(fileName: string, code: string): ts.Program {
  const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (name === fileName ? sf : undefined),
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '/virt',
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (name) => name === fileName,
    readFile: (name) => (name === fileName ? code : undefined),
  }
  return ts.createProgram([fileName], { noLib: true, types: [] }, host)
}

const SRC = `
export function itemFill(state, index) {
  const r = state.hoveredValue ?? state.value
  if (r >= index + 1) return 'full'
  if (state.allowHalf && r >= index) return 'half'
  return 'empty'
}
export function noState(a, b) {
  return a + b
}
`

describe('buildManifest', () => {
  it('emits a state-value entry for a helper that reads sub-paths off its state param', () => {
    const program = makeProgram('/virt/rating-group.ts', SRC)
    const manifest = buildManifest(program, { srcRoot: '/virt' })

    expect(manifest.version).toBe(2)
    const entry = manifest.helpers['rating-group#itemFill']
    expect(entry).toBeDefined()
    expect(entry!.kind).toBe('view-helper')
    expect(entry!.viaParams[0]).toEqual({
      index: 0,
      shape: 'state-value',
      reads: ['allowHalf', 'hoveredValue', 'value'],
    })
    // `index` is a scalar arithmetic arg — no sub-path reads → opaque.
    expect(entry!.viaParams[1]).toEqual({ index: 1, shape: 'opaque' })
  })

  it('omits helpers that contribute no narrowing info', () => {
    const program = makeProgram('/virt/rating-group.ts', SRC)
    const manifest = buildManifest(program, { srcRoot: '/virt' })
    expect(manifest.helpers['rating-group#noState']).toBeUndefined()
  })

  it('closes the producer→consumer loop: emitted entry substitutes correctly', () => {
    const program = makeProgram('/virt/rating-group.ts', SRC)
    const manifest = buildManifest(program, { srcRoot: '/virt' })
    // Re-parse through the on-disk format to exercise the full path.
    const reparsed = parseManifest(serializeManifest(manifest))
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return
    const entry = reparsed.manifest.helpers['rating-group#itemFill']!

    // Consumer call site: `state.map(s => itemFill(s, index))`.
    const callSf = ts.createSourceFile(
      'c.ts',
      `const _ = itemFill(s, index)`,
      ts.ScriptTarget.Latest,
      true,
    )
    const call = (callSf.statements[0] as ts.VariableStatement).declarationList.declarations[0]!
      .initializer as ts.CallExpression

    const ctx: SubstitutionContext = {
      providers: new Map(),
      extractPaths: () => [],
      rootParamName: 's',
      extractValuePath: (expr, root) => (ts.isIdentifier(expr) && expr.text === root ? '' : null),
    }
    const result = substituteHelperCall(entry, call.arguments, ctx, 'rating-group#itemFill')
    expect(result.fullMask).toBe(false)
    expect(result.paths.sort()).toEqual(['allowHalf', 'hoveredValue', 'value'])
  })
})
