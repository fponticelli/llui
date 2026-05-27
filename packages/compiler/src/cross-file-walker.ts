// Cross-file walker — v2b prototype (Phase 1).
//
// Classifies every call expression in a TypeScript Program against the
// §2.1 view-helper resolution rule. Returns diagnostics + a per-callsite
// classification trace.
//
// This is *prototype-grade*: no manifest consumption, no incremental cache,
// no reverse-deps tracking. Phase 3 adds those layers on top.
//
// The rule (§2.1):
//   A call is a view-helper iff at least one of:
//     case 1 — the callee accepts a parameter assignable to View<S,M> or
//              one of the documented structural subsets (send-only,
//              text-only, send+text, send+show+each+branch).
//     case 2 — the callee's *declared* return type is assignable to
//              Node, Node[], Node|undefined, or ReadonlyArray<Node>.
//     case 3 — the callee has a `/** @llui-helper */` JSDoc tag.
//
// Async helpers (declared return Promise<Node[]>) are NOT view-helpers
// and produce `llui/async-view-helper` (hard error).
//
// Everything else: opaque. Emits `llui/opaque-view-call` if the call site
// is structurally a view position (its result flows into a view-returning
// expression); otherwise the call is uninteresting and not reported.

import ts from 'typescript'
import {
  type Diagnostic,
  type DiagnosticCategory,
  type DiagnosticSeverity,
  rangeFromOffsets,
  relativizeFile,
} from './diagnostic.js'
import { isReactiveAccessor } from './collect-deps.js'

export type ViewHelperKind = 'walked' | 'opaque' | 'async' | 'not-a-helper'

export interface ViewHelperClassification {
  kind: ViewHelperKind
  /** Which §2.1 case fired. Only populated when kind === 'walked'. */
  cases: Array<1 | 2 | 3>
  /** Human-readable reason. */
  reason: string
}

export type DiagnosticId = 'llui/opaque-view-call' | 'llui/async-view-helper' | 'llui/helper-cycle'

export interface WalkerDiagnostic {
  id: DiagnosticId
  file: string
  pos: number
  end: number
  message: string
  helperName: string | undefined
}

export interface WalkerResult {
  diagnostics: WalkerDiagnostic[]
  /** Per-file counts for telemetry. */
  perFile: Map<
    string,
    {
      callsClassified: number
      walked: number
      opaque: number
      async: number
      notAHelper: number
    }
  >
}

/**
 * Classify the symbol's declaration against the §2.1 rule.
 *
 * Operates on the *declared* type (`getTypeOfSymbolAtLocation(symbol,
 * symbol.declarations[0])`), not the inferred-at-call-site type. This is
 * load-bearing: TypeScript inference at call sites widens to union
 * shapes (`Node[] | undefined`, `JSX.Element | string`) that miss
 * assignability for case 2. The rule's intent is "did the author commit
 * to a view-helper signature in the declaration" — inference-narrowed
 * types don't satisfy that intent.
 */
