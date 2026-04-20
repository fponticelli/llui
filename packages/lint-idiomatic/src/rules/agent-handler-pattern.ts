import ts from 'typescript'
import type { LintViolation } from '../index.js'

/**
 * Rule: agent-nonextractable-handler
 *
 * Flags send() call sites in component views whose first argument is NOT
 * an object literal with a string-literal `type` field. These won't be
 * registered in __bindingDescriptors, so Claude's list_actions won't
 * advertise them.
 *
 * Mirrors the successful-match logic of
 * @llui/vite-plugin/src/binding-descriptors.ts collectSendCalls, but
 * emits diagnostics for the FAILING cases instead.
 *
 * Only flags calls where the callee is the identifier `send` (or any
 * single-identifier callee that produces a non-extractable dispatch),
 * limiting noise from unrelated helper calls like text(), div(), etc.
 */
export function checkAgentHandlerPattern(
  sf: ts.SourceFile,
  filename: string,
  violations: LintViolation[],
): void {
  function visitTopLevel(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (ts.isIdentifier(callee) && callee.text === 'component' && node.arguments.length > 0) {
        const firstArg = node.arguments[0]
        if (firstArg && ts.isObjectLiteralExpression(firstArg)) {
          visitComponentConfig(firstArg)
        }
      }
    }
    ts.forEachChild(node, visitTopLevel)
  }

  function visitComponentConfig(config: ts.ObjectLiteralExpression): void {
    for (const prop of config.properties) {
      if (!ts.isPropertyAssignment(prop)) continue
      if (!prop.name || !ts.isIdentifier(prop.name) || prop.name.text !== 'view') continue
      const viewExpr = prop.initializer
      if (!ts.isArrowFunction(viewExpr) && !ts.isFunctionExpression(viewExpr)) continue
      collectNonExtractableSendCalls(viewExpr.body)
    }
  }

  /**
   * Walk any node and flag send() call sites that aren't statically
   * extractable. We walk ALL nested nodes (including inside branch/each
   * callbacks) so nested sends are also caught.
   */
  function collectNonExtractableSendCalls(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      // Only flag calls to identifiers named `send` — other identifier
      // calls (text, div, each, etc.) are structural, not message dispatches.
      if (callee && ts.isIdentifier(callee) && callee.text === 'send') {
        const first = node.arguments[0]
        if (first === undefined || !ts.isObjectLiteralExpression(first)) {
          // send() with no args, or send(nonObjectArg) — not extractable
          const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
          violations.push(makeDiagnostic(filename, line + 1, character + 1))
        } else {
          // first IS an object literal — check for string-literal type field
          const variant = readTypeLiteral(first)
          if (variant === null) {
            // type field absent or not a string literal — not extractable
            const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
            violations.push(makeDiagnostic(filename, line + 1, character + 1))
          }
          // else: variant is a string literal — extractable, no diagnostic
        }
      }
    }
    ts.forEachChild(node, collectNonExtractableSendCalls)
  }

  function readTypeLiteral(obj: ts.ObjectLiteralExpression): string | null {
    for (const prop of obj.properties) {
      if (!ts.isPropertyAssignment(prop)) continue
      if (!prop.name) continue
      const nameOk =
        (ts.isIdentifier(prop.name) && prop.name.text === 'type') ||
        (ts.isStringLiteral(prop.name) && prop.name.text === 'type')
      if (!nameOk) continue
      const init = prop.initializer
      if (ts.isStringLiteral(init)) return init.text
      if (ts.isNoSubstitutionTemplateLiteral(init)) return init.text
      // Non-literal type value (e.g. dynamic variable) — not extractable
      return null
    }
    // No type field found — not extractable
    return null
  }

  function makeDiagnostic(file: string, line: number, column: number): LintViolation {
    return {
      rule: 'agent-nonextractable-handler',
      message: `send() call in view isn't statically extractable; Claude's list_actions won't advertise this action. Prefer send({type: 'literal'}).`,
      file,
      line,
      column,
    }
  }

  ts.forEachChild(sf, visitTopLevel)
}
