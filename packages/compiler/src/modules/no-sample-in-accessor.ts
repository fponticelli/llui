// `no-sample-in-accessor` — errors when `sample()` appears inside an
// accessor passed to a structural primitive (each.items/key, branch.on,
// show.when, scope.on, child.props, foreign.props) or a binding helper
// (text, unsafeHtml). The sampled read is invisible to the compiler's
// mask analysis and breaks reconciliation. Migrated from
// `@llui/eslint-plugin/src/rules/no-sample-in-accessor.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'

const ACCESSOR_PROPS_BY_PRIMITIVE: Record<string, Set<string>> = {
  each: new Set(['items', 'key']),
  branch: new Set(['on']),
  show: new Set(['when']),
  scope: new Set(['on']),
  child: new Set(['props']),
  foreign: new Set(['props']),
}

const BINDING_HELPERS = new Set(['text', 'unsafeHtml'])

function isSampleCall(n: ts.Node): boolean {
  if (!ts.isCallExpression(n)) return false
  if (ts.isIdentifier(n.expression) && n.expression.text === 'sample') return true
  if (
    ts.isPropertyAccessExpression(n.expression) &&
    ts.isIdentifier(n.expression.name) &&
    n.expression.name.text === 'sample'
  )
    return true
  return false
}

function findFirstSampleInside(body: ts.Node): ts.CallExpression | undefined {
  let found: ts.CallExpression | undefined
  const walk = (n: ts.Node): void => {
    if (found) return
    if (isSampleCall(n)) {
      found = n as ts.CallExpression
      return
    }
    // Don't descend into nested functions — `sample` inside a handler
    // callback isn't running in the accessor's reactive position.
    if (
      (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) &&
      n !== body
    ) {
      return
    }
    ts.forEachChild(n, walk)
  }
  walk(body)
  return found
}

function getCalleeName(callee: ts.Expression): string | null {
  if (ts.isIdentifier(callee)) return callee.text
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) return callee.name.text
  return null
}

export function noSampleInAccessorModule(): CompilerModule {
  return {
    name: 'no-sample-in-accessor',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/no-sample-in-accessor',
        description:
          '`sample()` inside an accessor — invisible to mask analysis, breaks reconciliation.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        const walk = (n: ts.Node): void => {
          if (ts.isCallExpression(n)) {
            const name = getCalleeName(n.expression)
            if (name) {
              const accessorProps = ACCESSOR_PROPS_BY_PRIMITIVE[name]
              if (accessorProps !== undefined) {
                const opts = n.arguments[0]
                if (opts && ts.isObjectLiteralExpression(opts)) {
                  for (const prop of opts.properties) {
                    if (!ts.isPropertyAssignment(prop)) continue
                    if (!ts.isIdentifier(prop.name)) continue
                    if (!accessorProps.has(prop.name.text)) continue
                    const v = prop.initializer
                    if (!ts.isArrowFunction(v) && !ts.isFunctionExpression(v)) continue
                    if (!v.body) continue
                    const sample = findFirstSampleInside(v.body)
                    if (sample) {
                      ctx.reportDiagnostic({
                        id: 'llui/no-sample-in-accessor',
                        severity: 'error',
                        category: 'reactivity',
                        message:
                          `\`sample()\` inside \`${name}({ ${prop.name.text}: … })\` reads state ` +
                          `outside the accessor's parameter — invisible to the compiler's mask ` +
                          `analysis. The accessor must be a pure function of its parameter. Lift ` +
                          `the outer state into the parameter (e.g. for \`each.key\`, bake the dep ` +
                          `into \`items\`: \`items: (s) => s.rows.map(it => ({ it, rev: s.rev }))\`, ` +
                          `then \`key: (r) => \`\${r.it.id}|\${r.rev}\`\`).`,
                        location: {
                          file: sf.fileName,
                          range: rangeFromOffsets(sf.text, sample.getStart(sf), sample.getEnd()),
                        },
                      })
                    }
                  }
                }
              } else if (BINDING_HELPERS.has(name)) {
                const arg = n.arguments[0]
                if (arg && (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) && arg.body) {
                  const sample = findFirstSampleInside(arg.body)
                  if (sample) {
                    ctx.reportDiagnostic({
                      id: 'llui/no-sample-in-accessor',
                      severity: 'error',
                      category: 'reactivity',
                      message:
                        `\`sample()\` inside \`${name}((s) => …)\` is redundant and invisible to ` +
                        `mask analysis. Read the state directly via the accessor's parameter: ` +
                        `\`${name}((s) => s.field)\` re-runs reactively on every commit; the ` +
                        `\`sample()\` wrapper bypasses that.`,
                      location: {
                        file: sf.fileName,
                        range: rangeFromOffsets(sf.text, sample.getStart(sf), sample.getEnd()),
                      },
                    })
                  }
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
