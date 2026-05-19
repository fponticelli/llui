// `agent-emits-drift` — verifies `@emits("k1", "k2")` declarations on
// Msg variants match the effect kinds the corresponding case in
// update() actually emits.
//
// Two failure modes detected:
//   1. **Emitted but not declared** — a literal `{ kind: 'X' }` appears
//      in the case's effect array but 'X' isn't in @emits.
//   2. **Declared but not emitted** — a kind in @emits doesn't appear in
//      any literal effect (and the case has no opaque helper calls that
//      might emit it).
//
// File-local scope: Msg union and the update() switch must be in the
// same source file. Cross-file resolution would require type-checker
// integration. Migrated from
// `@llui/eslint-plugin/src/rules/agent-emits-drift.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'
import { forEachMsgVariant, forEachMsgVariantInExternalSource } from './_msg-variants.js'

interface CaseInfo {
  literalKinds: Set<string>
  hasOpaqueHelpers: boolean
}

function readEmits(commentText: string): string[] {
  const outer = commentText.match(/@emits\s*\(([^)]*)\)/)
  if (!outer || outer[1] === undefined) return []
  const inner = outer[1]
  const seen = new Set<string>()
  const out: string[] = []
  const re = /["“]([^"”]*)["”]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(inner)) !== null) {
    if (m[1] !== undefined && !seen.has(m[1])) {
      seen.add(m[1])
      out.push(m[1])
    }
  }
  return out
}

function walkCaseBody(body: ts.Node, info: CaseInfo): void {
  const walk = (n: ts.Node): void => {
    if (ts.isReturnStatement(n) && n.expression) {
      const arg = n.expression
      if (ts.isArrayLiteralExpression(arg) && arg.elements.length === 2) {
        const effects = arg.elements[1]
        if (effects && ts.isArrayLiteralExpression(effects)) {
          for (const el of effects.elements) {
            if (ts.isObjectLiteralExpression(el)) {
              for (const prop of el.properties) {
                if (
                  ts.isPropertyAssignment(prop) &&
                  ts.isIdentifier(prop.name) &&
                  prop.name.text === 'kind' &&
                  ts.isStringLiteral(prop.initializer)
                ) {
                  info.literalKinds.add(prop.initializer.text)
                }
              }
            } else if (ts.isCallExpression(el) || ts.isSpreadElement(el)) {
              info.hasOpaqueHelpers = true
            }
          }
        }
      }
    }
    ts.forEachChild(n, walk)
  }
  walk(body)
}

function indexSwitchCases(sf: ts.SourceFile, into: Map<string, CaseInfo>): void {
  const walk = (n: ts.Node): void => {
    if (ts.isSwitchStatement(n)) {
      const disc = n.expression
      const looksLikeMsgType =
        ts.isPropertyAccessExpression(disc) &&
        ts.isIdentifier(disc.name) &&
        disc.name.text === 'type'
      if (looksLikeMsgType) {
        for (const sc of n.caseBlock.clauses) {
          if (!ts.isCaseClause(sc)) continue
          if (!sc.expression || !ts.isStringLiteral(sc.expression)) continue
          const variant = sc.expression.text
          const info: CaseInfo = into.get(variant) ?? {
            literalKinds: new Set(),
            hasOpaqueHelpers: false,
          }
          for (const stmt of sc.statements) walkCaseBody(stmt, info)
          into.set(variant, info)
        }
      }
    }
    ts.forEachChild(n, walk)
  }
  walk(sf)
}

export function agentEmitsDriftModule(): CompilerModule {
  return {
    name: 'agent-emits-drift',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/agent-emits-drift',
        description:
          '@emits declaration on Msg variant drifts from actual effect emissions in update().',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        const caseInfoByVariant = new Map<string, CaseInfo>()
        indexSwitchCases(sf, caseInfoByVariant)
        if (caseInfoByVariant.size === 0) return

        // Driver that runs the drift-check on a single Msg variant.
        // Hoisted so we can call it for both file-local variants and
        // cross-file (imported) Msg variants without duplicating the
        // diff logic.
        const check = (
          variant: string,
          typeLit: ts.TypeLiteralNode,
          leadingCommentText: string,
          variantSf: ts.SourceFile,
        ): void => {
          const declared = readEmits(leadingCommentText)
          const caseInfo = caseInfoByVariant.get(variant)
          if (!caseInfo) return
          // Anchor diagnostics on the local file when the Msg variant
          // lives in the same file; on the external Msg file when it's
          // imported. Adapters that surface diagnostics by file
          // (vite-plugin's this.error) will route the error to the
          // right place.
          const anchorFile = variantSf.fileName
          const anchorText = variantSf.text
          // Drift 1: literal emissions not in @emits — always warn.
          for (const kind of caseInfo.literalKinds) {
            if (!declared.includes(kind)) {
              ctx.reportDiagnostic({
                id: 'llui/agent-emits-drift',
                severity: 'error',
                category: 'agent',
                message:
                  `Msg variant "${variant}" emits effect kind "${kind}" in update() but doesn't ` +
                  `declare it in @emits. Either add "${kind}" to the @emits list ` +
                  `(\`@emits("${kind}")\`), or remove the literal effect emission.`,
                location: {
                  file: anchorFile,
                  range: rangeFromOffsets(
                    anchorText,
                    typeLit.getStart(variantSf),
                    typeLit.getEnd(),
                  ),
                },
              })
            }
          }
          // Drift 2: @emits-declared but no literal emission in the case.
          // Skip when opaque helpers might be emitting the kind.
          if (!caseInfo.hasOpaqueHelpers) {
            for (const kind of declared) {
              if (!caseInfo.literalKinds.has(kind)) {
                ctx.reportDiagnostic({
                  id: 'llui/agent-emits-drift',
                  severity: 'error',
                  category: 'agent',
                  message:
                    `Msg variant "${variant}" declares @emits "${kind}" but no case in update() ` +
                    `emits it as a literal effect. Either remove "${kind}" from @emits, or add ` +
                    `the emission (\`return [state, [{ kind: '${kind}', … }]]\`).`,
                  location: {
                    file: anchorFile,
                    range: rangeFromOffsets(
                      anchorText,
                      typeLit.getStart(variantSf),
                      typeLit.getEnd(),
                    ),
                  },
                })
              }
            }
          }
        }

        // File-local Msg variants — the common case.
        forEachMsgVariant(sf, ({ variant, node: typeLit, leadingCommentText }) => {
          check(variant, typeLit, leadingCommentText, sf)
        })

        // Cross-file Msg: when `component<S, ImportedMsg, E>()` resolved
        // the M type arg to another file, the host adapter passes the
        // declaring source here. Iterate its variants too so @emits
        // drift surfaces against imported Msg unions.
        const externalMsg = ctx.externalTypes?.msg
        if (externalMsg) {
          forEachMsgVariantInExternalSource(
            externalMsg.source,
            // Synthetic filename — adapters that report by file get a
            // recognisable marker. The vite-plugin doesn't currently
            // map this back to the real on-disk path; future work.
            `<external:${externalMsg.typeName}>`,
            externalMsg.typeName,
            ({ variant, node: typeLit, leadingCommentText }) => {
              const externalSf = typeLit.getSourceFile()
              check(variant, typeLit, leadingCommentText, externalSf)
            },
          )
        }
      },
    },
  }
}
