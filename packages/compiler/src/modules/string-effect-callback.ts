// `string-effect-callback` — errors when an effect callback property
// (onSuccess, onError, onLoad, onChange, onMessage) is assigned a
// bare string. The deprecated string shape silently drops typing;
// the typed shape is `propName: (data) => ({ type: 'msgType', payload: data })`.
// Migrated from `@llui/eslint-plugin/src/rules/string-effect-callback.ts`.

import ts from 'typescript'
import { rangeFromOffsets } from '../diagnostic.js'
import type { CompilerModule } from '../module.js'

const CALLBACK_PROPS = new Set(['onSuccess', 'onError', 'onLoad', 'onChange', 'onMessage'])

export function stringEffectCallbackModule(): CompilerModule {
  return {
    name: 'string-effect-callback',
    compilerVersion: '^0.3.0',
    diagnostics: [
      {
        id: 'llui/string-effect-callback',
        description:
          'String-based effect callback is deprecated — use a typed message constructor.',
      },
    ],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx, node) => {
        const visited = node as ts.SourceFile
        const sf = ts.createSourceFile(visited.fileName, visited.text, ts.ScriptTarget.Latest, true)
        const walk = (n: ts.Node): void => {
          if (
            ts.isPropertyAssignment(n) &&
            ts.isIdentifier(n.name) &&
            CALLBACK_PROPS.has(n.name.text) &&
            ts.isStringLiteral(n.initializer)
          ) {
            const propName = n.name.text
            const msgType = n.initializer.text
            ctx.reportDiagnostic({
              id: 'llui/string-effect-callback',
              severity: 'error',
              category: 'agent',
              message:
                `String-based effect callback \`${propName}: '${msgType}'\` is deprecated. ` +
                `Use a typed message constructor: ` +
                `\`${propName}: (data) => ({ type: '${msgType}', payload: data })\`.`,
              location: {
                file: sf.fileName,
                range: rangeFromOffsets(sf.text, n.getStart(sf), n.getEnd()),
              },
            })
          }
          ts.forEachChild(n, walk)
        }
        walk(sf)
      },
    },
  }
}
