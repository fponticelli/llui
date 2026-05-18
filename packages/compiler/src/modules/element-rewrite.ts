// `element-rewrite` — thin CompilerModule wrapper around the
// inline `tryTransformElementCall` in `transform.ts`. The function
// itself (and its ~12 supporting helpers — `analyzeSubtree`,
// `emitSubtreeTemplate`, `classifyKind`, etc.) still lives in
// transform.ts; this module exists so the call path is the registry
// rather than the umbrella visitor.
//
// The downstream side-effects (`compiled` / `bailed` import-cleanup
// sets, `usesElSplit` / `usesElTemplate` / `usesCloneStaticTemplate`
// flags for `cleanupImports`) flow through `ELEMENT_REWRITE_SLOT`.
// The umbrella reads the slot post-registry-run and applies the
// flags during its import-cleanup pass.
//
// Fires top-down (`transformCallEnter`). The function returns
// either an `elSplit(...)` / `elTemplate(...)` / `__cloneStaticTemplate(...)`
// CallExpression (rewrite happened) or `null` (no match / bailed).
// Module is alias-aware via the `helpers` map (localName → originalName),
// computed by the umbrella before registry activation.
//
// A future pure refactor moves the 1500+ lines of helpers into this
// module file. For this commit the wrapper is enough to put the
// registry on the call path and validate end-to-end.

import ts from 'typescript'
import type { CompilerModule } from '../module.js'
import { tryTransformElementCall } from '../transform.js'

export interface ElementRewriteModuleOptions {
  /** localName → originalName for element-helper imports (alias-aware). */
  importedHelpers: Map<string, string>
  fieldBits: Map<string, number>
  fieldBitsHi: Map<string, number>
}

export interface ElementRewriteSlot {
  /** Helpers whose call sites the module successfully rewrote. */
  compiled: Set<string>
  /** Helpers that bailed (kept their import — runtime falls back). */
  bailed: Set<string>
  /** Module emitted at least one `elSplit(...)` call. */
  usesElSplit: boolean
  /** Module emitted at least one `elTemplate(...)` call. */
  usesElTemplate: boolean
  /** Module emitted at least one `__cloneStaticTemplate(...)` call. */
  usesCloneStaticTemplate: boolean
}

export const ELEMENT_REWRITE_SLOT = 'element-rewrite:state'

export function elementRewriteModule(options: ElementRewriteModuleOptions): CompilerModule {
  const { importedHelpers, fieldBits, fieldBitsHi } = options
  return {
    name: 'element-rewrite',
    compilerVersion: '^0.3.0',
    diagnostics: [],
    visitors: {},

    transformCallEnter(ctx, node) {
      const slot = ctx.analysis.perModule.get(ELEMENT_REWRITE_SLOT) as
        | ElementRewriteSlot
        | undefined
      const state: ElementRewriteSlot = slot ?? {
        compiled: new Set<string>(),
        bailed: new Set<string>(),
        usesElSplit: false,
        usesElTemplate: false,
        usesCloneStaticTemplate: false,
      }
      if (!slot) ctx.analysis.perModule.set(ELEMENT_REWRITE_SLOT, state)

      const transformed = tryTransformElementCall(
        node,
        importedHelpers,
        fieldBits,
        state.compiled,
        state.bailed,
        ctx.factory,
        fieldBitsHi,
      )
      if (!transformed) return null

      if (ts.isIdentifier(transformed.expression)) {
        if (transformed.expression.text === 'elTemplate') state.usesElTemplate = true
        else if (transformed.expression.text === 'elSplit') state.usesElSplit = true
        else if (transformed.expression.text === '__cloneStaticTemplate')
          state.usesCloneStaticTemplate = true
      }
      return transformed
    },
  }
}
