// __llui_deps.json — v2b library-boundary manifest (§4.2).
//
// Every published @llui/* package (and any third-party package that wants
// compiler-level integration) emits a manifest declaring each exported
// helper's reactive footprint: paths read directly, paths reached through
// accessor parameters, and context-provider keys consumed.
//
// The schema is the result of validating against the real @llui/components
// surface — every shape here is needed by some real helper. New shapes
// require a schema-version bump + a worked example in §4.3.
//
// The substitution algorithm (`substituteHelperCall`) consumes a manifest
// entry plus a call-site's argument expressions and computes the set of
// host-state paths the call contributes to the consumer's __prefixes.

import ts from 'typescript'

// ── Schema ──────────────────────────────────────────────────────────

export interface Manifest {
  /** Schema version. Frozen at 1 in v2b. */
  version: 1
  /** Compiler version that emitted this manifest. */
  compilerVersion: string
  /** Exported helpers keyed by name. */
  helpers: Record<string, HelperEntry>
  /** Exported components keyed by name (for completeness; not used in v2b's substitution). */
  components: Record<string, ComponentEntry>
}

export interface HelperEntry {
  /**
   * `'view-helper'` — the call returns Node[]-like and is resolved once per
   * call site.
   * `'parts-helper'` — the call returns a *parts bag* (a record of accessor
   * thunks). The bag is later spread into element calls by the consumer;
   * every spread contributes the same read set.
   */
  kind: 'view-helper' | 'parts-helper'
  /** Paths the helper reads from its OWN state shape (rare; usually empty). */
  helperLocalPaths: string[]
  /** Per-parameter substitution metadata. Index N corresponds to the helper's Nth declared parameter. */
  viaParams: ParamSpec[]
  /** Context-provider keys this helper consumes. Resolved against the consumer's provide() call sites. */
  contextReads?: ContextRead[]
}

export interface ComponentEntry {
  /** Reserved for v2b's read-everything-the-component-reads escape hatch. Unused at v2b ship. */
  name: string
}

export type ParamSpec =
  | { index: number; shape: 'accessor'; innerReads: InnerRead[] }
  | {
      index: number
      shape: 'accessor'
      /** This parameter's body operates on the result of parameter N. */
      readsThroughResultOf: number
      innerReads: InnerRead[]
    }
  | { index: number; shape: 'options-bag'; fields: Record<string, FieldSpec> }
  | { index: number; shape: 'send' }
  | { index: number; shape: 'thunk-returning-nodes' }
  | { index: number; shape: 'opaque' }

export type FieldSpec =
  | { shape: 'accessor'; innerReads: InnerRead[] }
  | {
      shape: 'accessor'
      readsThroughResultOf: number
      innerReads: InnerRead[]
    }
  | { shape: 'send' }
  | { shape: 'thunk-returning-nodes' }
  | { shape: 'opaque' }

export type InnerRead =
  /** Helper-local read — rare; the helper sees state directly. */
  | { kind: 'rooted'; path: string }
  /** The entire result of parameter N. */
  | { kind: 'param-result'; from: number }
  /** A sub-path within parameter N's accessor result. The dominant kind across @llui/components. */
  | { kind: 'param-result-path'; from: number; path: string }

export interface ContextRead {
  /** Canonical id: `<package-name>#<export-name>`. */
  context: string
  /** Sub-paths within the context value the helper reads. */
  subPaths: string[]
}

// ── Substitution algorithm (§4.4) ───────────────────────────────────

export interface ContextProvider {
  context: string
  /** Source AST for the consumer's `provide(LocaleContext, (s) => s.i18n, ...)` accessor. */
  accessor: ts.ArrowFunction | ts.FunctionExpression | undefined
}

export interface SubstitutionContext {
  /** Maps canonical context ids to the consumer's matching provide(...) accessor. */
  providers: Map<string, ContextProvider>
  /**
   * Path-extraction hook. Walks an arrow body and returns the dotted paths
   * it reads. The cross-file walker injects its `extractAccessorPaths`
   * here; tests can stub with a simpler walker.
   */
  extractPaths: (
    accessor: ts.ArrowFunction | ts.FunctionExpression,
    rootParamName: string,
  ) => string[]
}

