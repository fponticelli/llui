// `reactive-paths` — proof-of-concept compiler module (v2c §2 / v2c/2.3).
//
// Walks the file's reactive accessors via the same path-collection logic
// the monolithic `transform.ts` uses (`collectStatePathsFromSource`) and
// emits a `__prefixes: [...]` array — one stable closure per minimal
// reference-stable prefix, in sorted order.
//
// The POC's job is to prove the visitor-registry primitive can produce
// an emission whose shape matches what today's monolith produces. It
// does NOT replace `transform.ts`'s `__prefixes` emission yet — that's
// the v2c decomposition push proper. The two paths run side-by-side
// during the validation pass (`test/poc-module-prefixes.test.ts`),
// and the test asserts the path sets match.
//
// Once the monolith decomposes, this module owns `__prefixes` and the
// legacy injection path in `transform.ts` deletes.

import ts from 'typescript'
import { collectStatePathsFromSource } from '../collect-deps.js'
import type { CompilerModule, EmissionContribution } from '../module.js'

interface ReactivePathsSlot {
  /** Source file the module was applied to — for emission-time access. */
  sourceFile: ts.SourceFile | null
}

export const reactivePathsModule: CompilerModule = {
  name: 'reactive-paths',
  compilerVersion: '^0.3.0',
  diagnostics: [],

  visitors: {
    [ts.SyntaxKind.SourceFile]: (ctx, node) => {
      const slot = ctx.getSlot(
        'reactive-paths',
        (): ReactivePathsSlot => ({
          sourceFile: null,
        }),
      )
      slot.sourceFile = node as ts.SourceFile
    },
  },

  emit(ctx, analysis) {
    const slot = analysis.perModule.get('reactive-paths') as ReactivePathsSlot | undefined
    if (!slot?.sourceFile) return []
    const paths = collectStatePathsFromSource(slot.sourceFile)
    if (paths.size === 0) return []

    // Build `__prefixes: [s => s.foo, s => s.bar.baz, ...]` as an
    // ArrayLiteralExpression. The accessor functions are stable
    // closures; the runtime's `computeDirtyFromPrefixes` reference-
    // compares each prefix(prev) vs prefix(next) per bit.
    const arrows = [...paths].sort().map((path) => buildPrefixAccessor(ctx.factory, path))
    const arrayLit = ctx.factory.createArrayLiteralExpression(arrows, false)

    const contribution: EmissionContribution = {
      module: 'reactive-paths',
      field: '__prefixes',
      value: arrayLit,
    }
    return [contribution]
  },
}

/**
 * Build a `(s) => s?.<path>?.<leaf>` arrow expression for a dotted path.
 * `path` is depth-2 normalised by the collector (e.g. `user.name`).
 *
 * Multi-segment paths use optional chaining (`?.`) on every segment so
 * the prefix function stays well-defined under structural-sharing
 * reducers where an intermediate slice may be undefined transiently.
 * Single-segment paths (`s.theme`) use plain `.` since there's no
 * intermediate. The monolith's `buildAccess` in `transform.ts` uses the
 * exact same shape — produces byte-equivalent emission when the path
 * sets match.
 */
function buildPrefixAccessor(f: ts.NodeFactory, path: string): ts.ArrowFunction {
  const parts = path.split('.')
  const useChain = parts.length > 1
  let expr: ts.Expression = f.createIdentifier('s')
  for (const part of parts) {
    expr = useChain
      ? f.createPropertyAccessChain(
          expr,
          f.createToken(ts.SyntaxKind.QuestionDotToken),
          f.createIdentifier(part),
        )
      : f.createPropertyAccessExpression(expr, f.createIdentifier(part))
  }
  return f.createArrowFunction(
    undefined,
    undefined,
    [
      f.createParameterDeclaration(
        undefined,
        undefined,
        f.createIdentifier('s'),
        undefined,
        undefined,
        undefined,
      ),
    ],
    undefined,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    expr,
  )
}