export function classifyViewHelper(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
): ViewHelperClassification {
  const decls = symbol.getDeclarations() ?? []
  const decl = decls.find(isCallableDeclaration)
  if (!decl) return { kind: 'not-a-helper', cases: [], reason: 'no callable declaration found' }

  const cases: Array<1 | 2 | 3> = []
  const reasons: string[] = []

  // Case 3: @llui-helper JSDoc tag. Cheap to check, decisive when present.
  if (hasLluiHelperTag(decl)) {
    cases.push(3)
    reasons.push('@llui-helper tag')
  }

  // Get the signature's parameters + return type from the *declaration*.
  const declType = checker.getTypeOfSymbolAtLocation(symbol, decl)
  const sigs = declType.getCallSignatures()
  if (sigs.length === 0) {
    if (cases.includes(3)) {
      return { kind: 'walked', cases, reason: reasons.join('; ') }
    }
    return { kind: 'not-a-helper', cases: [], reason: 'declared type has no call signature' }
  }
  // Use the first signature. Overloaded helpers are rare in view code;
  // production walker should iterate all.
  const sig = sigs[0]!

  // Case 2: declared return type assignable to Node / Node[] / etc.
  const returnType = checker.getReturnTypeOfSignature(sig)
  const asyncMatch = returnTypeIsAsyncNode(returnType, checker)
  if (asyncMatch) {
    return { kind: 'async', cases: [], reason: 'declared return is Promise<Node[] | Node>' }
  }
  if (returnTypeIsNodeShape(returnType, checker)) {
    cases.push(2)
    reasons.push('declared return is Node[]-like')
  }

  // Case 1: at least one parameter assignable to View<S,M> or a documented
  // structural subset. Match on the declared parameter type's shape — we
  // use property-name plus per-property callability as a structural
  // signature. The 5 documented subsets are listed below.
  for (const param of sig.getParameters()) {
    const paramDecl = param.getDeclarations()?.[0]
    if (!paramDecl) continue
    const paramType = checker.getTypeOfSymbolAtLocation(param, paramDecl)
    const subset = matchViewSubset(paramType, checker)
    if (subset) {
      cases.push(1)
      reasons.push(`accepts View subset (${subset})`)
      break
    }
  }

  if (cases.length === 0) {
    return { kind: 'opaque', cases: [], reason: 'no §2.1 case matched' }
  }
  return { kind: 'walked', cases, reason: reasons.join('; ') }
}

/**
 * The 5 documented View subsets, enumerated. New subsets require a doc
 * revision and a fixture per §2.1.
 *
 * Returns the subset's identifier when matched, undefined otherwise.
 * Matching is by *property presence* — we check that the parameter type
 * exposes the required property names, each with a callable type. We
 * intentionally do NOT call `isTypeAssignableTo` against a synthetic
 * subset type, because TypeScript's structural assignability would
 * accept arbitrary supersets and lose the "documented subset" guarantee.
 */
function matchViewSubset(t: ts.Type, _checker: ts.TypeChecker): string | undefined {
  if (!isObjectLike(t)) return undefined
  const props = t.getProperties().map((p) => p.getName())
  const has = (name: string): boolean => props.includes(name)

  // Full View<S,M> bag — must expose at least send + show + each + branch.
  // Real-world callers spread or destructure; the type they pass is the
  // full View<S,M> regardless of how much they use.
  if (has('send') && has('show') && has('each') && has('branch') && has('text')) {
    return 'View<S, M>'
  }
  // send + show + each + branch (no text)
  if (has('send') && has('show') && has('each') && has('branch') && !has('text')) {
    return '{ send, show, each, branch }'
  }
  // send + text
  if (has('send') && has('text') && !has('show') && !has('each')) {
    return '{ send, text }'
  }
  // send only
  if (has('send') && !has('text') && !has('show') && !has('each')) {
    return '{ send }'
  }
  // text only
  if (has('text') && !has('send') && !has('show') && !has('each')) {
    return '{ text }'
  }

  return undefined
}

function isObjectLike(t: ts.Type): boolean {
  return (t.getFlags() & ts.TypeFlags.Object) !== 0
}

/**
 * Returns true if `t` is assignable to one of: `Node`, `Node[]`,
 * `Node | undefined`, `ReadonlyArray<Node>`.
 *
 * Uses the type checker's structural matching against a synthesized
 * `Node`-like — we look up the global `Node` symbol from the lib.dom
 * declarations.
 */
function returnTypeIsNodeShape(t: ts.Type, checker: ts.TypeChecker): boolean {
  // Strip undefined from a union for the "Node | undefined" case.
  const nonUndefined = stripUndefined(t)

  // Array / ReadonlyArray case: element type is Node-like.
  // TypeScript represents both as a `TypeReference` whose target is the
  // global Array / ReadonlyArray and whose first type-arg is the element.
  if (isArrayOrReadonlyArray(nonUndefined)) {
    const elem = getFirstTypeArg(nonUndefined)
    if (elem && isNodeLike(elem, checker)) return true
  }
  // Singular Node return: `function (...): Node`.
  if (isNodeLike(nonUndefined, checker)) return true
  // Union: any member is Node-shaped.
  if (nonUndefined.isUnion()) {
    for (const u of nonUndefined.types) {
      if (returnTypeIsNodeShape(u, checker)) return true
    }
  }
  return false
}