export interface SubstitutionResult {
  /** Host-state paths contributed by this call site, e.g. `['carousel.paused', 'carousel.current']`. */
  paths: string[]
  /** Diagnostics emitted by the substitution. */
  diagnostics: SubstitutionDiagnostic[]
  /** Whether the call site fell back to FULL_MASK (e.g. unrecognized options-bag shape). */
  fullMask: boolean
}

export interface SubstitutionDiagnostic {
  id:
    | 'llui/opaque-options-bag'
    | 'llui/missing-context-provider'
    | 'llui/substitution-depth-exceeded'
    | 'llui/substitution-cycle'
  message: string
}

const MAX_SUBSTITUTION_DEPTH = 8

/**
 * Substitute a manifest helper call against its call-site arguments.
 *
 * Given a helper's manifest entry and the argument expressions at one call
 * site, returns the set of host-state paths the call contributes to the
 * consumer's __prefixes table.
 *
 * §4.4 substitution rules:
 *   1. For each ViaParams entry, resolve the call-site argument.
 *   2. `shape: 'accessor'` parameters are walked via `extractPaths`.
 *   3. `shape: 'options-bag'` parameters are unpacked field-by-field
 *      against the call site's object-literal argument.
 *   4. `innerReads` are composed against the resolved accessors:
 *      - rooted: helper-local, contributed verbatim
 *      - param-result: paths from param N's body
 *      - param-result-path: lift + sub-path composition
 *   5. `readsThroughResultOf: N` — param's body operates on param N's
 *      result; substitution composes through N's accessor.
 *   6. `contextReads` — resolved against `providers`; provider.accessor +
 *      subPaths compose to host-state paths.
 *   7. Depth bounded at 8; cycles caught by `(helper-symbol, param-index)`
 *      visited set.
 */
