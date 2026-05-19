// `no-let-reactive-accessor` — errors when a top-level `let` / `var`
// binding with a callable initializer is referenced at a reactive
// accessor position. The compiler's `resolveAccessorBody` refuses to
// follow `let` / `var` bindings (reassignment would invalidate any
// compile-time mask analysis), so the binding silently falls back to
// FULL_MASK at runtime — correct but suboptimal. Forcing `const`
// preserves the precise-mask optimization. Migrated from
// `@llui/eslint-plugin/src/rules/no-let-reactive-accessor.ts`.
//
// Note: autofix dropped (per the lint→compiler migration plan); the
// error message includes the exact `let`/`var` → `const` substitution
// so an LLM consuming the error can apply it directly.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'
import { ELEMENT_HELPERS } from './_element-helpers.js'

const REACTIVE_API_NAMES = new Set<string>([
  ...ELEMENT_HELPERS,
  'each',
  'branch',
  'scope',
  'show',
  'memo',
  'portal',
  'foreign',
  'child',
  'errorBoundary',
])
const FIRST_ARG_BINDING_HELPERS = new Set(['text', 'unsafeHtml', 'memo'])

function isAtReactivePosition(node: ts.Identifier): boolean {
  const parent = node.parent
  if (!parent) return false
  if (ts.isCallExpression(parent) && parent.arguments[0] === node) {
    if (ts.isIdentifier(parent.expression)) {
      const name = parent.expression.text
      if (name === 'item' || name === 'sample') return false
      return FIRST_ARG_BINDING_HELPERS.has(name) || REACTIVE_API_NAMES.has(name)
    }
    if (
      ts.isPropertyAccessExpression(parent.expression) &&
      ts.isIdentifier(parent.expression.name)
    ) {
      return FIRST_ARG_BINDING_HELPERS.has(parent.expression.name.text)
    }
    return false
  }
  if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
    if (!ts.isIdentifier(parent.name)) return false
    const key = parent.name.text
    if (/^on[A-Z]/.test(key)) return false
    if (key === 'key' || key === 'name') return false
    let ancestor: ts.Node | undefined = parent.parent
    while (ancestor && !ts.isCallExpression(ancestor)) ancestor = ancestor.parent
    if (!ancestor) return false
    const callExpr = ancestor as ts.CallExpression
    if (!ts.isIdentifier(callExpr.expression)) return false
    return REACTIVE_API_NAMES.has(callExpr.expression.text)
  }
  return false
}

function describeReactiveContext(id: ts.Identifier): string {
  const parent = id.parent
  if (!parent) return 'reactive position'
  if (ts.isCallExpression(parent) && parent.arguments[0] === id) {
    if (ts.isIdentifier(parent.expression)) return `${parent.expression.text}(…)`
    if (
      ts.isPropertyAccessExpression(parent.expression) &&
      ts.isIdentifier(parent.expression.name)
    ) {
      return `…${parent.expression.name.text}(…)`
    }
  }
  if (
    ts.isPropertyAssignment(parent) &&
    parent.initializer === id &&
    ts.isIdentifier(parent.name)
  ) {
    let ancestor: ts.Node | undefined = parent.parent
    while (ancestor && !ts.isCallExpression(ancestor)) ancestor = ancestor.parent
    const calleeName =
      ancestor && ts.isCallExpression(ancestor) && ts.isIdentifier(ancestor.expression)
        ? ancestor.expression.text
        : null
    return calleeName ? `${calleeName}({ ${parent.name.text}: … })` : `{ ${parent.name.text}: … }`
  }
  return 'reactive position'
}

function isCallableInitializer(init: ts.Expression | undefined): boolean {
  if (!init) return false
  if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return true
  if (
    ts.isCallExpression(init) &&
    ts.isIdentifier(init.expression) &&
    init.expression.text === 'memo' &&
    init.arguments.length >= 1
  ) {
    const inner = init.arguments[0]!
    return ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)
  }
  return false
}

/**
 * True when `n` is the target of a write (assignment LHS or
 * pre/postfix increment). We don't try to detect destructuring or
 * compound forms exhaustively — the common case (`foo = …`,
 * `foo += …`, `foo++`) covers the practical reassignment patterns.
 */
