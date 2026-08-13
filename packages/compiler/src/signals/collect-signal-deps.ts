// File-level dependency-path collection — the answer to "which state paths does
// this file read?"
//
// This is a DRIVER, not an analyzer. Every path it reports comes out of
// `analyzeSignalExpr` (extract-deps.ts → analyze-deps.ts), the SAME analysis the
// view transform uses to build each binding's `deps` array. The driver only
// decides WHERE to point it: each `component({ view: ({ state }) => … })` in the
// file, rooted at that view's own `state` alias.
//
// It exists because the transform answers per BINDING (and only for the slots it
// can lower), while the agent-facing `llui_static_collect_paths` tool answers per
// FILE and must not go quiet on a view the transform left verbatim. Keeping it a
// driver is the point: there was once a second, independent path collector
// (`collect-deps.ts`), it truncated every path at two segments, and it was the
// one agents were shown (issue #92). One analysis, two framings.
//
// Scope and its honest edges:
//   - Only signal component VIEWS are analyzed. A view-helper function
//     (`header(state.at('header'), send)`) roots in a caller-supplied handle, so
//     file-locally there is no state to be relative to; the helper's reads are
//     covered at the CALL site by the path of the handle passed in.
//   - Row-relative reads inside `each` are covered by the list's own path (a dep
//     on `rows` covers every `rows.<i>.<field>`), so they are not enumerated.
//   - `''` — the whole state — is reported as `wholeState`, never as a path.

import ts from 'typescript'
import {
  analyzeSignalExpr,
  isSignalExpr,
  viewSignalRoots,
  type RootInfo,
  type Roots,
} from './extract-deps.js'
import { HelperBindings, scopeIntroduces } from './helper-bindings.js'
import type { ParsedModule } from '../parse.js'

export interface SignalDepsResult {
  /** Absolute state paths, deduped and sorted. Excludes the whole-state read. */
  paths: string[]
  /** At least one binding reads the state wholesale (dep path `''`), so the
   * runtime cannot gate it on any narrower path. */
  wholeState: boolean
  /** How many signal component views were analyzed. Zero means the file has no
   * `component({ view: ({ state }) => … })` — `paths` being empty says nothing
   * about the file's reactivity. */
  views: number
}

/**
 * Collect the dependency paths every signal component view in `mod` reads.
 *
 * Paths are reported at full authored depth: `state.at('user').at('profile')
 * .at('address').at('city')` is `user.profile.address.city`, not a two-segment
 * prefix of it. Truncating to a prefix stays SOUND for gating (a dep on a prefix
 * covers every descendant, because an immutable update replaces the prefix
 * reference) but it misreports what the code actually reads.
 *
 * Takes a {@link ParsedModule} — which carries the real filename, and with it the
 * parse ScriptKind. That is not merely for reporting: a `.ts` file parsed as TSX
 * misparses the generic arrow form (`const id = <T>(x: T): T => x`), and here
 * that would not raise an error, it would silently return `views: 0, paths: []`.
 */
export function collectSignalDeps(mod: ParsedModule): SignalDepsResult {
  const sf = mod.sourceFile()
  // Import-binding aware `component(...)` recognition — the same gate the
  // transform uses, so an aliased or shadowed `component` is classified
  // identically in both.
  const bindings = HelperBindings.fromSourceFile(sf)

  const all = new Set<string>()
  let views = 0

  /** Union the deps of every MAXIMAL signal expression in `node`. Maximal
   * matters: `state.at('user').at('profile')` contains `state.at('user')`, and
   * counting both would report the coarse prefix alongside the precise path. */
  const collect = (node: ts.Node, roots: Roots): void => {
    if (couldBeSignalExpr(node) && isSignalExpr(node, roots)) {
      for (const p of analyzeSignalExpr(node, roots)) all.add(p)
      return
    }
    // Scope-aware rooting: a name is only THE root while nothing between here and
    // the view rebinds it. `each(state.at('rows'), key, (state) => …)` hands the
    // row arm a plain row handle that happens to reuse the name — reading roots
    // through it invents top-level paths that do not exist (`label` for a row's
    // `state.at('label')`) and flags a whole-state read that never happened.
    let childRoots = roots
    const shadowed = [...roots.keys()].filter((name) => scopeIntroduces(node, name))
    if (shadowed.length > 0) {
      const pruned = new Map<string, RootInfo>(roots)
      for (const name of shadowed) pruned.delete(name)
      childRoots = pruned
    }
    node.forEachChild((c) => collect(c, childRoots))
  }

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      bindings.resolveCall(node) === 'component' &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      for (const prop of node.arguments[0].properties) {
        if (
          !ts.isPropertyAssignment(prop) ||
          prop.name.getText(sf) !== 'view' ||
          !(ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer))
        ) {
          continue
        }
        const roots = viewSignalRoots(prop.initializer)
        if (!roots) continue
        views++
        collect(prop.initializer.body, roots)
      }
    }
    node.forEachChild(visit)
  }
  visit(sf)

  const wholeState = all.delete('')
  return { paths: [...all].sort(), wholeState, views }
}