export function substituteHelperCall(
  entry: HelperEntry,
  callArgs: ReadonlyArray<ts.Expression>,
  ctx: SubstitutionContext,
  helperKey = 'anonymous',
  visited = new Set<string>(),
  depth = 0,
): SubstitutionResult {
  const out: SubstitutionResult = { paths: [], diagnostics: [], fullMask: false }

  if (depth > MAX_SUBSTITUTION_DEPTH) {
    out.diagnostics.push({
      id: 'llui/substitution-depth-exceeded',
      message: `Substitution depth exceeded 8 at helper "${helperKey}" (likely deep helper chain); contributing FULL_MASK at this call site.`,
    })
    out.fullMask = true
    return out
  }

  // 1. Helper-local paths — rare; contributed verbatim. Reserved for the
  //    case where the helper's "host state shape" equals the consumer's
  //    (e.g. trivial passthrough helpers).
  for (const p of entry.helperLocalPaths) out.paths.push(p)

  // 2. Per-parameter resolution.
  for (const param of entry.viaParams) {
    const arg = callArgs[param.index]

    if (param.shape === 'send' || param.shape === 'opaque') {
      // No path contribution — send is a Send<M> ref, opaque is intentional.
      continue
    }

    if (param.shape === 'thunk-returning-nodes') {
      // The call site provides a `() => Node[]` thunk that closes over
      // consumer-scope accessors. The substitution layer can't see inside
      // the closure without re-walking the consumer's view source — that
      // walk happens at the consumer's compile step, not here. We mark
      // this param's contribution as "must be walked by consumer", which
      // the cross-file walker handles by recursing into the thunk body
      // directly. The manifest substitution itself contributes no paths.
      continue
    }

    if (param.shape === 'options-bag') {
      if (!arg || !ts.isObjectLiteralExpression(arg)) {
        // Non-literal options bag (variable reference, spread, etc.) is
        // FULL_MASK at this call site. Real-world consumers do sometimes
        // pre-build the options bag; we accept the cost and warn.
        out.diagnostics.push({
          id: 'llui/opaque-options-bag',
          message: `Options-bag argument at index ${param.index} of "${helperKey}" is not an object literal; contributing FULL_MASK.`,
        })
        out.fullMask = true
        continue
      }
      // Unpack: each field listed in `fields` is matched against the
      // call-site object literal's property.
      for (const [fieldName, fieldSpec] of Object.entries(param.fields)) {
        const prop = arg.properties.find(
          (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === fieldName,
        )
        if (!prop || !ts.isPropertyAssignment(prop)) continue
        const fieldExpr = prop.initializer
        substituteField(fieldSpec, fieldExpr, ctx, helperKey, visited, depth, out, entry)
      }
      continue
    }

    // shape: 'accessor'
    // Compose helper's innerReads. Each `kind: 'param-result*'` reads
    // through `callArgs[from]`'s accessor — which may be a different
    // parameter (the readsThroughResultOf case). Hence the resolver
    // takes `from` per innerRead, not the enclosing `param.index`.
    for (const ir of param.innerReads) {
      if (ir.kind === 'rooted') {
        out.paths.push(ir.path)
        continue
      }
      const liftPaths = liftPathsForArg(callArgs[ir.from], ctx)
      if (ir.kind === 'param-result') {
        for (const p of liftPaths) out.paths.push(p)
      } else if (ir.kind === 'param-result-path') {
        for (const lift of liftPaths) {
          out.paths.push(lift ? `${lift}.${ir.path}` : ir.path)
        }
      }
    }
  }

  // 6. Context-provider reads.
  if (entry.contextReads) {
    for (const cr of entry.contextReads) {
      const provider = ctx.providers.get(cr.context)
      if (!provider) {
        out.diagnostics.push({
          id: 'llui/missing-context-provider',
          message: `Helper "${helperKey}" reads from context "${cr.context}" but no matching provide(${cr.context}, ...) call was found in the consumer. The reads will fall back to FULL_MASK; add a provider or wrap the helper's call site in one.`,
        })
        out.fullMask = true
        continue
      }
      if (!provider.accessor) continue
      const rootParamName = getFirstParamName(provider.accessor)
      if (!rootParamName) continue
      const liftPaths = ctx.extractPaths(provider.accessor, rootParamName)
      for (const lift of liftPaths) {
        for (const sub of cr.subPaths) {
          out.paths.push(lift ? `${lift}.${sub}` : sub)
        }
      }
    }
  }

  // Dedup. Use a Set roundtrip — order is incidental for __prefixes.
  out.paths = [...new Set(out.paths)]
  return out
}

function substituteField(
  fieldSpec: FieldSpec,
  fieldExpr: ts.Expression,
  ctx: SubstitutionContext,
  helperKey: string,
  visited: Set<string>,
  depth: number,
  out: SubstitutionResult,
  entry: HelperEntry,
): void {
  if (fieldSpec.shape === 'send' || fieldSpec.shape === 'opaque') return
  if (fieldSpec.shape === 'thunk-returning-nodes') return // consumer's view walker handles this

  // shape: 'accessor' — field's innerReads compose against the field
  // expression's accessor (depth-1 within the options bag).
  const liftPaths = liftPathsForArg(fieldExpr, ctx)
  for (const ir of fieldSpec.innerReads) {
    if (ir.kind === 'rooted') {
      out.paths.push(ir.path)
    } else if (ir.kind === 'param-result') {
      for (const p of liftPaths) out.paths.push(p)
    } else if (ir.kind === 'param-result-path') {
      for (const lift of liftPaths) {
        out.paths.push(lift ? `${lift}.${ir.path}` : ir.path)
      }
    }
  }
  // Silence the unused `entry`/`visited`/`helperKey`/`depth` — kept in
  // the signature to mirror substituteHelperCall and ease the eventual
  // recursive substitution Phase 3 lands.
  void entry
  void visited
  void helperKey
  void depth
}

/**
 * Walk the call-site argument (or options-bag field) as an accessor and
 * return its dotted path reads. Returns [] when the arg is not an arrow/
 * function expression — substitution falls through to no contribution.
 */
function liftPathsForArg(arg: ts.Expression | undefined, ctx: SubstitutionContext): string[] {
  if (!arg) return []
  const accessor = unwrapAccessorArg(arg)
  if (!accessor) return []
  const rootParamName = getFirstParamName(accessor)
  if (!rootParamName) return []
  return ctx.extractPaths(accessor, rootParamName)
}

/**
 * Unwrap a call-site argument into the accessor function expression, if any.
 * Accepts inline arrows, function expressions, and identifiers that
 * resolve to a local const initializer (one level — Phase 3's walker
 * generalizes this via the existing `resolveAccessorBody`).
 */
function unwrapAccessorArg(arg: ts.Expression): ts.ArrowFunction | ts.FunctionExpression | null {
  if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) return arg
  return null
}

function getFirstParamName(fn: ts.ArrowFunction | ts.FunctionExpression): string | undefined {
  const p0 = fn.parameters[0]
  if (!p0 || !ts.isIdentifier(p0.name)) return undefined
  return p0.name.text
}
