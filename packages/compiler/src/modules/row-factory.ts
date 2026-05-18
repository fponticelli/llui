// `row-factory` — thin CompilerModule wrapper around the inline
// `tryEmitRowFactory` in `transform.ts`. The 570-line emission body
// plus private helpers (`rewriteRoot`, `containsStructuralCall`,
// `_containsSelectorBind`) still live in transform.ts; this module
// puts the call path through the registry's Phase 2b bottom-up
// `transformCall` hook so the inline `each()` block in the umbrella
// visitor disappears.
//
// **transformCall (bottom-up, not transformCallEnter)** because the
// rewrite depends on the each() call's render body already containing
// rewritten elements — specifically an `elTemplate(...)` call that
// `elementRewriteModule` produces via its subtree-collapse pass.
// In Phase 2b's bottom-up phase the children have already gone
// through the registry's enter+recurse+exit chain, so the each()
// call this module sees has its render body in the post-element-
// rewrite shape.
//
// The function bails (returns null) on many shapes (no render prop,
// multiple `elTemplate` calls, nested structural primitives in
// render, selector.bind() V8-deopt patterns, etc.). When it throws —
// a guard against rare AST shapes the rewrite logic didn't anticipate —
// the module catches and emits a one-line `console.warn` matching
// the inline path's behavior.

import type { CompilerModule } from '../module.js'
import { isHelperCall, tryEmitRowFactory } from '../transform.js'

export interface RowFactoryModuleOptions {
  viewHelperNames: Set<string>
  viewHelperAliases: Map<string, string>
  /** Filename for the warn message — matches the inline call's `_filename`. */
  filename: string
  /** Original source text — passed through to `tryEmitRowFactory` (unused
   *  by the function, but the signature requires it). */
  source: string
}

export function rowFactoryModule(options: RowFactoryModuleOptions): CompilerModule {
  const { viewHelperNames, viewHelperAliases, filename, source } = options
  return {
    name: 'row-factory',
    compilerVersion: '^0.3.0',
    diagnostics: [],
    visitors: {},

    transformCall(ctx, node) {
      if (!isHelperCall(node.expression, 'each', viewHelperNames, viewHelperAliases)) return null
      try {
        return tryEmitRowFactory(node, ctx.factory, source)
      } catch (err) {
        const sf = ctx.analysis.sourceFile
        const line =
          node.pos >= 0 ? sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 : 0
        console.warn(`[llui] Row factory failed in ${filename}:${line} — ${(err as Error).message}`)
        return null
      }
    },
  }
}
