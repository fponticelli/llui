// `core-synthesis` — owns the co-emitted core trio:
//   - `__update`         — Phase 1/2 dispatcher; reads `structuralMask`
//   - `__handlers`       — per-message-type specialized handlers
//   - `__prefixes`       — array of path-keyed reference-stable closures
//
// The three are NOT decomposable into separate modules (per v2c §7.9.2
// design decision (a) vs (b)): they share `topLevelBits` /
// `structuralMask` / `fieldBits` intermediates, and `__prefixes`
// ordering is bit-position-keyed (the array index *is* the bit position
// used by every binding's mask). Producing them in three independent
// emit passes would either duplicate the analysis or require a shared
// scratchpad slot — both lose vs the function's existing single pass.
//
// So this module owns the entire synthesis: `tryInjectDirty` plus its
// ~600 lines of supporting helpers (`tryBuildHandlers`,
// `buildCaseHandler`, `buildUpdateBody`, `buildPrefixesProp`,
// `computeStructuralMask`, `buildAccess`, plus the case-analysis
// helpers `detectArrayOp`, `findReturnArray`, `detectStrideLoop`,
// `hasSliceAssignment`, `analyzeModifiedFields`). Moved verbatim from
// transform.ts in v2c/decomp-21.
//
// Side-effect: the inline call sets `usesApplyBinding = true` when
// the rewrite fires (drives `__runPhase2` + `__handleMsg` imports in
// `cleanupImports`). The module surfaces this via `CORE_SYNTHESIS_SLOT`
// for the umbrella to read after `registry.run`.

import ts from 'typescript'
import type { CompilerModule } from '../module.js'
import { computeAccessorMask, createMaskLiteral, isComponentCall } from '../transform.js'

export interface CoreSynthesisModuleOptions {
  fieldBits: Map<string, number>
  fieldBitsHi: Map<string, number>
  /** Component() call detection requires the @llui/dom import binding
   *  to disambiguate from user-local `component` identifiers. */
  lluiImport: ts.ImportDeclaration
  /** At least one reactive accessor in the file flows the state
   *  identifier into an expression the walker can't trace (opaque
   *  callee, spread, ternary branch, dynamic key, …). Forces emission
   *  of a `(s) => s` whole-state sentinel at the tail of `__prefixes`
   *  so FULL_MASK bindings catch a dirty bit on every update,
   *  regardless of which fields the opaque expression actually reads. */
  hasOpaqueAccessor?: boolean
}

export interface CoreSynthesisSlot {
  /** True when at least one component() call got the __update/__handlers/__prefixes
   *  trio injected — drives `cleanupImports`'s decision about `__runPhase2`
   *  + `__handleMsg` runtime imports. */
  usesApplyBinding: boolean
}

export const CORE_SYNTHESIS_SLOT = 'core-synthesis:state'

export function coreSynthesisModule(opts: CoreSynthesisModuleOptions): CompilerModule {
  const { fieldBits, fieldBitsHi, lluiImport, hasOpaqueAccessor = false } = opts
  return {
    name: 'core-synthesis',
    compilerVersion: '^0.3.0',
    diagnostics: [],
    visitors: {},

    transformCallEnter(ctx, node) {
      if (!isComponentCall(node, lluiImport)) return null
      const rewritten = tryInjectDirty(node, fieldBits, ctx.factory, fieldBitsHi, hasOpaqueAccessor)
      if (!rewritten) return null
      const slot = ctx.analysis.perModule.get(CORE_SYNTHESIS_SLOT) as CoreSynthesisSlot | undefined
      if (slot) slot.usesApplyBinding = true
      else
        ctx.analysis.perModule.set(CORE_SYNTHESIS_SLOT, {
          usesApplyBinding: true,
        } as CoreSynthesisSlot)
      return rewritten
    },
  }
}

// ─── Synthesis implementation (moved verbatim from transform.ts) ────

