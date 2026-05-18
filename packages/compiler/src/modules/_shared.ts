// Internal helpers shared across modules. Not part of the public
// CompilerModule surface — strictly implementation glue.

import ts from 'typescript'

/**
 * Walk a SourceFile and collect every `component(...)` CallExpression.
 * Used by per-target emission modules to capture their targets in `emit`
 * (not `visit`) so the refs match the post-Phase-2b AST.
 *
 * Phase 2b's `transformCall*` hooks rebuild ancestor nodes via
 * `ts.visitEachChild` whenever any descendant is rewritten — e.g. a
 * `text()` rewrite inside a `component()` call's view ladder
 * invalidates every component-call ref captured during the visitor
 * walk (Phase 2). Calling `findComponentCalls(analysis.sourceFile)` in
 * `emit` returns refs into the post-Phase-2b tree, which is the same
 * tree the umbrella's per-statement visitor walks.
 */
export function findComponentCalls(sf: ts.SourceFile): ts.CallExpression[] {
  const out: ts.CallExpression[] = []
  const walk = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'component'
    ) {
      out.push(n)
    }
    ts.forEachChild(n, walk)
  }
  walk(sf)
  return out
}
