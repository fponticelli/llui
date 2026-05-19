// `no-eager-item-accessor` — errors when an each() `item.<prop>()` is
// invoked eagerly inside `text(...)` / `unsafeHtml(...)`. The
// ItemAccessor returns a `() => V`; passing the call result captures
// a static value, so the cell never updates when the row data
// changes in place. Pass the accessor itself instead (drop the `()`).
// Migrated from `@llui/eslint-plugin/src/rules/no-eager-item-accessor.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'

const EAGER_TARGETS = new Set(['text', 'unsafeHtml'])

/** True when `node` is `item.<prop>()` — bare `item` identifier root. */
function isItemMemberCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false
  if (!ts.isPropertyAccessExpression(node.expression)) return false
  const obj = node.expression.expression
  return ts.isIdentifier(obj) && obj.text === 'item'
}

export function noEagerItemAccessorModule(): CompilerModule {
  return {
    name: 'no-eager-item-accessor',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/no-eager-item-accessor',
        description:
          'Eager call of an ItemAccessor (`text(item.x())`) captures a static value — drop the `()` to pass the accessor.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        const walk = (n: ts.Node): void => {
          if (ts.isCallExpression(n)) {
            // Bare `text(...)` or member-form `h.text(...)`.
            let calleeName: string | undefined
            if (ts.isIdentifier(n.expression) && EAGER_TARGETS.has(n.expression.text)) {
              calleeName = n.expression.text
            } else if (
              ts.isPropertyAccessExpression(n.expression) &&
              ts.isIdentifier(n.expression.name) &&
              EAGER_TARGETS.has(n.expression.name.text)
            ) {
              calleeName = n.expression.name.text
            }
            if (calleeName) {
              const arg = n.arguments[0]
              if (arg && isItemMemberCall(arg)) {
                const memberArg = arg
                const member = memberArg.expression as ts.PropertyAccessExpression
                const propText = ts.isIdentifier(member.name)
                  ? `item.${member.name.text}`
                  : 'item.<prop>'
                ctx.reportDiagnostic({
                  id: 'llui/no-eager-item-accessor',
                  severity: 'error',
                  category: 'reactivity',
                  message:
                    `\`${calleeName}(${propText}())\` reads the item value once at view-construction and never updates when the row data changes in place. ` +
                    `Drop the \`()\` to pass the accessor itself: \`${calleeName}(${propText})\`. The runtime detects the zero-arg form and re-reads on every commit.`,
                  location: {
                    file: sf.fileName,
                    range: rangeFromOffsets(sf.text, memberArg.getStart(sf), memberArg.getEnd()),
                  },
                })
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