function tryInjectDirty(
  node: ts.CallExpression,
  fieldBits: Map<string, number>,
  f: ts.NodeFactory,
  fieldBitsHi: Map<string, number> = new Map(),
  hasOpaqueAccessor: boolean = false,
): ts.CallExpression | null {
  if (fieldBits.size === 0 && fieldBitsHi.size === 0 && !hasOpaqueAccessor) return null
  const configArg = node.arguments[0]
  if (!configArg || !ts.isObjectLiteralExpression(configArg)) return null

  // Check if __dirty already exists
  for (const prop of configArg.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === '__dirty'
    ) {
      return null
    }
  }

  // Top-level field → aggregated bit mask. Sub-paths under one field
  // (`route.page`, `route.data`) collapse into a single entry so
  // `tryBuildHandlers` can reason per-field. Positions 0..30 live here;
  // 31..61 in the parallel high-word map below. `__maskLegend` itself
  // is now owned by `maskLegendModule` (v2c/decomp-9).
  const topLevelBits = new Map<string, number>()
  for (const [path, bit] of fieldBits) {
    const topField = path.split('.')[0]!
    topLevelBits.set(topField, (topLevelBits.get(topField) ?? 0) | bit)
  }
  const topLevelBitsHi = new Map<string, number>()
  for (const [path, bit] of fieldBitsHi) {
    const topField = path.split('.')[0]!
    topLevelBitsHi.set(topField, (topLevelBitsHi.get(topField) ?? 0) | bit)
  }

  // Structural mask — used by __handlers.
  const structuralMask = computeStructuralMask(configArg, fieldBits)

  // v0.4 size-cut (Tier 2.4): the `__update` fast-path emission was
  // removed. Empirically (see benchmarks/bundle-baseline.json + the
  // strategy comparison in earlier work) it provided only ~3% wall-time
  // improvement on a 200-binding sparse-update workload, but cost 200-400
  // bytes per compiled component plus the dispatch branch in
  // processMessages. The runtime always uses genericUpdate now.

  // __handlers: per-message-type specialized update functions.
  // Analyzes the update() switch/case and generates direct handlers
  // that bypass the generic Phase 1/2 pipeline for single-message updates.
  // Tier 5 (drop __handlers) was attempted and REVERTED — see
  // benchmarks/bundle-baseline.json#/abandoned. The 1.4 kB savings cost
  // 23-89% perf on jfb's swap/remove/update/select.
  const handlersProp = tryBuildHandlers(configArg, topLevelBits, topLevelBitsHi, structuralMask, f)

  // `__maskLegend` is emitted by `maskLegendModule` via the registry
  // bridge (v2c/decomp-9); the umbrella's `applyRegistryEmissions` step
  // splices it into the same config-arg literal we return here.
  const extraProps: ts.ObjectLiteralElementLike[] = []
  if (handlersProp) extraProps.push(handlersProp)

  // __prefixes: opt-in path-keyed reactivity (see
  // docs/proposals/unified-composition-model.md). One closure per
  // distinct path that an accessor reads, hoisted into a stable array;
  // the array position IS the bit position used by the path's bindings.
  // The runtime prefers __prefixes when present and computes the
  // combinedDirty mask by reference-comparing `prefix(prev)` vs
  // `prefix(next)` for each entry — strictly more precise than the
  // top-level-conflated __dirty (which always co-fires bindings sharing
  // a top-level field even when only one sub-path actually mutated).
  //
  // Emit `__prefixes` whenever any reactive paths are present. For
  // components with ≤31 paths, the runtime's
  // `computeDirtyFromPrefixes` returns a single `number`; for
  // 32..61-path components it returns a `[lo, hi]` tuple that the
  // runtime fans out into `combinedDirty` + `combinedDirtyHi`. The
  // binding-level mask gating is still single-word at the compiler
  // emit layer today, so high-position bindings still re-evaluate
  // every cycle — but the dirty computation itself is now precise,
  // which lets memo()'d aggregates short-circuit correctly.
  const prefixesProp = buildPrefixesProp(fieldBits, fieldBitsHi, f, hasOpaqueAccessor)
  if (prefixesProp) extraProps.push(prefixesProp)

  const newConfig = f.createObjectLiteralExpression([...configArg.properties, ...extraProps], true)

  // `updateCallExpression` (not `createCallExpression`) so the new
  // node inherits `node.pos` / `node.end` from the original. Phase 2b
  // downstream consumers (componentMetaModule, etc.) read pos via
  // `getStart(sf)` for line info; a synthetic node (pos=-1) would
  // collapse every `component()` call's `__componentMeta.line` to 0.
  return f.updateCallExpression(node, node.expression, node.typeArguments, [
    newConfig,
    ...node.arguments.slice(1),
  ])
}

