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
import { analyzeSignalExpr, isSignalExpr, viewSignalRoots, type Roots } from './extract-deps.js'
import { HelperBindings } from './helper-bindings.js'
import { scriptKindForFilename } from './script-kind.js'

export interface CollectSignalDepsOptions {
  /** Source file path — decides the parse ScriptKind (`.ts` vs `.tsx`). */
  fileName?: string
}

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
 * Collect the dependency paths every signal component view in `source` reads.
 *
 * Paths are reported at full authored depth: `state.at('user').at('profile')
 * .at('address').at('city')` is `user.profile.address.city`, not a two-segment
 * prefix of it. Truncating to a prefix stays SOUND for gating (a dep on a prefix
 * covers every descendant, because an immutable update replaces the prefix
 * reference) but it misreports what the code actually reads.
 */
export function collectSignalDeps(
  source: string,
  opts: CollectSignalDepsOptions = {},
): SignalDepsResult {
  const fileName = opts.fileName ?? 'm.tsx'
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForFilename(fileName),
  )
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
    if (isExpression(node) && isSignalExpr(node, roots)) {
      for (const p of analyzeSignalExpr(node, roots)) all.add(p)
      return
    }
    node.forEachChild((c) => collect(c, roots))
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

/** Expression-node guard for the maximal-signal walk. `isSignalExpr` only ever
 * matches identifiers and calls, so the narrow set below is sufficient — and
 * keeps the walk from re-testing every token. */
function isExpression(n: ts.Node): n is ts.Expression {
  return (
    ts.isIdentifier(n) ||
    ts.isCallExpression(n) ||
    ts.isPropertyAccessExpression(n) ||
    ts.isParenthesizedExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isNonNullExpression(n) ||
    ts.isSatisfiesExpression(n)
  )
}
