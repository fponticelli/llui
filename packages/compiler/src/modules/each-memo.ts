// `each-memo` — wraps `each({ items: (s) => ... })` accessor in
// `memo(accessor, mask)` when the accessor allocates a new array on
// every call (filter/map/slice/sort/etc.). Each's runtime same-ref
// fast path handles non-allocating accessors (`(s) => s.items`)
// already, so wrap is gated on `accessorAllocatesArray`.
//
// Fires top-down (transformCallEnter) — wraps the each() call's
// items accessor before children are visited. Subsequent passes
// (dedup, mask-injection, the inline element rewrites still in
// transform.ts) see the wrapped form, which is structurally
// transparent: `memo(...)` is a CallExpression that still resolves
// to the same logical accessor at runtime.
//
// The module signals back via a per-file slot (`EACH_MEMO_SLOT`)
// when at least one wrap occurred. The umbrella reads it to decide
// whether `cleanupImports` must add `memo` to the @llui/dom imports.

import ts from 'typescript'
import type { CompilerModule } from '../module.js'
import { computeAccessorMask, createMaskLiteral, isHelperCall } from '../transform.js'

export interface EachMemoModuleOptions {
  fieldBits: Map<string, number>
  fieldBitsHi: Map<string, number>
  /** View-helper names — gates `isHelperCall` on each() under aliased shapes. */
  viewHelperNames: Set<string>
  /** Destructured view-helper aliases (e.g. `{ each: e }` → `e` → `each`). */
  viewHelperAliases: Map<string, string>
}

export interface EachMemoSlot {
  /** True when the module wrapped at least one each() items accessor. */
  usesMemo: boolean
}

export const EACH_MEMO_SLOT = 'each-memo:state'

export function eachMemoModule(options: EachMemoModuleOptions): CompilerModule {
  const { fieldBits, fieldBitsHi, viewHelperNames, viewHelperAliases } = options
  return {
    name: 'each-memo',
    compilerVersion: '^0.3.0',
    diagnostics: [],
    visitors: {},

    transformCallEnter(ctx, node) {
      if (!isHelperCall(node.expression, 'each', viewHelperNames, viewHelperAliases)) return null
      const arg = node.arguments[0]
      if (!arg || !ts.isObjectLiteralExpression(arg)) return null

      let itemsProp: ts.PropertyAssignment | null = null
      for (const prop of arg.properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          ts.isIdentifier(prop.name) &&
          prop.name.text === 'items'
        ) {
          itemsProp = prop
          break
        }
      }
      if (!itemsProp) return null

      const accessor = itemsProp.initializer
      if (!ts.isArrowFunction(accessor) && !ts.isFunctionExpression(accessor)) return null

      // Only wrap allocating accessors — each's same-ref fast path
      // handles `(s) => s.items` correctly without memo.
      if (!accessorAllocatesArray(accessor.body)) return null

      const { mask, maskHi, readsState } = computeAccessorMask(
        accessor,
        fieldBits,
        undefined,
        fieldBitsHi,
      )
      if (mask === 0 && maskHi === 0 && !readsState) return null // constant, nothing to memoize

      const f = ctx.factory
      // Emit `memo(accessor, mask)` (2-arg) when the accessor reads only
      // low-word fields, `memo(accessor, mask, maskHi)` (3-arg) otherwise.
      // The runtime defaults the omitted slot per `memo()`'s FULL_MASK-
      // mirroring rule, so a 2-arg call with `mask: FULL_MASK` still
      // covers high-word changes correctly.
      const memoArgs: ts.Expression[] = [accessor, createMaskLiteral(f, mask)]
      if (maskHi !== 0) memoArgs.push(createMaskLiteral(f, maskHi))
      const wrapped = f.createCallExpression(f.createIdentifier('memo'), undefined, memoArgs)
      const newProps = arg.properties.map((p) =>
        p === itemsProp ? f.createPropertyAssignment('items', wrapped) : p,
      )
      const newArg = f.createObjectLiteralExpression(newProps, true)
      const slot = ctx.analysis.perModule.get(EACH_MEMO_SLOT) as EachMemoSlot | undefined
      if (slot) slot.usesMemo = true
      else ctx.analysis.perModule.set(EACH_MEMO_SLOT, { usesMemo: true } as EachMemoSlot)
      return f.createCallExpression(node.expression, node.typeArguments, [
        newArg,
        ...node.arguments.slice(1),
      ])
    },
  }
}

const ALLOCATING_METHODS = new Set([
  'filter',
  'map',
  'slice',
  'sort',
  'reverse',
  'concat',
  'flat',
  'flatMap',
  'reduce',
])

function accessorAllocatesArray(body: ts.ConciseBody | ts.Expression): boolean {
  let found = false
  function walk(n: ts.Node): void {
    if (found) return
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.name) &&
      ALLOCATING_METHODS.has(n.expression.name.text)
    ) {
      found = true
      return
    }
    if (ts.isArrayLiteralExpression(n) && n.elements.some((el) => ts.isSpreadElement(el))) {
      found = true
      return
    }
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === 'Array' &&
      ts.isIdentifier(n.expression.name) &&
      n.expression.name.text === 'from'
    ) {
      found = true
      return
    }
    ts.forEachChild(n, walk)
  }
  walk(body)
  return found
}
