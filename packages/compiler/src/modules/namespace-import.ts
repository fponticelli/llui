// `namespace-import` — errors on `import * as L from '@llui/*'` for any
// LLui package whose surface is reactive-aware or modular. The compiler
// walks files looking for *named* references to helpers; namespace
// imports route through `L.div(...)` which the matcher doesn't see,
// silently disabling compile optimizations. Also defeats tree-shaking.
// Migrated from `@llui/eslint-plugin/src/rules/namespace-import.ts`.
// Autofix dropped per the migration plan; the error message includes
// the exact named-import replacement enumerating used members.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'

const TARGETS = new Set([
  '@llui/dom',
  '@llui/components',
  '@llui/router',
  '@llui/transitions',
  '@llui/effects',
  '@llui/agent',
])

export function namespaceImportModule(): CompilerModule {
  return {
    name: 'namespace-import',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/namespace-import',
        description:
          'Namespace import from @llui/* disables compiler opts and defeats tree-shaking.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        for (const stmt of sf.statements) {
          if (!ts.isImportDeclaration(stmt)) continue
          if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue
          const src = stmt.moduleSpecifier.text
          if (!TARGETS.has(src)) continue
          const clause = stmt.importClause
          if (!clause || !clause.namedBindings) continue
          if (!ts.isNamespaceImport(clause.namedBindings)) continue
          const localName = clause.namedBindings.name.text
          // Collect referenced members: `local.member` accesses.
          const usedMembers = new Set<string>()
          const collect = (n: ts.Node): void => {
            if (
              ts.isPropertyAccessExpression(n) &&
              ts.isIdentifier(n.expression) &&
              n.expression.text === localName &&
              ts.isIdentifier(n.name)
            ) {
              usedMembers.add(n.name.text)
            }
            ts.forEachChild(n, collect)
          }
          collect(sf)
          const sortedMembers = [...usedMembers].sort()
          const fix =
            sortedMembers.length > 0
              ? `Fix: replace with \`import { ${sortedMembers.join(', ')} } from '${src}'\` and rewrite each \`${localName}.X\` to bare \`X\`.`
              : `Fix: replace with named imports listing exactly the helpers you use from '${src}'.`
          ctx.reportDiagnostic({
            id: 'llui/namespace-import',
            severity: 'error',
            category: 'style',
            message:
              `Namespace import \`${localName}\` from '${src}' disables compiler optimizations ` +
              `(template-clone + elSplit rewriting recognize *named* call sites only) and defeats ` +
              `tree-shaking on broad-surface packages. ${fix}`,
            location: {
              file: sf.fileName,
              range: rangeFromOffsets(sf.text, stmt.getStart(sf), stmt.getEnd()),
            },
          })
        }
      },
    },
  }
}
