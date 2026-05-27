// `opaque-state-flow` — errors when a reactive accessor's body flows
// the state identifier into an expression the walker can't statically
// trace. The compiler still produces a *correct* binding by forcing
// FULL_MASK and emitting a whole-state `(s) => s` sentinel into
// `__prefixes` (see `02 Compiler.md` § "Opaque-flow classifier"), but
// the binding then re-evaluates on every state change rather than
// only when its actual reads change. This rule surfaces the leak so
// authors can either:
//
//   - Rewrite the accessor as direct property access (`s.foo`,
//     `s.foo['literal']`), the form the walker can resolve.
//   - Declare the reads explicitly via `track({ deps: (s) => [...] })`
//     — the compile-time escape hatch the framework provides for cases
//     where the read genuinely can't be expressed inline.
//
// Detected leak shapes (mirrors the classifier in
// `transform.ts:computeAccessorMask`):
//   - `helper(s)` with an Identifier callee that can't be resolved to
//     a local declaration (function parameter, import, destructured
//     binding) — the callee may read any field of `s`.
//
// NOT flagged (intentional): `obj.helper(s)` / `lib.fn(s)` —
// PropertyAccessExpression callees. This is the documented headless-
// components idiom (`pr.valueText(s)` where `pr` comes from
// `progress.connect()`), and refactoring it defeats the API surface.
// The runtime sentinel keeps such bindings correct — the cost is a
// per-update re-evaluation, which is a property of the composition
// pattern rather than an author mistake worth blocking.
//   - `new Wrapper(s)` — NewExpression with state as an argument.
//   - `` tag`${s}` `` — TaggedTemplate with state in a span.
//   - `{ ...s }` / `[...s]` — spread of state.
//   - `const x = s` — const aliasing.
//   - `cond ? s : other` — state in a conditional branch (state
//     reaches the binding via a path the walker can't trace).
//   - `s[expr]` — dynamic element access (literal keys are tracked).
//   - State passed as `arg1+` to any call (the existing delegation
//     branch only inspects `arg0`).

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'
import { isReactiveAccessor, shadowsStateParam } from '../collect-deps.js'
import { resolveAccessorBody } from '../accessor-resolver.js'

// Mirrors the file-local list in collect-deps.ts. Calls to these
// framework primitives are visited as accessor positions in their
// own right, so we don't double-classify.
const NON_DELEGATION_HELPERS = new Set(['sample', 'item', 'memo', 'text', 'unsafeHtml'])

interface LeakSite {
  node: ts.Node
  shape: string
  hint: string
}