/** Could `n` be a maximal signal expression? The forms `isSignalExpr` can match,
 * and — for a bare identifier — only where it is an actual VALUE reference.
 *
 * The identifier half is the whole point. `forEachChild` yields identifiers that
 * are property KEYS and binding NAMES, not reads: the `state` in
 * `connect({ state: state.at('dialog') })`, in `({ el, state: sig }) => …`, in
 * `opts.state`, and in the row parameter `(state) => …`. Matching those against
 * the root name reports a whole-state read the code never performs — an
 * affirmative `opaque: true` on the canonical `connect`/`overlay` wiring. A tool
 * that lies confidently is the exact failure #92 exists to remove, so this
 * predicate must reject a name slot; when it is unsure it says yes, because
 * over-reporting a dependency is sound and under-reporting is not. */
function couldBeSignalExpr(n: ts.Node): n is ts.Expression {
  if (
    ts.isCallExpression(n) ||
    ts.isParenthesizedExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isNonNullExpression(n) ||
    ts.isSatisfiesExpression(n)
  ) {
    return true
  }
  // A PropertyAccess is never itself a signal expression (`isSignalExpr` matches
  // `.at`/`.map`/`.peek` CALLS), and descending into it is how `obj.state` gets
  // reached — so let the walk continue rather than testing it here.
  return ts.isIdentifier(n) && isValueReference(n)
}

/** Is this identifier a READ of a binding, rather than a name being declared or a
 * static member/property key? Unknown parents default to `true` (a read), so a
 * shape not enumerated here coarsens instead of vanishing. */
function isValueReference(id: ts.Identifier): boolean {
  const p = id.parent
  if (!p) return true
  // `{ state }` in an object LITERAL really does read `state` (unlike `{ state }`
  // in a binding PATTERN, which declares it — `isBindingElement` below).
  if (ts.isShorthandPropertyAssignment(p)) return true
  if (ts.isPropertyAccessExpression(p)) return p.expression === id // `state.at` yes, `obj.state` no
  if (ts.isQualifiedName(p)) return p.left === id
  if (ts.isPropertyAssignment(p)) return p.initializer === id // `{ state: … }` key is not a read
  if (ts.isBindingElement(p)) return false // both `propertyName` and `name` are declarations
  if (ts.isParameter(p) || ts.isVariableDeclaration(p)) return p.initializer === id
  if (
    ts.isFunctionDeclaration(p) ||
    ts.isClassDeclaration(p) ||
    ts.isMethodDeclaration(p) ||
    ts.isMethodSignature(p) ||
    ts.isPropertyDeclaration(p) ||
    ts.isPropertySignature(p) ||
    ts.isGetAccessorDeclaration(p) ||
    ts.isSetAccessorDeclaration(p) ||
    ts.isEnumMember(p) ||
    ts.isImportSpecifier(p) ||
    ts.isExportSpecifier(p) ||
    ts.isImportClause(p) ||
    ts.isNamespaceImport(p) ||
    ts.isTypeReferenceNode(p) ||
    ts.isTypeParameterDeclaration(p) ||
    ts.isInterfaceDeclaration(p) ||
    ts.isTypeAliasDeclaration(p) ||
    ts.isLabeledStatement(p) ||
    ts.isBreakOrContinueStatement(p) ||
    ts.isMetaProperty(p)
  ) {
    return false
  }
  return true
}
