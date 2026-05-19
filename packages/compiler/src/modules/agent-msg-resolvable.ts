// `agent-msg-resolvable` — verifies the `Msg` type argument of every
// `component<S, M, E>()` call resolves to a type the compiler can
// statically reach: either a local `type M = …` declaration or a named
// import from another module.
//
// Catches the silent-failure case where M references something the
// resolver can't follow — a typo, a missing barrel re-export, a
// namespace import — which would silently disable agent metadata
// emission. Migrated from
// `@llui/eslint-plugin/src/rules/agent-msg-resolvable.ts`.
//
// File-local check: the compiler doesn't run a full cross-file resolver
// here (it's available in the broader transform pipeline but not
// threaded into this module). The file-local form catches:
//   - the M type arg isn't a plain identifier (generics, inline unions,
//     namespace-qualified names);
//   - the M identifier isn't declared locally and isn't named-imported
//     from any source;
//   - the M identifier comes from a namespace import (`import * as`).

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'

interface ImportInfo {
  /** Imported via `import { Name } from '...'` (named/value or type). */
  named: Set<string>
  /** Imported via `import Name from '...'` (default). */
  defaults: Set<string>
  /** Imported via `import * as Name from '...'`. */
  namespaces: Set<string>
}

function collectImports(sf: ts.SourceFile): ImportInfo {
  const info: ImportInfo = { named: new Set(), defaults: new Set(), namespaces: new Set() }
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue
    const clause = stmt.importClause
    if (!clause) continue
    if (clause.name) info.defaults.add(clause.name.text)
    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        info.namespaces.add(clause.namedBindings.name.text)
      } else {
        for (const el of clause.namedBindings.elements) {
          info.named.add(el.name.text)
        }
      }
    }
  }
  return info
}

function collectLocalTypeNames(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>()
  for (const stmt of sf.statements) {
    if (ts.isTypeAliasDeclaration(stmt)) out.add(stmt.name.text)
    else if (ts.isInterfaceDeclaration(stmt)) out.add(stmt.name.text)
    else if (ts.isClassDeclaration(stmt) && stmt.name) out.add(stmt.name.text)
  }
  return out
}

export function agentMsgResolvableModule(): CompilerModule {
  return {
    name: 'agent-msg-resolvable',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/agent-msg-resolvable',
        description: 'component<>() Msg type arg must be locally declared or named-imported.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        const imports = collectImports(sf)
        const locals = collectLocalTypeNames(sf)
        const walk = (n: ts.Node): void => {
          if (
            ts.isCallExpression(n) &&
            ts.isIdentifier(n.expression) &&
            n.expression.text === 'component' &&
            n.typeArguments &&
            n.typeArguments.length >= 2
          ) {
            const stateArg = n.typeArguments[0]!
            const msgArg = n.typeArguments[1]!
            const effectArg = n.typeArguments[2]
            const stateText = stateArg.getText(sf)
            const msgText = msgArg.getText(sf)
            const effectText = effectArg ? effectArg.getText(sf) : 'never'

            // Identifier-typed arg is the only resolvable shape.
            if (!ts.isTypeReferenceNode(msgArg) || !ts.isIdentifier(msgArg.typeName)) {
              ctx.reportDiagnostic({
                id: 'llui/agent-msg-resolvable',
                severity: 'error',
                category: 'agent',
                message:
                  `\`component<${stateText}, ${msgText}, ${effectText}>()\`: Msg type argument ` +
                  `is not a plain identifier. The LLui compiler can only chase identifier-typed ` +
                  `type arguments — generics like \`Msg<T>\`, namespace-qualified names like ` +
                  `\`m.Msg\`, or inline literal unions are not followed. Replace with a named ` +
                  `type alias declared in this file or named-imported from another.`,
                location: {
                  file: sf.fileName,
                  range: rangeFromOffsets(sf.text, msgArg.getStart(sf), msgArg.getEnd()),
                },
              })
              ts.forEachChild(n, walk)
              return
            }
            const msgName = msgArg.typeName.text
            if (locals.has(msgName)) {
              ts.forEachChild(n, walk)
              return
            }
            if (imports.namespaces.has(msgName)) {
              ctx.reportDiagnostic({
                id: 'llui/agent-msg-resolvable',
                severity: 'error',
                category: 'agent',
                message:
                  `\`component<${stateText}, ${msgName}, ${effectText}>()\`: Msg type "${msgName}" ` +
                  `comes from a namespace import (\`import * as ...\`). The cross-file resolver ` +
                  `does not follow namespace imports — replace with a named import: ` +
                  `\`import { ${msgName} } from "..."\`.`,
                location: {
                  file: sf.fileName,
                  range: rangeFromOffsets(sf.text, msgArg.getStart(sf), msgArg.getEnd()),
                },
              })
            } else if (!imports.named.has(msgName) && !imports.defaults.has(msgName)) {
              ctx.reportDiagnostic({
                id: 'llui/agent-msg-resolvable',
                severity: 'error',
                category: 'agent',
                message:
                  `\`component<${stateText}, ${msgName}, ${effectText}>()\`: Msg type "${msgName}" ` +
                  `is neither declared in this file nor imported with a named import. The plugin ` +
                  `will emit no annotations and LAP validation will silently disable. Either ` +
                  `declare \`type ${msgName} = ...\` here, import it with ` +
                  `\`import { ${msgName} } from "..."\`, or replace with an inline union.`,
                location: {
                  file: sf.fileName,
                  range: rangeFromOffsets(sf.text, msgArg.getStart(sf), msgArg.getEnd()),
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