function findFirstLeakInAccessor(
  accessor: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
  checker: ts.TypeChecker | undefined,
): LeakSite | null {
  if (accessor.parameters.length !== 1) return null
  const param = accessor.parameters[0]!
  if (!ts.isIdentifier(param.name)) return null
  if (!accessor.body) return null
  const stateParam = param.name.text

  let leak: LeakSite | null = null
  const visit = (node: ts.Node): void => {
    if (leak) return
    // Stop descending into nested functions whose parameter shadows
    // `stateParam`. Pre-fix this rule fired a HARD ERROR (severity:
    // error, fails the build) when an outer `(s) =>` contained an
    // inner arrow with a parameter also named `s` that did anything
    // opaque inside. The shadow was invisible to the walker, so the
    // inner reads got attributed to the outer state. With shadow-
    // aware skipping, the inner binding is correctly treated as a
    // separate scope. Same fix shape as `collect-deps.ts` /
    // `transform.ts:computeAccessorMask`.
    if (
      (ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isFunctionDeclaration(node)) &&
      shadowsStateParam(node.parameters, stateParam)
    ) {
      return
    }
    if (ts.isIdentifier(node) && node.text === stateParam) {
      const parent = node.parent
      if (!parent || ts.isParameter(parent)) {
        ts.forEachChild(node, visit)
        return
      }
      // Tracked containers — the same set the mask classifier honors.
      let tracked = false
      let shape = ''
      let hint = ''
      if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
        tracked = true
      } else if (ts.isElementAccessExpression(parent) && parent.expression === node) {
        if (
          ts.isStringLiteralLike(parent.argumentExpression) ||
          ts.isNumericLiteral(parent.argumentExpression)
        ) {
          tracked = true
        } else {
          shape = `dynamic element access \`s[<expr>]\``
          hint =
            'replace the dynamic key with a literal property (e.g. `s.foo`), or declare the read via `track({ deps: (s) => [s[key]] })`.'
        }
      } else if (ts.isCallExpression(parent)) {
        const argIndex = parent.arguments.indexOf(node as ts.Expression)
        if (argIndex > 0) {
          // State passed as arg1+ to a call. The header documents this
          // as NOT flagged (intentional): the existing delegation
          // branch only attempts to trace arg0, and the mask classifier
          // emits a whole-state sentinel into `__prefixes` so the
          // binding stays correct. The cost is per-update re-evaluation
          // — a property of the composition pattern, not an author
          // mistake worth blocking. Without this branch we'd fall
          // through to the default "outside a tracked container" leak.
          tracked = true
        } else if (argIndex === 0) {
          if (
            ts.isIdentifier(parent.expression) &&
            !NON_DELEGATION_HELPERS.has(parent.expression.text)
          ) {
            // Identifier-callee delegation. Recurse into the callee's
            // body via the same resolver the mask walker uses. If it
            // resolves to a local accessor, the helper's reads are
            // walked transitively and the call is tracked. If the
            // callee is a function parameter, import, destructured
            // binding, or otherwise unresolvable, this IS the leak
            // shape — flag it here so the diagnostic points at the
            // call site rather than at some deeper unresolvable read.
            const resolved = resolveAccessorBody(parent.expression, checker)
            if (resolved) {
              tracked = true
            } else {
              const calleeSymbol = checker?.getSymbolAtLocation(parent.expression)
              const isFunctionParam = !!calleeSymbol?.declarations?.some((d: ts.Declaration) =>
                ts.isParameter(d),
              )
              shape = `call to an unresolvable callee \`${parent.expression.text}(s)\` (function parameter, import, or destructured binding)`
              if (isFunctionParam) {
                hint =
                  'this callee is a function parameter — the closure passed at the call site is opaque to per-binding analysis. The framework expects per-row dynamic state to flow through `each` items (slot data on `item.*`) rather than through `(s) => ...` callback parameters; restructure the helper so its bindings read `item.*` and the call site builds the slot data once in `items: (s) => …`. For non-iterating helpers (single-value renderers, form rows, layout chrome) see the other patterns in `https://github.com/fponticelli/llui/blob/main/docs/composition-patterns.md` — accessor passthrough, pre-built Nodes, Node[] slots.'
              } else {
                hint =
                  'inline the read against `s` directly, refactor the callee into a same-module `const`/`function` declaration, or declare the dependencies via `track({ deps: (s) => [...] })`.'
              }
            }
          } else if (!ts.isIdentifier(parent.expression)) {
            // Method-call / computed callee with state arg —
            // `obj.helper(s)`, `lib.fn(s)`. This is the documented
            // headless-components idiom (`pr.valueText(s)` where `pr`
            // comes from `progress.connect()`); refactoring it would
            // defeat the API surface. The runtime sentinel keeps the
            // binding correct — just at the cost of re-evaluating on
            // every update. Treat as tracked from the lint's POV so
            // legitimate composition doesn't error the build; the
            // perf cost is a property of the composition pattern, not
            // an author mistake worth blocking.
            tracked = true
          }
        }
      } else if (ts.isNewExpression(parent)) {
        shape = 'state passed as a constructor argument (`new X(s)`)'
        hint =
          'compute the derived value inline against direct state reads, or use `track({ deps: (s) => [...] })` to declare the reads.'
      } else if (ts.isSpreadElement(parent) || ts.isSpreadAssignment(parent)) {
        shape = 'state spread (`{...s}` / `[...s]`)'
        hint =
          'spread only the fields you actually need (`{...s.user}`), or use `track({ deps: (s) => [...] })`.'
      } else if (ts.isVariableDeclaration(parent)) {
        shape = 'const alias (`const x = s; … x.foo`)'
        hint =
          'inline the alias to `s.foo`, or split the deeper read into a separate single-assignment alias `const foo = s.foo`.'
      } else if (ts.isConditionalExpression(parent)) {
        shape = 'state in a conditional branch (`cond ? s : other`)'
        hint = 'move the conditional inside the property access: `cond ? s.foo : other.foo`.'
      } else if (ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent)) {
        shape = 'type assertion wrapping state (`(s as T).foo`)'
        hint = 'drop the assertion — the chain `s.foo` already carries the type.'
      } else if (ts.isParenthesizedExpression(parent)) {
        // Walk up through parens transparently. Don't flag here; the
        // outer parent classifies.
        ts.forEachChild(node, visit)
        return
      } else {
        shape = `state used outside a tracked container (${describe(parent)})`
        hint =
          'restructure the expression so `s` appears only as the root of a property/element-access chain, or declare the read via `track({ deps: (s) => [...] })`.'
      }
      if (!tracked) {
        leak = { node, shape, hint }
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(accessor.body)
  return leak
}

/**
 * True when `arrow` is the value of a `deps:` PropertyAssignment in
 * a `track({ ... })` call. The diagnostic is suppressed in that
 * position because `track` is the documented escape hatch for cases
 * the walker can't statically infer; firing the lint inside it moves
 * the diagnostic without giving the author a path forward.
 *
 * Handles both forms: bare `track({...})` (import from `@llui/dom`)
 * and the View-bag form `h.track({...})` if it ever exists.
 */
function isInsideTrackDeps(arrow: ts.ArrowFunction | ts.FunctionExpression): boolean {
  const pa = arrow.parent
  if (!pa || !ts.isPropertyAssignment(pa) || !ts.isIdentifier(pa.name) || pa.name.text !== 'deps') {
    return false
  }
  const obj = pa.parent
  if (!obj || !ts.isObjectLiteralExpression(obj)) return false
  const call = obj.parent
  if (!call || !ts.isCallExpression(call) || call.arguments[0] !== obj) return false
  if (ts.isIdentifier(call.expression)) return call.expression.text === 'track'
  if (ts.isPropertyAccessExpression(call.expression)) {
    return call.expression.name.text === 'track'
  }
  return false
}

function describe(node: ts.Node): string {
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node)) return `${describe(node.expression)}.${node.name.text}`
  return ts.SyntaxKind[node.kind]
}