function returnTypeIsAsyncNode(t: ts.Type, checker: ts.TypeChecker): boolean {
  // Promise<X> where X is Node-shaped.
  const sym = t.getSymbol()
  if (!sym || sym.getName() !== 'Promise') return false
  const args = (t as ts.TypeReference).typeArguments
  if (!args || args.length === 0) return false
  return returnTypeIsNodeShape(args[0]!, checker)
}

function stripUndefined(t: ts.Type): ts.Type {
  if (!t.isUnion()) return t
  const nonUndef = t.types.filter(
    (u) => (u.getFlags() & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) === 0,
  )
  if (nonUndef.length === t.types.length) return t
  if (nonUndef.length === 1) return nonUndef[0]!
  return t
}

function isArrayOrReadonlyArray(t: ts.Type): boolean {
  const sym = t.getSymbol()
  if (!sym) return false
  const name = sym.getName()
  return name === 'ReadonlyArray' || name === 'Array'
}

function getFirstTypeArg(t: ts.Type): ts.Type | undefined {
  const args = (t as ts.TypeReference).typeArguments
  return args?.[0]
}

function isNodeLike(t: ts.Type, _checker: ts.TypeChecker): boolean {
  const sym = t.getSymbol()
  if (!sym) return false
  const name = sym.getName()
  // Built-in DOM Node base types — return true on the abstract names.
  if (
    name === 'Node' ||
    name === 'Element' ||
    name === 'HTMLElement' ||
    name === 'Text' ||
    name === 'Comment' ||
    name === 'DocumentFragment' ||
    name === 'ChildNode'
  ) {
    return true
  }
  // The concrete `HTMLDivElement` / `SVGCircleElement` / `MathMLMathElement`
  // names that `HTMLElementTagNameMap[K]` resolves to. Element helpers
  // (`div(...)`, `button(...)`) all hit this branch — without it they
  // would be misclassified as opaque and flood the diagnostic stream.
  return (
    /^HTML[A-Z]\w*Element$/.test(name) ||
    /^SVG[A-Z]\w*Element$/.test(name) ||
    /^MathML[A-Z]\w*Element$/.test(name)
  )
}

function hasLluiHelperTag(decl: ts.Declaration): boolean {
  const jsDocs = ts.getJSDocTags(decl)
  for (const tag of jsDocs) {
    if (tag.tagName.text === 'llui-helper') return true
  }
  return false
}

function isCallableDeclaration(d: ts.Declaration): boolean {
  return (
    ts.isFunctionDeclaration(d) ||
    ts.isFunctionExpression(d) ||
    ts.isArrowFunction(d) ||
    ts.isMethodDeclaration(d) ||
    ts.isVariableDeclaration(d)
  )
}

/**
 * Whether the call site is structurally in a view position. A view
 * position is one where the result flows into:
 *   - the return of a `view()` callback,
 *   - a `Node[]` literal element being built by a structural primitive
 *     (`each.render`, `show.render`, `branch.cases.X`, `scope.render`),
 *   - the children array of an element-helper call.
 *
 * Approximation for the prototype: the call is inside a function whose
 * return type (declared OR inferred from the surrounding context) is
 * Node-shaped. Less precise than tracking JSX-style returns, but
 * sufficient to gate the diagnostic emission for the validation run.
 */