/**
 * Analyze update() switch/case and generate per-message-type handlers.
 *
 * Each handler receives (inst, msg) and returns [newState, effects].
 * The handler calls update() to get the new state, then directly invokes
 * the appropriate runtime primitives (reconcileItems, __directUpdate, etc.)
 * instead of going through the generic Phase 1/2 pipeline.
 *
 * Conservative: only generates handlers for cases where the field
 * modifications are statically determinable. Complex cases are skipped.
 */
function tryBuildHandlers(
  configArg: ts.ObjectLiteralExpression,
  topLevelBits: Map<string, number>,
  topLevelBitsHi: Map<string, number>,
  structuralMask: number,
  f: ts.NodeFactory,
): ts.PropertyAssignment | null {
  if (topLevelBits.size === 0 && topLevelBitsHi.size === 0) return null

  // Find the update function in the component config
  let updateFn: ts.ArrowFunction | ts.FunctionExpression | null = null
  for (const prop of configArg.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === 'update'
    ) {
      if (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer)) {
        updateFn = prop.initializer
      }
      break
    }
  }
  if (!updateFn) return null

  // Find the switch statement in the update body
  const body = ts.isBlock(updateFn.body) ? updateFn.body : null
  if (!body) return null

  let switchStmt: ts.SwitchStatement | null = null
  for (const stmt of body.statements) {
    if (ts.isSwitchStatement(stmt)) {
      switchStmt = stmt
      break
    }
  }
  if (!switchStmt) return null

  // Check the switch discriminant is msg.type pattern
  const stateParam = updateFn.parameters[0]?.name
  const msgParam = updateFn.parameters[1]?.name
  if (!stateParam || !msgParam || !ts.isIdentifier(stateParam) || !ts.isIdentifier(msgParam))
    return null
  const stateName = stateParam.text

  // Analyze each case clause
  const handlers: ts.PropertyAssignment[] = []

  for (const clause of switchStmt.caseBlock.clauses) {
    if (!ts.isCaseClause(clause)) continue

    // Extract the case label — must be a string literal like 'select'
    if (!ts.isStringLiteral(clause.expression)) continue
    const msgType = clause.expression.text

    // Collect ALL return [newState, effects] statements recursively from the
    // case body. Multiple returns (from if/else branches) must all be analyzed
    // so the handler's dirty mask covers every possible modified field.
    const returnExprs: ts.ArrayLiteralExpression[] = []
    const collectReturns = (node: ts.Node): void => {
      if (
        ts.isReturnStatement(node) &&
        node.expression &&
        ts.isArrayLiteralExpression(node.expression) &&
        node.expression.elements.length >= 2
      ) {
        returnExprs.push(node.expression)
        return
      }
      // Don't descend into nested functions — their returns are unrelated.
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node)
      ) {
        return
      }
      ts.forEachChild(node, collectReturns)
    }
    for (const stmt of clause.statements) {
      collectReturns(stmt)
    }
    if (returnExprs.length === 0) continue

    // Union modified fields across all return paths.
    const allModified = new Set<string>()
    let bailOut = false
    for (const returnExpr of returnExprs) {
      const stateExpr = returnExpr.elements[0]!
      const fields = analyzeModifiedFields(stateExpr, stateName, topLevelBits, topLevelBitsHi)
      if (!fields) {
        bailOut = true
        break
      }
      for (const f of fields) allModified.add(f)
    }
    if (bailOut) continue // at least one return path was too complex

    const modifiedFields = Array.from(allModified)

    // Compute the dirty mask for this case across both words. Fields
    // tracked in `topLevelBitsHi` contribute to `caseDirtyHi`; fields
    // tracked nowhere (`undefined` lookup in both) fall back to
    // FULL_MASK in the low word — same conservative behavior as
    // before, just preserved per-word now.
    let caseDirty = 0
    let caseDirtyHi = 0
    for (const field of modifiedFields) {
      const lo = topLevelBits.get(field)
      const hi = topLevelBitsHi.get(field)
      if (lo === undefined && hi === undefined) {
        caseDirty |= 0xffffffff | 0
      } else {
        if (lo !== undefined) caseDirty |= lo
        if (hi !== undefined) caseDirtyHi |= hi
      }
    }

    // Detect array operation pattern for structural block optimization
    const arrayOp = detectArrayOp(clause, modifiedFields, structuralMask, caseDirty)

    const handler = buildCaseHandler(f, caseDirty, caseDirtyHi, arrayOp)
    handlers.push(f.createPropertyAssignment(f.createStringLiteral(msgType), handler))
  }

  if (handlers.length === 0) return null

  return f.createPropertyAssignment('__handlers', f.createObjectLiteralExpression(handlers, true))
}

