// `structural-mask` — injects `__mask` into the options object of
// `each()`, `branch()`, `scope()`, and `show()` calls. The runtime
// uses this mask to skip Phase 1 reconciliation when irrelevant
// state changed (e.g. an each() that reads `rows` is skipped when
// only `selected` changed).
//
// Analyzes the *driving* accessor — `items` for each, `on` for
// branch/scope, `when` for show — and computes the bitmask of
// state fields it reads via `computeAccessorMask`. The accessor is
// resolved through `resolveAccessorBody`, so inline arrows, inline
// `memo(arrow)`, and identifier references to const-bound arrows /
// memos / function declarations all participate. Anything else
// leaves the call unchanged; the runtime falls back to FULL_MASK.
//
// Fires top-down (transformCallEnter) — runs before subsequent
// passes see the call. Idempotent: re-running on an already-masked
// call returns null (the existing `__mask` property is detected).
// Activation gate (`fieldBits.size > 0`) mirrors the inline check
// that returned null when no reactive paths exist.

import ts from 'typescript'
import type { CompilerModule } from '../module.js'
import { resolveAccessorBody } from '../accessor-resolver.js'
import { computeAccessorMask, createMaskLiteral, isHelperCall } from '../transform.js'

export interface StructuralMaskModuleOptions {
  fieldBits: Map<string, number>
  viewHelperNames: Set<string>
  viewHelperAliases: Map<string, string>
}

export function structuralMaskModule(options: StructuralMaskModuleOptions): CompilerModule {
  const { fieldBits, viewHelperNames, viewHelperAliases } = options
  return {
    name: 'structural-mask',
    compilerVersion: '^0.3.0',
    diagnostics: [],
    visitors: {},

    transformCallEnter(ctx, node) {
      if (fieldBits.size === 0) return null

      const isEach = isHelperCall(node.expression, 'each', viewHelperNames, viewHelperAliases)
      const isBranch = isHelperCall(node.expression, 'branch', viewHelperNames, viewHelperAliases)
      const isScope = isHelperCall(node.expression, 'scope', viewHelperNames, viewHelperAliases)
      const isShow = isHelperCall(node.expression, 'show', viewHelperNames, viewHelperAliases)
      if (!isEach && !isBranch && !isScope && !isShow) return null

      const optsArg = node.arguments[0]
      if (!optsArg || !ts.isObjectLiteralExpression(optsArg)) return null

      // Idempotent — skip if `__mask` already present.
      for (const prop of optsArg.properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          ts.isIdentifier(prop.name) &&
          prop.name.text === '__mask'
        ) {
          return null
        }
      }

      const driverProp = isEach ? 'items' : isBranch || isScope ? 'on' : 'when'
      let driverAccessor: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | null =
        null
      for (const prop of optsArg.properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          ts.isIdentifier(prop.name) &&
          prop.name.text === driverProp
        ) {
          driverAccessor = resolveAccessorBody(prop.initializer)
          break
        }
      }
      if (!driverAccessor) return null

      const { mask } = computeAccessorMask(driverAccessor, fieldBits)
      if (mask === 0 || mask === (0xffffffff | 0)) return null

      const f = ctx.factory
      const maskProp = f.createPropertyAssignment('__mask', createMaskLiteral(f, mask))
      const newProps = [...optsArg.properties, maskProp]
      const newOpts = f.createObjectLiteralExpression(newProps, optsArg.properties.hasTrailingComma)
      return f.createCallExpression(node.expression, node.typeArguments, [
        newOpts,
        ...node.arguments.slice(1),
      ])
    },
  }
}
