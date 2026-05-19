// `each-closure-violation` — errors when an identifier captured from
// parent scope is used at a reactive binding position inside an
// each() render callback. The render is rebuilt per-row; captures of
// state-derived values aren't tracked by the runtime, so the binding
// silently goes stale. Migrated from
// `@llui/eslint-plugin/src/rules/each-closure-violation.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'

// JS / DOM globals + LLui-safe names that are always OK to capture.
const SAFE_NAMES = new Set([
  'console',
  'Math',
  'JSON',
  'String',
  'Number',
  'Boolean',
  'Array',
  'Object',
  'Date',
  'Promise',
  'undefined',
  'null',
  'true',
  'false',
  'NaN',
  'Infinity',
  'document',
  'window',
  'globalThis',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'Error',
  'TypeError',
  'RangeError',
  'Set',
  'Map',
  'WeakSet',
  'WeakMap',
  'Symbol',
  'Reflect',
  'Proxy',
  'send',
])

// Structural property keys on LLui primitives (each, show, branch, etc.)
// Captures inside arrows attached to these keys are NOT reactive
// bindings — they're plumbing.
const STRUCTURAL_KEYS = new Set([
  'render',
  'items',
  'key',
  'init',
  'update',
  'view',
  'onMsg',
  'onSuccess',
  'onError',
  'on',
  'when',
  'cases',
  'fallback',
  'props',
])

/**
 * True when `id` (inside an each() render callback) is at a reactive
 * binding position — first arg to text/unsafeHtml, or the value of a
 * non-handler, non-structural property. Event handlers (`onClick`,
 * etc.) fire at user-interaction time and aren't reactive bindings.
 */
function isAtReactiveBindingPosition(id: ts.Identifier, renderFn: ts.Node): boolean {
  let current: ts.Node | undefined = id.parent
  while (current && current !== renderFn) {
    if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
      const fnParent: ts.Node | undefined = current.parent
      if (
        fnParent &&
        ts.isCallExpression(fnParent) &&
        ts.isIdentifier(fnParent.expression) &&
        fnParent.expression.text === 'text' &&
        fnParent.arguments[0] === current
      ) {
        return true
      }
      if (fnParent && ts.isPropertyAssignment(fnParent) && ts.isIdentifier(fnParent.name)) {
        const propName = fnParent.name.text
        const isEventHandler = /^on[A-Z]/.test(propName) && !STRUCTURAL_KEYS.has(propName)
        if (!STRUCTURAL_KEYS.has(propName) && !isEventHandler) {
          return true
        }
      }
    }
    current = current.parent
  }
  return false
}

/**
 * Collect declarations local to a subtree. Each name → declared.
 * Tracks parameters, var/let/const, function declarations. We
 * conservatively over-collect (block-scoped declarations in a sibling
 * block are recorded as local to the render too) — false negatives
 * (missed captures) are preferable to false positives.
 */
function collectLocalDeclarations(root: ts.Node): Set<string> {
  const out = new Set<string>()
  const visit = (n: ts.Node): void => {
    if (ts.isParameter(n) && ts.isIdentifier(n.name)) {
      out.add(n.name.text)
    } else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      out.add(n.name.text)
    } else if (
      (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n)) &&
      n.name &&
      ts.isIdentifier(n.name)
    ) {
      out.add(n.name.text)
    } else if (ts.isBindingElement(n) && ts.isIdentifier(n.name)) {
      out.add(n.name.text)
    }
    ts.forEachChild(n, visit)
  }
  visit(root)
  return out
}

/** Collect names of top-level imports + module-scope `const`/`function` declarations. */
function collectModuleScopeNames(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>()
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && stmt.importClause) {
      const clause = stmt.importClause
      if (clause.name) out.add(clause.name.text)
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          out.add(clause.namedBindings.name.text)
        } else {
          for (const el of clause.namedBindings.elements) {
            out.add(el.name.text)
          }
        }
      }
    }
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) out.add(d.name.text)
      }
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name) out.add(stmt.name.text)
    if (ts.isClassDeclaration(stmt) && stmt.name) out.add(stmt.name.text)
  }
  return out
}

export function eachClosureViolationModule(): CompilerModule {
  return {
    name: 'each-closure-violation',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/each-closure-violation',
        description:
          'Identifier captured from parent scope inside each() render callback at a reactive position.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        const moduleScopeNames = collectModuleScopeNames(sf)

        const walk = (n: ts.Node): void => {
          if (
            ts.isCallExpression(n) &&
            ts.isIdentifier(n.expression) &&
            n.expression.text === 'each'
          ) {
            const arg = n.arguments[0]
            if (arg && ts.isObjectLiteralExpression(arg)) {
              for (const prop of arg.properties) {
                if (
                  ts.isPropertyAssignment(prop) &&
                  ts.isIdentifier(prop.name) &&
                  prop.name.text === 'render' &&
                  (ts.isArrowFunction(prop.initializer) ||
                    ts.isFunctionExpression(prop.initializer))
                ) {
                  const renderFn = prop.initializer
                  if (!renderFn.body) continue
                  const localNames = collectLocalDeclarations(renderFn)
                  // Walk every identifier reference inside renderFn
                  // body and detect captures. Skip identifiers used
                  // as object/property names (those aren't references).
                  const checkIds = (m: ts.Node): void => {
                    if (ts.isIdentifier(m)) {
                      // Skip if this identifier is being declared, not referenced.
                      const parent = m.parent
                      const isDeclName =
                        (parent && ts.isParameter(parent) && parent.name === m) ||
                        (parent && ts.isVariableDeclaration(parent) && parent.name === m) ||
                        (parent && ts.isBindingElement(parent) && parent.name === m) ||
                        (parent &&
                          (ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent)) &&
                          parent.name === m) ||
                        (parent && ts.isPropertyAccessExpression(parent) && parent.name === m) ||
                        (parent && ts.isPropertyAssignment(parent) && parent.name === m) ||
                        (parent && ts.isShorthandPropertyAssignment(parent) && parent.name === m)
                      if (!isDeclName) {
                        const name = m.text
                        if (
                          !SAFE_NAMES.has(name) &&
                          !moduleScopeNames.has(name) &&
                          !localNames.has(name)
                        ) {
                          // Capture — flag only at reactive position.
                          if (isAtReactiveBindingPosition(m, renderFn)) {
                            ctx.reportDiagnostic({
                              id: 'llui/each-closure-violation',
                              severity: 'error',
                              category: 'reactivity',
                              message:
                                `Identifier \`${name}\` captured from parent scope inside an each() ` +
                                `render callback at a reactive position. The render is rebuilt per-row; ` +
                                `parent captures aren't tracked by the runtime, so the binding silently ` +
                                `goes stale. Use the \`item\` accessor (\`item.${name}()\` for imperative reads, ` +
                                `\`item.${name}\` to pass as a reactive accessor) or destructure it out of ` +
                                `the render bag.`,
                              location: {
                                file: sf.fileName,
                                range: rangeFromOffsets(sf.text, m.getStart(sf), m.getEnd()),
                              },
                            })
                          }
                        }
                      }
                    }
                    ts.forEachChild(m, checkIds)
                  }
                  checkIds(renderFn.body)
                }
              }
            }
          }
          ts.forEachChild(n, walk)
        }
        walk(sf)
      },
    },
  }
}