type ArrayOp =
  | 'none'
  | 'clear'
  | 'mutate'
  | 'remove'
  | 'general'
  | { type: 'strided'; stride: number } // for (i = 0; i < len; i += stride) pattern

/**
 * Detect the array operation pattern in a case body.
 * - 'none': no array field modified (e.g., only `selected` changes)
 * - 'clear': array set to empty literal `[]`
 * - 'mutate': array created via `.slice()` then mutated in place (same keys)
 * - 'general': unknown pattern, use generic reconcile
 */
function detectArrayOp(
  clause: ts.CaseClause,
  modifiedFields: string[],
  _structuralMask?: number,
  _caseDirty?: number,
): ArrayOp {
  // No fields modified → no Phase 1 needed (no bindings can care if no
  // state field changed). Safe to return 'none' here because it's a
  // tautology: every binding mask ANDed with zero is zero.
  if (modifiedFields.length === 0) return 'none'

  // The specialized methods (`reconcileClear`, `reconcileItems`,
  // `reconcileRemove`, `reconcileChanged`) only exist on `each` blocks.
  // Non-each blocks (`show`, `branch`, `scope`) leave them undefined,
  // so a method other than 0 (general reconcile) silently no-ops on
  // those blocks at runtime. If the case modifies fields BEYOND the
  // array op (e.g. `{ ...state, open: true, name: '', tags: [] }`),
  // any show/branch block whose mask intersects the case's dirty bits
  // would be selected for reconcile but then skipped by the no-op
  // method invocation — its `when`/`on` accessor never re-evaluates,
  // and the component appears structurally inert after mount.
  //
  // Conservative correctness: only emit a non-general method when the
  // array op is the SOLE field modification. With one modified field,
  // the only blocks selected by mask gating are ones that read that
  // single field — and the optimization is well-defined for that
  // narrow case (each blocks operating on the array). Multi-field
  // cases fall through to `'general'` (method=0), so every selected
  // block runs the standard `reconcile` path. We trade a niche
  // optimization (small benefit even when applicable) for guaranteed
  // structural reconciliation across the framework's primitive set.
  //
  // Sister of show-helper-reconcile.test.ts, which fixed the same
  // class of bug on the method=-1 path. Same architectural principle:
  // the compiler can't see every block in the view, so optimizations
  // that route around `reconcile` must be ironclad. When in doubt,
  // emit method=0 and let `_handleMsg`'s per-block mask gate filter.
  //
  // Previously: if `(structuralMask & caseDirty) === 0`, return 'none'
  // on the theory that no structural block's mask could intersect this
  // case's dirty bits. That optimization was UNSAFE: `computeStructuralMask`
  // only walks the view function's lexical AST and does not descend into
  // helper function calls. A view like
  //
  //     view: () => [
  //       ...show({ when: s => s.mode === 'signin', render: () => [signinFormBody()] }),
  //     ]
  //
  // where `signinFormBody()` is a helper that internally does
  //     ...show({ when: s => s.errors.email !== undefined, ... })
  //
  // produces a `structuralMask` that covers `mode` but MISSES
  // `errors.email`. At runtime the inner show block is still registered
  // in `inst.structuralBlocks`, and it legitimately needs to reconcile
  // when `errors` changes — but the compiler was emitting `method = -1`
  // (skip blocks entirely) for cases that only touch `errors`, and the
  // error paragraphs would never mount.
  if (modifiedFields.length !== 1) return 'general'
  const onlyField = modifiedFields[0]!

  // Look at the return expression's array field values
  for (const stmt of clause.statements) {
    const returnExpr = findReturnArray(stmt)
    if (!returnExpr) continue

    const stateExpr = returnExpr.elements[0]
    if (!stateExpr || !ts.isObjectLiteralExpression(stateExpr)) continue

    for (const prop of stateExpr.properties) {
      const name =
        ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)
          ? prop.name.text
          : ts.isShorthandPropertyAssignment(prop)
            ? prop.name.text
            : null
      if (!name) continue
      // The optimization only applies when the array op is on the
      // single tracked field. A `field: []` on a different field
      // (one not in modifiedFields, e.g. an untracked field) would
      // still no-op safely on each blocks via the mask gate, but to
      // keep the analysis tight we require an exact match.
      if (name !== onlyField) continue

      // Check for empty array literal: `field: []`
      if (
        ts.isPropertyAssignment(prop) &&
        ts.isArrayLiteralExpression(prop.initializer) &&
        prop.initializer.elements.length === 0
      ) {
        return 'clear'
      }

      // Check for shorthand `field` where field was assigned via `.slice()` earlier
      // This catches: `const rows = state.rows.slice(); rows[i] = ...; return { ...state, rows }`
      if (ts.isShorthandPropertyAssignment(prop)) {
        const varName = prop.name.text
        if (hasSliceAssignment(clause, varName)) {
          // Check for strided for-loop: for (let i = 0; i < arr.length; i += STRIDE)
          const stride = detectStrideLoop(clause, varName)
          if (stride > 1) return { type: 'strided', stride }
          return 'mutate'
        }
      }

      // Check for property assignment with filter: `field: state.field.filter(...)`
      if (ts.isPropertyAssignment(prop) && ts.isCallExpression(prop.initializer)) {
        const call = prop.initializer
        if (
          ts.isPropertyAccessExpression(call.expression) &&
          call.expression.name.text === 'filter'
        ) {
          return 'remove'
        }
      }
    }
  }

  return 'general'
}

