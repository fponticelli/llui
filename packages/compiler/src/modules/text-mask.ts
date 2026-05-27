// `text-mask` — injects the precise reactive bitmask as the second
// argument of every `text(accessor)` call. The runtime gates the
// binding's re-evaluation on `(mask & dirty)` so a `text()` that
// reads only `s.count` is skipped when only `s.theme` changes.
//
// Accessor resolution mirrors `structural-mask`'s contract: inline
// arrow, inline `memo(arrow)`, or identifier referencing a const-bound
// arrow / memo / function declaration. Anything else (static
// strings, opaque imports, parameters) leaves the call unchanged
// and the runtime falls back to FULL_MASK — correct but slower.
//
// Fires top-down (`transformCallEnter`) so the element rewrite
// chain sees the masked form. Idempotent: skips when the call
// already has a second argument (caller-supplied mask).
//
// Bare-identifier `text` is gated on provenance — the module
// verifies the identifier resolves to the @llui/dom import via
// `lluiImport`. Destructured aliases and member-expression forms
// (`{ text: t } => t(...)`, `h.text(...)`) are provenance-safe
// by construction.

import ts from 'typescript'
import type { CompilerModule } from '../module.js'
import { resolveAccessorBody } from '../accessor-resolver.js'
import { computeAccessorMask, createMaskLiteral, isHelperCall } from '../transform.js'

export interface TextMaskModuleOptions {
  fieldBits: Map<string, number>
  fieldBitsHi: Map<string, number>
  viewHelperNames: Set<string>
  viewHelperAliases: Map<string, string>
  /** The `import { ... } from '@llui/dom'` declaration — used for
   *  bare-identifier provenance check. */
  lluiImport: ts.ImportDeclaration
}

export function textMaskModule(options: TextMaskModuleOptions): CompilerModule {
  const { fieldBits, fieldBitsHi, viewHelperNames, viewHelperAliases, lluiImport } = options
  return {
    name: 'text-mask',
    compilerVersion: '^0.3.0',
    diagnostics: [],
    visitors: {},

    transformCallEnter(ctx, node) {
      if (!isHelperCall(node.expression, 'text', viewHelperNames, viewHelperAliases)) return null

      // Bare-identifier provenance: skip if `text` doesn't resolve to
      // the @llui/dom import. Aliased/member-expression forms are
      // provenance-safe.
      if (ts.isIdentifier(node.expression) && !viewHelperAliases.has(node.expression.text)) {
        const clause = lluiImport.importClause
        if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) return null
        const hasText = clause.namedBindings.elements.some(
          (s) => s.name.text === 'text' || s.propertyName?.text === 'text',
        )
        if (!hasText) return null
      }

      const firstArg = node.arguments[0]
      if (!firstArg) return null
      // Idempotent — skip if caller supplied a mask.
      if (node.arguments.length >= 2) return null
      const accessor = resolveAccessorBody(firstArg)
      if (!accessor) return null

      const { mask, maskHi } = computeAccessorMask(accessor, fieldBits, undefined, fieldBitsHi)
      const f = ctx.factory
      // Constant accessor → fall back to FULL_MASK so the runtime
      // re-evaluates on every change rather than caching forever.
      const effMask = mask === 0 && maskHi === 0 ? 0xffffffff | 0 : mask
      const args: ts.Expression[] = [firstArg, createMaskLiteral(f, effMask)]
      if (maskHi !== 0) args.push(createMaskLiteral(f, maskHi))
      return f.createCallExpression(node.expression, node.typeArguments, args)
    },
  }
}
