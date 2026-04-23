import { AST_NODE_TYPES } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

export const eachClosureViolationRule = createRule({
  name: 'each-closure-violation',
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow capturing variables from parent scope inside each() render callback.',
    },
    schema: [],
    messages: {
      capture:
        "Identifier '{{name}}' captured from parent scope inside each() render callback. Use the item accessor instead.",
    },
  },
  defaultOptions: [],
  create(context) {
    const jsGlobals = new Set([
      'console',
      'Math',
      'JSON',
      'String',
      'Number',
      'Boolean',
      'Array',
      'Object',
      'Date',
      'Promise',
      'undefined',
      'null',
      'true',
      'false',
      'NaN',
      'Infinity',
      'document',
      'window',
      'globalThis',
      'parseInt',
      'parseFloat',
      'isNaN',
      'isFinite',
      'Error',
      'TypeError',
      'RangeError',
      'Set',
      'Map',
      'WeakSet',
      'WeakMap',
      'Symbol',
      'Reflect',
      'Proxy',
    ])
    const lluiSafeNames = new Set(['send'])

    return {
      CallExpression(node) {
        if (node.callee.type !== AST_NODE_TYPES.Identifier || node.callee.name !== 'each') {
          return
        }

        const arg = node.arguments[0]
        if (!arg || arg.type !== AST_NODE_TYPES.ObjectExpression) return

        for (const prop of arg.properties) {
          if (
            prop.type === AST_NODE_TYPES.Property &&
            prop.key.type === AST_NODE_TYPES.Identifier &&
            prop.key.name === 'render'
          ) {
            const renderFn = prop.value
            if (
              renderFn.type === AST_NODE_TYPES.ArrowFunctionExpression ||
              renderFn.type === AST_NODE_TYPES.FunctionExpression
            ) {
              const scope = context.sourceCode.getScope(renderFn)

              // Check all references in the function body scope (and child scopes)
              function checkReferences(s: any) {
                for (const ref of s.references) {
                  const id = ref.identifier
                  const name = id.name

                  // Skip globals and LLui safe names
                  if (jsGlobals.has(name) || lluiSafeNames.has(name)) continue

                  // If resolved to a variable, check where it was declared
                  if (ref.resolved) {
                    const declScope = ref.resolved.scope
                    // If the variable was declared in the module or global scope, it's safe to capture
                    if (declScope.type === 'module' || declScope.type === 'global') {
                      continue
                    }

                    // If the variable was declared INSIDE the renderFn (or its children), it's safe
                    let currentScope = declScope
                    let declaredInsideRender = false
                    while (currentScope) {
                      if (currentScope === scope) {
                        declaredInsideRender = true
                        break
                      }
                      currentScope = currentScope.upper
                    }
                    if (declaredInsideRender) continue
                  }

                  // It's a capture! Check if it's in a binding context
                  let current: any = id.parent
                  let inBinding = false

                  while (current && current !== renderFn) {
                    if (current.type === AST_NODE_TYPES.ArrowFunctionExpression) {
                      const parent = current.parent
                      if (
                        parent &&
                        parent.type === AST_NODE_TYPES.CallExpression &&
                        parent.callee.type === AST_NODE_TYPES.Identifier &&
                        parent.callee.name === 'text' &&
                        parent.arguments[0] === current
                      ) {
                        inBinding = true
                        break
                      }
                      if (parent && parent.type === AST_NODE_TYPES.Property) {
                        const propName =
                          parent.key.type === AST_NODE_TYPES.Identifier
                            ? parent.key.name
                            : parent.key.type === AST_NODE_TYPES.Literal
                              ? parent.key.value
                              : null
                        const structural = [
                          'render',
                          'items',
                          'key',
                          'init',
                          'update',
                          'view',
                          'onMsg',
                          'onSuccess',
                          'onError',
                          'on',
                          'when',
                          'cases',
                          'fallback',
                          'props',
                        ]
                        if (propName && !structural.includes(String(propName))) {
                          inBinding = true
                          break
                        }
                      }
                    }
                    current = current.parent
                  }

                  if (inBinding) {
                    context.report({
                      node: id,
                      messageId: 'capture',
                      data: { name },
                    })
                  }
                }

                for (const child of s.childScopes) {
                  checkReferences(child)
                }
              }

              checkReferences(scope)
            }
          }
        }
      },
    }
  },
})