function findReturnArray(stmt: ts.Statement): ts.ArrayLiteralExpression | null {
  if (ts.isReturnStatement(stmt) && stmt.expression && ts.isArrayLiteralExpression(stmt.expression))
    return stmt.expression
  if (ts.isBlock(stmt)) {
    for (const inner of stmt.statements) {
      const result = findReturnArray(inner)
      if (result) return result
    }
  }
  return null
}

/**
 * Detect a strided for-loop: `for (let i = 0; i < arr.length; i += STRIDE)`
 * where `arr` is the named variable. Returns the stride or 0 if not found.
 */
function detectStrideLoop(clause: ts.CaseClause, _arrName: string): number {
  function walk(node: ts.Node): number {
    if (ts.isForStatement(node) && node.incrementor) {
      // Check incrementor: i += STRIDE
      const inc = node.incrementor
      if (
        ts.isBinaryExpression(inc) &&
        inc.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken &&
        ts.isNumericLiteral(inc.right)
      ) {
        const stride = parseInt(inc.right.text, 10)
        if (stride > 1) return stride
      }
    }
    return ts.forEachChild(node, walk) ?? 0
  }
  for (const stmt of clause.statements) {
    const result = walk(stmt)
    if (result > 0) return result
  }
  return 0
}

function hasSliceAssignment(clause: ts.CaseClause, varName: string): boolean {
  function walk(node: ts.Node): boolean {
    // Look for: const varName = stateName.field.slice()
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === varName &&
      node.initializer
    ) {
      const init = node.initializer
      if (
        ts.isCallExpression(init) &&
        ts.isPropertyAccessExpression(init.expression) &&
        init.expression.name.text === 'slice'
      ) {
        return true
      }
    }
    return ts.forEachChild(node, walk) ?? false
  }
  for (const stmt of clause.statements) {
    if (walk(stmt)) return true
  }
  return false
}

/**
 * Analyze which top-level state fields are modified in a return expression.
 * Returns the set of field names, or null if too complex to determine.
 */
function analyzeModifiedFields(
  stateExpr: ts.Expression,
  stateName: string,
  topLevelBits: Map<string, number>,
  topLevelBitsHi: Map<string, number> = new Map(),
): string[] | null {
  // Recognize fields tracked in EITHER the low-word or high-word map.
  // 32..61-prefix components have their overflow paths in
  // `topLevelBitsHi`; the case handler's `caseDirty` / `caseDirtyHi`
  // logic depends on us recognizing those fields here.
  const isTracked = (name: string): boolean => topLevelBits.has(name) || topLevelBitsHi.has(name)
  // Pattern: { ...state, field1: ..., field2: ... } or { field1: ..., field2: ... }
  if (ts.isObjectLiteralExpression(stateExpr)) {
    const modified: string[] = []
    for (const prop of stateExpr.properties) {
      if (ts.isSpreadAssignment(prop)) {
        // Only `...state` is safe to ignore — re-spreading state back into
        // state doesn't change any field's identity. ANY other spread
        // (e.g. `...msg.props`, `...someObj`) can overwrite arbitrary
        // top-level fields with new references, and we cannot know which
        // ones statically. Bail out so the generic Phase 2 path runs
        // `__dirty` at runtime and produces a correct mask.
        if (ts.isIdentifier(prop.expression) && prop.expression.text === stateName) {
          continue
        }
        return null
      }
      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
        const fieldName = prop.name.text
        if (isTracked(fieldName)) {
          modified.push(fieldName)
        }
      }
      // Handle shorthand: { ...state, rows } where rows is a local variable
      if (ts.isShorthandPropertyAssignment(prop)) {
        const fieldName = prop.name.text
        if (isTracked(fieldName)) {
          modified.push(fieldName)
        }
      }
    }
    return modified.length > 0 ? modified : null
  }

  // Pattern: state (no change — early return)
  if (ts.isIdentifier(stateExpr) && stateExpr.text === stateName) {
    return [] // no fields modified
  }

  return null // too complex
}

