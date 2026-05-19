// `accessibility` — two a11y nudges:
//   - `<img>` without `alt` → screen readers read filename
//   - `onClick` on a non-interactive element without `role` → keyboard
//     users can't reach it
// Migrated from `@llui/eslint-plugin/src/rules/accessibility.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'
import { ELEMENT_HELPERS, INTERACTIVE_ELEMENTS } from './_element-helpers.js'

function staticPropKeys(obj: ts.ObjectLiteralExpression): Set<string> {
  const out = new Set<string>()
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p)) {
      if (ts.isIdentifier(p.name)) out.add(p.name.text)
      else if (ts.isStringLiteral(p.name)) out.add(p.name.text)
    } else if (ts.isShorthandPropertyAssignment(p)) {
      out.add(p.name.text)
    }
  }
  return out
}

export function accessibilityModule(): CompilerModule {
  return {
    name: 'accessibility',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/accessibility',
        description: 'Missing alt on <img>, or onClick on non-interactive element without role.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        const walk = (n: ts.Node): void => {
          if (
            ts.isCallExpression(n) &&
            ts.isIdentifier(n.expression) &&
            ELEMENT_HELPERS.has(n.expression.text)
          ) {
            const tag = n.expression.text
            const props = n.arguments[0]
            if (props && ts.isObjectLiteralExpression(props)) {
              const keys = staticPropKeys(props)
              if (tag === 'img' && !keys.has('alt')) {
                ctx.reportDiagnostic({
                  id: 'llui/accessibility',
                  severity: 'error',
                  category: 'style',
                  message:
                    `<img> has no \`alt\` attribute. Add alt text for screen readers, or ` +
                    `\`alt: ''\` for decorative images.`,
                  location: {
                    file: sf.fileName,
                    range: rangeFromOffsets(sf.text, n.getStart(sf), n.getEnd()),
                  },
                })
              }
              if (keys.has('onClick') && !INTERACTIVE_ELEMENTS.has(tag) && !keys.has('role')) {
                ctx.reportDiagnostic({
                  id: 'llui/accessibility',
                  severity: 'error',
                  category: 'style',
                  message:
                    `onClick on <${tag}> without \`role\`. Non-interactive elements with click ` +
                    `handlers are not keyboard-accessible. Add \`role: 'button', tabIndex: 0\`, ` +
                    `or use <button>.`,
                  location: {
                    file: sf.fileName,
                    range: rangeFromOffsets(sf.text, n.getStart(sf), n.getEnd()),
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
