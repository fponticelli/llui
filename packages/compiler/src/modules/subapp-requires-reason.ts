// `subapp-requires-reason` — errors when a `subApp({...})` call lacks a
// non-empty string-literal `reason` property. `reason` is a sticky
// comment documenting WHY a state-isolation boundary is needed rather
// than a view function — meant to be auditable the way an
// `eslint-disable` comment is. Migrated from
// `@llui/eslint-plugin/src/rules/subapp-requires-reason.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'

const ORG_EXCUSE_REGEXES = [
  /\bcode\s+organi[zs]ation\b/i,
  /\b(break|breaking|split|splitting)\s+(this|up)\b/i,
  /\b(felt|just)\s+like\b/i,
  /\bsubcomponent\b/i,
]

/** Resolve a local `const NAME = "..."` to its string literal value, if any. */
function resolveLocalStringConst(sf: ts.SourceFile, name: string): string | null {
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    if (!(stmt.declarationList.flags & ts.NodeFlags.Const)) continue
    for (const d of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.name.text !== name) continue
      const init = d.initializer
      if (!init) return null
      if (ts.isStringLiteral(init)) return init.text
      if (ts.isNoSubstitutionTemplateLiteral(init)) return init.text
    }
  }
  return null
}

export function subappRequiresReasonModule(): CompilerModule {
  return {
    name: 'subapp-requires-reason',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/subapp-requires-reason',
        description:
          'subApp() requires a non-empty string-literal `reason` documenting why a state boundary is needed.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)

        const report = (n: ts.Node, message: string): void => {
          ctx.reportDiagnostic({
            id: 'llui/subapp-requires-reason',
            severity: 'error',
            category: 'composition',
            message,
            location: {
              file: sf.fileName,
              range: rangeFromOffsets(sf.text, n.getStart(sf), n.getEnd()),
            },
          })
        }

        const checkText = (text: string, reportAt: ts.Node): void => {
          const trimmed = text.trim()
          if (trimmed === '') {
            report(
              reportAt,
              `subApp()'s \`reason\` must be a non-empty string. Decomposing for code organization ` +
                `is not a valid reason — write a view function instead.`,
            )
            return
          }
          if (ORG_EXCUSE_REGEXES.some((re) => re.test(trimmed))) {
            report(
              reportAt,
              `subApp() \`reason\` looks like a code-organization excuse ('${trimmed}'). Real ` +
                `reasons name foreign lifecycle, isolated frame budget, or sealed state. For ` +
                `decomposition, write a view function — see docs/proposals/unified-composition-model.md.`,
            )
          }
        }

        const walk = (n: ts.Node): void => {
          if (ts.isCallExpression(n)) {
            let calleeName: string | null = null
            if (ts.isIdentifier(n.expression)) calleeName = n.expression.text
            else if (
              ts.isPropertyAccessExpression(n.expression) &&
              ts.isIdentifier(n.expression.name)
            )
              calleeName = n.expression.name.text
            if (calleeName === 'subApp') {
              const arg = n.arguments[0]
              if (arg && ts.isObjectLiteralExpression(arg)) {
                const reasonProp = arg.properties.find(
                  (p): p is ts.PropertyAssignment =>
                    ts.isPropertyAssignment(p) &&
                    ((ts.isIdentifier(p.name) && p.name.text === 'reason') ||
                      (ts.isStringLiteral(p.name) && p.name.text === 'reason')),
                )
                if (!reasonProp) {
                  report(
                    arg,
                    `subApp() requires a \`reason\` property. Add a string literal naming WHY a ` +
                      `state-isolation boundary is needed here rather than a view function ` +
                      `(e.g. "Monaco owns its own DOM lifecycle").`,
                  )
                } else {
                  const v = reasonProp.initializer
                  if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) {
                    checkText(v.text, v)
                  } else if (ts.isTemplateExpression(v)) {
                    // Template with expressions → computed
                    report(
                      v,
                      `subApp()'s \`reason\` must be a string literal so reviewers can grep for it. ` +
                        `A computed string defeats the audit-trail purpose.`,
                    )
                  } else if (ts.isIdentifier(v)) {
                    const resolved = resolveLocalStringConst(sf, v.text)
                    if (resolved !== null) {
                      checkText(resolved, v)
                    } else {
                      report(
                        v,
                        `subApp()'s \`reason\` must be a string literal so reviewers can grep for it. ` +
                          `A computed string defeats the audit-trail purpose.`,
                      )
                    }
                  } else {
                    report(
                      v,
                      `subApp()'s \`reason\` must be a string literal so reviewers can grep for it. ` +
                        `A computed string defeats the audit-trail purpose.`,
                    )
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