/**
 * Build a handler function for a specific message type case.
 *
 * Generated: (inst, msg) => {
 *   const [s, e] = inst.def.update(inst.state, msg)
 *   inst.state = s
 *   const bl = inst.structuralBlocks, b = inst.allBindings, p = b.length
 *   // Phase 1: gated by caseDirty
 *   for (let i = 0; i < bl.length; i++) {
 *     if (bl[i].mask & caseDirty) bl[i].reconcile(s, caseDirty)
 *   }
 *   // Phase 2
 *   __runPhase2(s, caseDirty, b, p)
 *   return [s, e]
 * }
 */
/**
 * Build a handler that delegates to __handleMsg(inst, msg, dirty, method).
 * method: 0=reconcile, 1=reconcileItems, 2=reconcileClear, 3=reconcileRemove, -1=skip blocks
 */
function buildCaseHandler(
  f: ts.NodeFactory,
  caseDirty: number,
  caseDirtyHi: number,
  arrayOp: ArrayOp,
): ts.ArrowFunction {
  const method =
    typeof arrayOp === 'object' && arrayOp.type === 'strided'
      ? 10 + arrayOp.stride // reconcileChanged with stride
      : arrayOp === 'none'
        ? -1
        : arrayOp === 'mutate'
          ? 1
          : arrayOp === 'clear'
            ? 2
            : arrayOp === 'remove'
              ? 3
              : 0 // general

  // (inst, msg) => __handleMsg(inst, msg, dirty, method, [dirtyHi])
  const args: ts.Expression[] = [
    f.createIdentifier('inst'),
    f.createIdentifier('msg'),
    createMaskLiteral(f, caseDirty),
    method >= 0
      ? f.createNumericLiteral(method)
      : f.createPrefixUnaryExpression(ts.SyntaxKind.MinusToken, f.createNumericLiteral(1)),
  ]
  // Emit the 5th positional arg only when the case touches a high-word
  // field. Stale runtime bundles' _handleMsg signatures ignored that
  // slot anyway; new ones (defaulted to 0) make it explicit when needed.
  if (caseDirtyHi !== 0) args.push(createMaskLiteral(f, caseDirtyHi))
  return f.createArrowFunction(
    undefined,
    undefined,
    [
      f.createParameterDeclaration(undefined, undefined, 'inst'),
      f.createParameterDeclaration(undefined, undefined, 'msg'),
    ],
    undefined,
    f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    f.createCallExpression(f.createIdentifier('__handleMsg'), undefined, args),
  )
}

/**
 * Compute the OR of all structural block masks found in the view function.
 * Returns FULL_MASK if any structural block uses FULL_MASK or if no blocks found.
 */
