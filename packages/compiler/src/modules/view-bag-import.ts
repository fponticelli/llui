// `view-bag-import` — errors when a file that defines a component
// imports view-bag primitives (text, each, show, branch, memo,
// selector) directly from @llui/dom. The view bag (`view: ({ text,
// each, … }) => …`) is typed to the component's State; the direct
// import is generic. Migrated from
// `@llui/eslint-plugin/src/rules/view-bag-import.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'
import { findComponentCalls } from './_shared.js'

const VIEW_BAG_NAMES = new Set(['text', 'each', 'show', 'branch', 'memo', 'selector'])

export function viewBagImportModule(): CompilerModule {
  return {
    name: 'view-bag-import',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/view-bag-import',
        description:
          'View bag primitive imported from @llui/dom in a file that defines a component — use the view bag instead.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        const componentCalls = findComponentCalls(sf)
        if (componentCalls.length === 0) return
        // At least one component() must have a `view:` property for the
        // rule to be meaningful (matches the ESLint rule's semantics).
        let definesView = false
        for (const call of componentCalls) {
          const arg = call.arguments[0]
          if (!arg || !ts.isObjectLiteralExpression(arg)) continue
          for (const prop of arg.properties) {
            if (
              ts.isPropertyAssignment(prop) &&
              ts.isIdentifier(prop.name) &&
              prop.name.text === 'view'
            ) {
              definesView = true
              break
            }
          }
          if (definesView) break
        }
        if (!definesView) return
        for (const stmt of sf.statements) {
          if (!ts.isImportDeclaration(stmt)) continue
          if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue
          if (stmt.moduleSpecifier.text !== '@llui/dom') continue
          const clause = stmt.importClause
          if (!clause || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue
          for (const spec of clause.namedBindings.elements) {
            const importedName = (spec.propertyName ?? spec.name).text
            if (VIEW_BAG_NAMES.has(importedName)) {
              ctx.reportDiagnostic({
                id: 'llui/view-bag-import',
                severity: 'error',
                category: 'style',
                message:
                  `Don't import \`${importedName}\` from '@llui/dom' in a file that defines a ` +
                  `component. Use the view bag: \`view: ({ ${importedName}, … }) => [...]\`. ` +
                  `The view-bag version is typed to your component's State.`,
                location: {
                  file: sf.fileName,
                  range: rangeFromOffsets(sf.text, spec.getStart(sf), spec.getEnd()),
                },
              })
            }
          }
        }
      },
    },
  }
}