function isViewPositionCall(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
  // Walk up: an enclosing function declaration / arrow whose return is
  // Node-shaped. Stop at the source file.
  let cur: ts.Node | undefined = call.parent
  while (cur) {
    if (
      ts.isFunctionDeclaration(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isArrowFunction(cur) ||
      ts.isMethodDeclaration(cur)
    ) {
      const sig = checker.getSignatureFromDeclaration(cur)
      if (sig) {
        const ret = checker.getReturnTypeOfSignature(sig)
        if (returnTypeIsNodeShape(ret, checker)) return true
      }
      return false
    }
    cur = cur.parent
  }
  return false
}

/**
 * Walk a Program looking for call expressions that should be classified
 * by the §2.1 rule. Restricts the walk to files matching `filter` so
 * tests can scope to a subdirectory.
 */
export function walkProgram(
  program: ts.Program,
  options: { filter?: (sourceFile: ts.SourceFile) => boolean } = {},
): WalkerResult {
  const checker = program.getTypeChecker()
  const filter = options.filter ?? (() => true)
  const diagnostics: WalkerDiagnostic[] = []
  const perFile = new Map<
    string,
    WalkerResult['perFile'] extends Map<string, infer V> ? V : never
  >()

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue
    if (!filter(sf)) continue
    const counts = { callsClassified: 0, walked: 0, opaque: 0, async: 0, notAHelper: 0 }
    perFile.set(sf.fileName, counts)

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        // Resolve the symbol of the callee.
        const callee = node.expression
        let symbol = checker.getSymbolAtLocation(callee)
        if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
          symbol = checker.getAliasedSymbol(symbol)
        }
        if (symbol && !(symbol.flags & ts.SymbolFlags.Transient)) {
          const cls = classifyViewHelper(symbol, checker)
          counts.callsClassified++
          if (cls.kind === 'walked') counts.walked++
          else if (cls.kind === 'opaque') counts.opaque++
          else if (cls.kind === 'async') counts.async++
          else counts.notAHelper++

          if (cls.kind === 'opaque' && isViewPositionCall(node, checker)) {
            diagnostics.push({
              id: 'llui/opaque-view-call',
              file: sf.fileName,
              pos: node.getStart(sf),
              end: node.getEnd(),
              helperName: getCalleeName(callee),
              message: `Call to "${getCalleeName(callee) ?? '<unknown>'}" in a view position is opaque to the cross-file walker (${cls.reason}). Either add an explicit return-type annotation (Node[] / Node / ReadonlyArray<Node>), accept a View bag parameter (or a documented subset), or mark with /** @llui-helper */ if the helper genuinely cannot be annotated. As a last resort, use track({ deps: ... }) at the call site.`,
            })
          } else if (cls.kind === 'async' && isViewPositionCall(node, checker)) {
            diagnostics.push({
              id: 'llui/async-view-helper',
              file: sf.fileName,
              pos: node.getStart(sf),
              end: node.getEnd(),
              helperName: getCalleeName(callee),
              message: `Call to "${getCalleeName(callee) ?? '<unknown>'}" in a view position returns Promise<Node[] | Node>. LLui's view layer is synchronous — wrap async work in onMount() or use clientOnly() instead.`,
            })
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }

  return { diagnostics, perFile }
}

function getCalleeName(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text
  return undefined
}

// ── Diagnostic schema integration (v2c §3) ──────────────────────────
//
// The walker emits a lightweight `WalkerDiagnostic` (with raw byte
// offsets) for internal accumulation. Adapters and the host pipeline
// want the canonical `Diagnostic` shape with project-relative paths
// and line/column ranges. This converter resolves the position pair to
// a Range and relativizes the file path; the caller supplies the
// project root.

const WALKER_DIAGNOSTIC_META: Record<
  DiagnosticId,
  {
    severity: DiagnosticSeverity
    category: DiagnosticCategory
    documentation?: string
  }
> = {
  'llui/opaque-view-call': {
    severity: 'warning',
    category: 'reactivity',
    documentation:
      'https://github.com/fponticelli/llui/blob/main/docs/proposals/v2-compiler/v2b.md#21-view-helper-resolution-rule',
  },
  'llui/async-view-helper': {
    severity: 'error',
    category: 'composition',
    documentation:
      'https://github.com/fponticelli/llui/blob/main/docs/proposals/v2-compiler/v2b.md#21-view-helper-resolution-rule',
  },
  'llui/helper-cycle': {
    severity: 'warning',
    category: 'composition',
    documentation:
      'https://github.com/fponticelli/llui/blob/main/docs/proposals/v2-compiler/v2b.md#23-recursion-and-cycles',
  },
}

/**
 * Convert a walker-internal diagnostic to the canonical `Diagnostic`
 * shape. Reads the source text (for line/column resolution) and a
 * project root (for path relativization).
 */
export function toCanonicalDiagnostic(
  d: WalkerDiagnostic,
  sourceText: string,
  projectRoot: string,
): Diagnostic {
  const meta = WALKER_DIAGNOSTIC_META[d.id]
  return {
    id: d.id,
    severity: meta.severity,
    category: meta.category,
    message: d.message,
    location: {
      file: relativizeFile(d.file, projectRoot),
      range: rangeFromOffsets(sourceText, d.pos, d.end),
    },
    ...(meta.documentation ? { documentation: meta.documentation } : {}),
  }
}

// ── Cross-file accessor path collection ─────────────────────────────
//
// Given a focal source file inside a Program, walk every reactive-accessor
// arrow in the file. For each accessor:
//   - Collect paths it reads directly (the existing AST-only collector
//     handles this — see `collect-deps.ts`).
//   - For every call site inside the accessor whose callee resolves to a
//     view-helper (per §2.1), descend into the callee and merge its reads.
//
// This is the cross-file extension of `collectStatePathsFromSource`. The
// AST-only collector terminates at the file boundary; the cross-file
// version follows view-helper calls into other files using the TypeChecker.
//
// Used by the focal file's compiler to compute its __prefixes table. The
// production wiring (Vite adapter builds a Program; compileFile consumes
// it) is v2c module work — for v2b this is exposed as a callable engine
// API that downstream tools can drive.

/**
 * Collect the cross-file union of accessor paths read from a focal file.
 * Returns the union over every reactive accessor in `focalFile`, with
 * cross-file view-helper descents merged in.
 *
 * Reactive-accessor entry is gated by `isReactiveAccessor` (the same
 * predicate the file-local `collect-deps` walker uses) *plus* a
 * cross-file extension: an arrow at the first-arg position of a call
 * to a §2.1 view-helper also counts as reactive, because that's the
 * lift the helper applies to our state.
 *
 * Without the gate, every 1-param arrow in the file gets walked —
 * including `onEffect: (bag) => bag.send(...)`, where `bag.send` ends
 * up in the path set as a phantom "send" prefix. Issue #5, bug 3.
 */
export function crossFileAccessorPaths(
  program: ts.Program,
  focalFile: ts.SourceFile,
): { paths: Set<string>; opaque: boolean; opaqueNode?: ts.Node } {
  const checker = program.getTypeChecker()
  const paths = new Set<string>()
  // `opaqueOut.node` is the first focal-file accessor whose body
  // triggered the opacity flip. The diagnostic emitter uses it to
  // report a meaningful line number instead of falling back to
  // line 0 (which collapses dedup and gives users no actionable
  // location). See `transform.ts:opaque-accessor-file-wide-mask`
  // diagnostic.
  const opaqueOut: { value: boolean; node?: ts.Node } = { value: false }
  const visitedHelpers = new Set<ts.Declaration>()

  const isViewHelperCallArg0 = (arrow: ts.ArrowFunction | ts.FunctionExpression): boolean => {
    const parent = arrow.parent
    if (!parent || !ts.isCallExpression(parent)) return false
    if (parent.arguments[0] !== arrow) return false
    const sym = resolveAliasedSymbol(parent.expression, checker)
    if (!sym) return false
    return classifyViewHelper(sym, checker).kind === 'walked'
  }

  const visit = (node: ts.Node): void => {
    if (
      (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
      node.parameters.length === 1
    ) {
      const p0 = node.parameters[0]!
      if (ts.isIdentifier(p0.name) && node.body) {
        if (isReactiveAccessor(node) || isViewHelperCallArg0(node)) {
          // Capture the focal-file accessor IF its walk triggers the
          // opacity flip. `walkAccessorBody` may set `opaqueOut.value`
          // anywhere in the body (or in a recursed-into helper body,
          // which lives in a different file). The user can only act on
          // a callsite IN THEIR FILE, so we record the focal-file
          // accessor at the visit-level — this gives users a real line
          // to jump to, not a foreign-file location.
          const wasOpaque = opaqueOut.value
          walkAccessorBody(node.body, p0.name.text, paths, checker, visitedHelpers, opaqueOut)
          if (!wasOpaque && opaqueOut.value && !opaqueOut.node) {
            opaqueOut.node = node
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(focalFile)
  return { paths, opaque: opaqueOut.value, opaqueNode: opaqueOut.node }
}

// Helpers whose arrow args are NOT state accessors — same exclusion list
// the file-local walker uses (collect-deps.ts § NON_DELEGATION_HELPERS).
// `item` / `sample` read state imperatively or per-row; descending into
// their bodies would attribute reads to the wrong scope. `memo` / `text` /
// `unsafeHtml` already have their inline arrow walked by the top-level
// visitor — we'd double-count if we recursed through the call again.
const NON_DELEGATION_CALLEES = new Set(['sample', 'item', 'memo', 'text', 'unsafeHtml'])

function walkAccessorBody(
  body: ts.Node,
  paramName: string,
  paths: Set<string>,
  checker: ts.TypeChecker,
  visitedHelpers: Set<ts.Declaration>,
  opaqueOut: { value: boolean },
): void {
  const visit = (node: ts.Node): void => {
    // Property-chain extraction (mirrors collect-deps' depth-2 normaliser).
    if (ts.isPropertyAccessExpression(node)) {
      const chain = resolveDepth2(node, paramName)
      if (chain) paths.add(chain)
    }

    // Opaque-state-flow classifier (mirrors the per-binding mask
    // classifier in transform.ts:computeAccessorMask). Any standalone
    // appearance of the param identifier in a non-tracked container
    // means the helper reads through an expression we can't trace, so
    // a precise prefix table is insufficient — the host needs a
    // whole-state sentinel in `__prefixes`.
    if (ts.isIdentifier(node) && node.text === paramName) {
      const parent = node.parent
      const isBinding = !!parent && ts.isParameter(parent)
      if (!isBinding) {
        let isTracked = false
        if (parent) {
          if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
            isTracked = true
          } else if (ts.isElementAccessExpression(parent) && parent.expression === node) {
            isTracked =
              ts.isStringLiteralLike(parent.argumentExpression) ||
              ts.isNumericLiteral(parent.argumentExpression)
          } else if (
            ts.isCallExpression(parent) &&
            ts.isIdentifier(parent.expression) &&
            parent.arguments[0] === node &&
            !NON_DELEGATION_CALLEES.has(parent.expression.text)
          ) {
            // Identifier-callee delegations are handled by the
            // descend-into-helper branch below — if the callee
            // resolves, recursion finds opaque inside; if not, the
            // call's `sym` is undefined and the host sees no descent.
            // Treat as tracked here so this branch alone doesn't flip
            // opaque on every well-formed `helper(s)`.
            isTracked = true
          }
        }
        if (!isTracked) opaqueOut.value = true
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const sym = resolveAliasedSymbol(callee, checker)
      if (sym) {
        const cls = classifyViewHelper(sym, checker)
        const decl = sym.getDeclarations()?.find(isFunctionLikeDecl)

        if (cls.kind === 'walked' && decl && !visitedHelpers.has(decl)) {
          // §2.1 view-helper: full descent (arrow-arg accessors lift
          // into our state, identifier args pass our state through).
          visitedHelpers.add(decl)
          descendIntoHelper(
            decl,
            node,
            paramName,
            paths,
            checker,
            visitedHelpers,
            /*viewHelper*/ true,
            opaqueOut,
          )
        } else if (decl && !visitedHelpers.has(decl)) {
          // Non-view-helper: only follow if our state param is passed
          // through unchanged. A helper returning string / boolean /
          // anything-non-Node that reads `s.foo.bar` still contributes
          // those paths to our accessor's read set when called as
          // `helper(s)`. Without this, helpers like
          // `(s) => s.route.kind === 'a'` would have their reads
          // silently dropped, producing a stale-render bug rather than
          // a crash (issue #5, bug 3 false-negative).
          //
          // Skip framework primitives whose arrow args are visited
          // separately (see NON_DELEGATION_CALLEES) — descending would
          // double-count.
          if (
            ts.isIdentifier(callee) &&
            !NON_DELEGATION_CALLEES.has(callee.text) &&
            callPassesParamIdent(node, paramName)
          ) {
            visitedHelpers.add(decl)
            const fnDecl = decl as ts.FunctionLikeDeclaration
            if (fnDecl.body) {
              descendIntoHelper(
                decl,
                node,
                paramName,
                paths,
                checker,
                visitedHelpers,
                /*viewHelper*/ false,
                opaqueOut,
              )
            } else {
              // Declaration without a body — ambient `declare function`,
              // overload signature, or compiled .d.ts. State flows in
              // but we can't see what it reads. Conservative: opaque.
              opaqueOut.value = true
            }
          }
        } else if (!decl && ts.isIdentifier(callee) && !NON_DELEGATION_CALLEES.has(callee.text)) {
          // Callee resolved to a symbol but no function-like
          // declaration (e.g., ambient declaration, type-only import,
          // or a binding whose initializer the checker can't pin
          // down). If state flows in, treat as opaque — same
          // conservative read as the file-local classifier.
          if (callPassesParamIdent(node, paramName)) opaqueOut.value = true
        }
      } else if (ts.isIdentifier(callee) && !NON_DELEGATION_CALLEES.has(callee.text)) {
        // Callee identifier didn't resolve to ANY symbol (declared
        // outside the program, lost through transient binding, etc.).
        // The standalone `s` classifier above already flagged the arg
        // as opaque, so no additional bookkeeping is needed here; the
        // branch is kept to mirror the file-local handling shape.
      }
    }

    ts.forEachChild(node, visit)
  }
  visit(body)
}

function callPassesParamIdent(call: ts.CallExpression, paramName: string): boolean {
  for (const arg of call.arguments) {
    if (ts.isIdentifier(arg) && arg.text === paramName) return true
  }
  return false
}

function descendIntoHelper(
  decl: ts.Declaration,
  callSite: ts.CallExpression,
  outerParamName: string,
  paths: Set<string>,
  checker: ts.TypeChecker,
  visitedHelpers: Set<ts.Declaration>,
  viewHelper: boolean,
  opaqueOut: { value: boolean },
): void {
  // Match each parameter to its argument at the call site.
  //
  // For §2.1 view-helpers: arrow-arg accessors like `(t) => t.foo` are
  // lifts that bind the helper's parameter to a slice of our state;
  // walk their bodies so the slice's reads chain into our path set.
  //
  // For non-view-helpers: we don't know what the helper does with its
  // arrow args — could be a filter callback over a per-item type, or a
  // mapper that doesn't touch state at all. Only the identifier-arg
  // branch (`helper(s)`) is unambiguous, so the non-view-helper case
  // is conservative and only takes that path.
  const fnDecl = decl as ts.FunctionLikeDeclaration
  if (!fnDecl.body) return
  const params = fnDecl.parameters
  for (let i = 0; i < params.length; i++) {
    const param = params[i]!
    const arg = callSite.arguments[i]
    if (!arg) continue
    if (!ts.isIdentifier(param.name)) continue
    if (viewHelper && (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg))) {
      const a0 = arg.parameters[0]
      if (a0 && ts.isIdentifier(a0.name) && arg.body) {
        walkAccessorBody(arg.body, a0.name.text, paths, checker, visitedHelpers, opaqueOut)
      }
    } else if (ts.isIdentifier(arg) && arg.text === outerParamName) {
      walkAccessorBody(fnDecl.body, param.name.text, paths, checker, visitedHelpers, opaqueOut)
    }
  }
}

function resolveAliasedSymbol(node: ts.Node, checker: ts.TypeChecker): ts.Symbol | undefined {
  let sym = checker.getSymbolAtLocation(node)
  if (!sym) return undefined
  if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym)
  if (sym.flags & ts.SymbolFlags.Transient) return undefined
  return sym
}

function resolveDepth2(node: ts.PropertyAccessExpression, paramName: string): string | null {
  const parts: string[] = []
  let current: ts.Expression = node
  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text)
    current = current.expression
  }
  if (!ts.isIdentifier(current) || current.text !== paramName) return null
  if (parts.length === 0) return null
  return parts.slice(0, 2).join('.')
}

function isFunctionLikeDecl(d: ts.Declaration): boolean {
  return (
    ts.isFunctionDeclaration(d) ||
    ts.isFunctionExpression(d) ||
    ts.isArrowFunction(d) ||
    ts.isMethodDeclaration(d)
  )
}