function computeStructuralMask(
  configArg: ts.ObjectLiteralExpression,
  fieldBits: Map<string, number>,
): number {
  const viewProp = configArg.properties.find(
    (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'view',
  )
  if (!viewProp || !ts.isPropertyAssignment(viewProp)) return 0xffffffff | 0

  let mask = 0
  let foundStructural = false

  function walk(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const name = ts.isIdentifier(node.expression) ? node.expression.text : ''
      if (['each', 'branch', 'scope', 'show'].includes(name) && node.arguments[0]) {
        foundStructural = true
        const opts = node.arguments[0]
        if (ts.isObjectLiteralExpression(opts)) {
          // Check for __mask property (already injected by tryInjectStructuralMask)
          for (const prop of opts.properties) {
            if (
              ts.isPropertyAssignment(prop) &&
              ts.isIdentifier(prop.name) &&
              prop.name.text === '__mask'
            ) {
              if (ts.isNumericLiteral(prop.initializer)) {
                mask |= parseInt(prop.initializer.text, 10)
                return
              }
              if (ts.isPrefixUnaryExpression(prop.initializer)) {
                // Handle negative literals like -1
                mask = 0xffffffff | 0
                return
              }
            }
          }
          // No __mask found — use driving accessor mask
          const driverProp = name === 'each' ? 'items' : name === 'branch' ? 'on' : 'when'
          for (const prop of opts.properties) {
            if (
              ts.isPropertyAssignment(prop) &&
              ts.isIdentifier(prop.name) &&
              prop.name.text === driverProp
            ) {
              if (
                ts.isArrowFunction(prop.initializer) ||
                ts.isFunctionExpression(prop.initializer)
              ) {
                const { mask: m } = computeAccessorMask(prop.initializer, fieldBits)
                mask |= m || 0xffffffff | 0
              }
              break
            }
          }
        }
      }
    }
    ts.forEachChild(node, walk)
  }

  walk(viewProp.initializer)
  return foundStructural ? mask || 0xffffffff | 0 : 0
}

/**
 * Build the `__prefixes` property assignment from path → bit maps.
 *
 * Emits one arrow `(s) => s.<path>` per distinct path. Array index =
 * the path's bit position: positions 0..30 come from `fieldBits` (low
 * word), positions 31..61 from `fieldBitsHi` (high word). The runtime
 * walks this array and reference-compares `prefix(prev)` vs
 * `prefix(next)` per entry, fanning bits into a `(lo, hi)` pair when
 * the array length exceeds 31.
 *
 * Returns null if no paths are present.
 */
function buildPrefixesProp(
  fieldBits: Map<string, number>,
  fieldBitsHi: Map<string, number>,
  f: ts.NodeFactory,
  hasOpaqueAccessor: boolean = false,
): ts.PropertyAssignment | null {
  if (fieldBits.size === 0 && fieldBitsHi.size === 0 && !hasOpaqueAccessor) return null
  // Sort paths by bit value within each word. Bits are powers of two
  // inside their word (1, 2, 4, …, 1<<30), so sorting numerically gives
  // ascending bit position. FULL_MASK (-1) entries from past-61
  // overflow shouldn't drive a prefix entry — defensively skip them.
  const orderedLo = [...fieldBits.entries()]
    .filter(([, bit]) => bit > 0)
    .sort(([, a], [, b]) => a - b)
  const orderedHi = [...fieldBitsHi.entries()].sort(([, a], [, b]) => a - b)
  const buildArrow = (parts: string[]): ts.ArrowFunction => {
    // Empty parts → `(s) => s` (whole-state sentinel). Any other path
    // builds the optional-chain access expression.
    const body = parts.length === 0 ? f.createIdentifier('s') : buildAccess(f, 's', parts)
    return f.createArrowFunction(
      undefined,
      undefined,
      [f.createParameterDeclaration(undefined, undefined, 's')],
      undefined,
      f.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
      body,
    )
  }
  const arrows: ts.ArrowFunction[] = [
    ...orderedLo.map(([path]) => buildArrow(path.split('.'))),
    ...orderedHi.map(([path]) => buildArrow(path.split('.'))),
  ]
  // Append the whole-state sentinel `(s) => s` when any accessor in
  // the file flows state opaquely. Its prefix bit dirties on every
  // update (immutable reducers always return a new object identity),
  // so FULL_MASK bindings — whose mask covers every bit — fire even
  // when the changed field has no traceable prefix entry. Without
  // this, a field read ONLY through an opaque expression would
  // disappear from `__prefixes`; computeDirtyFromPrefixes would
  // return 0 for changes to it; (-1) & 0 = 0; the binding would
  // silently never re-evaluate.
  if (hasOpaqueAccessor) arrows.push(buildArrow([]))
  return f.createPropertyAssignment('__prefixes', f.createArrayLiteralExpression(arrows, false))
}

function buildAccess(f: ts.NodeFactory, root: string, parts: string[]): ts.Expression {
  let expr: ts.Expression = f.createIdentifier(root)
  for (const part of parts) {
    // Use optional chaining for nested paths
    if (parts.length > 1) {
      expr = f.createPropertyAccessChain(expr, f.createToken(ts.SyntaxKind.QuestionDotToken), part)
    } else {
      expr = f.createPropertyAccessExpression(expr, part)
    }
  }
  return expr
}