export function opaqueStateFlowModule(): CompilerModule {
  return {
    name: 'opaque-state-flow',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/opaque-state-flow',
        description:
          "Reactive accessor flows state into an opaque expression the walker can't trace. The runtime stays correct via a FULL_MASK binding + whole-state sentinel in `__prefixes`, but the binding then re-evaluates on every state change.",
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        // When the host adapter has built a Program, walk the checker's
        // own SourceFile so symbol resolution (Alias → Symbol via
        // `getSymbolAtLocation`) actually works. The reparsed file used
        // in the AST-only fallback is not part of any Program, so the
        // checker can't resolve identifiers in it. Fall back to a
        // reparse for paths without a Program (test harness, lint
        // adapters without cross-file resolution).
        const visited = node as ts.SourceFile
        const fromProgram = ctx.program?.getSourceFile(visited.fileName)
        const checker = fromProgram ? ctx.checker : undefined
        const sf =
          fromProgram ??
          ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)

        const walk = (n: ts.Node): void => {
          if ((ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && isReactiveAccessor(n)) {
            // `track({ deps: (s) => [...] })` is the user's explicit
            // opt-in for "this binding's reads can't be inferred — trust
            // my declaration." Firing a perf lint inside the user's
            // declaration defeats the primitive's purpose; the
            // diagnostic moves from the original call site to inside
            // track.deps without going away, leaving authors with no
            // recovery path. Suppress here. The mask/path classifier
            // still walks the body for what it can extract; this only
            // silences the lint.
            if (isInsideTrackDeps(n)) {
              ts.forEachChild(n, walk)
              return
            }
            const leak = findFirstLeakInAccessor(n, checker)
            if (leak) {
              ctx.reportDiagnostic({
                id: 'llui/opaque-state-flow',
                severity: 'error',
                category: 'perf',
                message:
                  `Reactive accessor flows state opaquely — ${leak.shape}. ` +
                  `The compiler ships a correct binding (FULL_MASK + whole-state sentinel), ` +
                  `but it re-evaluates on every state change. ${leak.hint}`,
                location: {
                  file: sf.fileName,
                  range: rangeFromOffsets(sf.text, leak.node.getStart(sf), leak.node.getEnd()),
                },
              })
            }
          }
          ts.forEachChild(n, walk)
        }
        walk(sf)
      },
    },
  }
}
