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
  fieldBitsHi: Map<string, number>
  viewHelperNames: Set<string>
  viewHelperAliases: Map<string, string>
}

const FULL_MASK = 0xffffffff | 0

export function structuralMaskModule(options: StructuralMaskModuleOptions): CompilerModule {
  const { fieldBits, fieldBitsHi, viewHelperNames, viewHelperAliases } = options
  return {
    name: 'structural-mask',
    compilerVersion: '^0.3.0',
    diagnostics: [],
    visitors: {},

    transformCallEnter(ctx, node) {
      if (fieldBits.size === 0 && fieldBitsHi.size === 0) return null

      const isEach = isHelperCall(node.expression, 'each', viewHelperNames, viewHelperAliases)
      const isBranch = isHelperCall(node.expression, 'branch', viewHelperNames, viewHelperAliases)
      const isScope = isHelperCall(node.expression, 'scope', viewHelperNames, viewHelperAliases)
      const isShow = isHelperCall(node.expression, 'show', viewHelperNames, viewHelperAliases)
      if (!isEach && !isBranch && !isScope && !isShow) return null

      const optsArg = node.arguments[0]
      if (!optsArg || !ts.isObjectLiteralExpression(optsArg)) return null

      // Idempotent — skip if either `__mask` or `__maskHi` already present.
      for (const prop of optsArg.properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          ts.isIdentifier(prop.name) &&
          (prop.name.text === '__mask' || prop.name.text === '__maskHi')
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

      // Pass `fieldBitsHi` so the accessor walker can credit reads of
      // prefix paths at index ≥ 31. Without it, a show/each/branch
      // driven only by high-word fields computed `mask=0, maskHi=0` and
      // bailed below, leaving the runtime to fall back to `FULL_MASK`
      // on both words — correct but over-firing. With it, we emit a
      // precise two-word mask. See branch.ts for the runtime side.
      const { mask, maskHi } = computeAccessorMask(
        driverAccessor,
        fieldBits,
        undefined,
        fieldBitsHi,
      )
      // Skip when there's nothing to optimize:
      //   - both words 0: accessor read no tracked fields
      //   - both words FULL_MASK: opaque/whole-state read
      // In both cases the runtime falls back to its `FULL_MASK` +
      // `FULL_MASK` default — correct, and avoids emitting redundant
      // literals.
      if (mask === 0 && maskHi === 0) return null
      if (mask === FULL_MASK && maskHi === FULL_MASK) return null

      const f = ctx.factory
      // Emit `__mask`. Emit `__maskHi` only when non-zero — the runtime
      // treats an absent `__maskHi` paired with a present `__mask` as
      // "low-word only" (maskHi = 0), which is exactly the omitted case.
      const newProps = [
        ...optsArg.properties,
        f.createPropertyAssignment('__mask', createMaskLiteral(f, mask)),
      ]
      if (maskHi !== 0) {
        newProps.push(f.createPropertyAssignment('__maskHi', createMaskLiteral(f, maskHi)))
      }
      const newOpts = f.createObjectLiteralExpression(newProps, optsArg.properties.hasTrailingComma)
      return f.createCallExpression(node.expression, node.typeArguments, [
        newOpts,
        ...node.arguments.slice(1),
      ])
    },
  }
}