function isWriteTarget(n: ts.Identifier): boolean {
  const parent = n.parent
  if (!parent) return false
  if (ts.isBinaryExpression(parent) && parent.left === n) {
    const op = parent.operatorToken.kind
    return (
      op === ts.SyntaxKind.EqualsToken ||
      op === ts.SyntaxKind.PlusEqualsToken ||
      op === ts.SyntaxKind.MinusEqualsToken ||
      op === ts.SyntaxKind.AsteriskEqualsToken ||
      op === ts.SyntaxKind.SlashEqualsToken
    )
  }
  if (ts.isPostfixUnaryExpression(parent) || ts.isPrefixUnaryExpression(parent)) {
    return (
      parent.operator === ts.SyntaxKind.PlusPlusToken ||
      parent.operator === ts.SyntaxKind.MinusMinusToken
    )
  }
  return false
}

export function noLetReactiveAccessorModule(): CompilerModule {
  return {
    name: 'no-let-reactive-accessor',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/no-let-reactive-accessor',
        description:
          '`let` / `var` accessor referenced at a reactive position — compiler falls back to FULL_MASK. Use `const`.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        // Collect single-declarator top-level `let foo = …` /
        // `var foo = …` declarations with a callable initializer.
        // Nested let/var are out of scope — the compiler resolver
        // only follows top-level bindings anyway.
        type Decl = {
          name: string
          kind: 'let' | 'var'
          stmt: ts.VariableStatement
        }
        const decls: Decl[] = []
        for (const stmt of sf.statements) {
          if (!ts.isVariableStatement(stmt)) continue
          const flags = stmt.declarationList.flags
          let kind: 'let' | 'var' | null = null
          if (flags & ts.NodeFlags.Let) kind = 'let'
          else if (!(flags & ts.NodeFlags.Const)) kind = 'var'
          if (!kind) continue
          if (stmt.declarationList.declarations.length !== 1) continue
          const decl = stmt.declarationList.declarations[0]!
          if (!ts.isIdentifier(decl.name)) continue
          if (!isCallableInitializer(decl.initializer)) continue
          decls.push({ name: decl.name.text, kind, stmt })
        }
        if (decls.length === 0) return

        // For each declaration, scan all identifier references in
        // the file. Track reads at reactive positions and any
        // write (reassignment). The declarator's own identifier is
        // excluded.
        const declMap = new Map(decls.map((d) => [d.name, d] as const))
        const state = new Map<
          string,
          { hasReactive: boolean; reactiveContext: string | null; hasReassign: boolean }
        >()
        for (const d of decls) {
          state.set(d.name, { hasReactive: false, reactiveContext: null, hasReassign: false })
        }
        // We don't track shadowing rigorously — a nested `const foo`
        // would still let the outer `let foo`'s name fire. The
        // common case (top-level let, no inner shadowing) is what we
        // care about; shadowing is rare and an inner const would
        // change behavior anyway.
        const walk = (n: ts.Node): void => {
          if (ts.isIdentifier(n) && declMap.has(n.text)) {
            const decl = declMap.get(n.text)!
            const slot = state.get(n.text)!
            // Skip the declarator's own identifier node — that's not
            // a reference, it's the declaration itself.
            const declIdent = decl.stmt.declarationList.declarations[0]!.name
            if (n !== declIdent) {
              if (isWriteTarget(n)) slot.hasReassign = true
              if (!slot.hasReactive && isAtReactivePosition(n)) {
                slot.hasReactive = true
                slot.reactiveContext = describeReactiveContext(n)
              }
            }
          }
          ts.forEachChild(n, walk)
        }
        walk(sf)

        for (const d of decls) {
          const s = state.get(d.name)!
          if (!s.hasReactive) continue
          const reactiveCtx = s.reactiveContext ?? 'reactive position'
          const fixHint = s.hasReassign
            ? `Either avoid reassignment (use \`const\` and a different binding for the new value) or accept the FULL_MASK fallback.`
            : `Fix: change \`${d.kind} ${d.name} = …\` to \`const ${d.name} = …\`.`
          const reasonClause = s.hasReassign
            ? `, but it's reassigned later in the file — the compiler can't follow \`${d.kind}\` bindings`
            : ''
          ctx.reportDiagnostic({
            id: 'llui/no-let-reactive-accessor',
            severity: 'error',
            category: 'reactivity',
            message:
              `\`${d.name}\` is a \`${d.kind}\`-bound accessor used at a reactive position ` +
              `(${reactiveCtx})${reasonClause}. The compiler only follows \`const\` bindings; ` +
              `\`${d.kind}\` falls back to FULL_MASK at runtime. ${fixHint}`,
            location: {
              file: sf.fileName,
              range: rangeFromOffsets(sf.text, d.stmt.getStart(sf), d.stmt.getEnd()),
            },
          })
        }
      },
    },
  }
}
