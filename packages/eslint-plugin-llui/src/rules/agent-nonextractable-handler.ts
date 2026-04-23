import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const hasAgentCache = new Map<string, boolean>()

function hasAgentDependency(filename: string): boolean {
  let dir = dirname(filename)
  while (dir !== '/' && dir !== '.') {
    if (hasAgentCache.has(dir)) {
      return hasAgentCache.get(dir)!
    }
    const pkgPath = join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
        const hasAgent =
          !!(pkg.dependencies && pkg.dependencies['@llui/agent']) ||
          !!(pkg.devDependencies && pkg.devDependencies['@llui/agent']) ||
          !!(pkg.peerDependencies && pkg.peerDependencies['@llui/agent'])
        hasAgentCache.set(dir, hasAgent)
        return hasAgent
      } catch {
        hasAgentCache.set(dir, false)
        return false
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return false
}

export const agentNonextractableHandlerRule = createRule({
  name: 'agent-nonextractable-handler',
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Flags send() call sites in component views whose first argument is NOT an object literal with a string-literal `type` field.',
    },
    schema: [],
    messages: {
      nonextractable:
        "send() call in view isn't statically extractable; Claude's list_actions won't advertise this action. Prefer send({type: 'literal'}).",
    },
  },
  defaultOptions: [],
  create(context) {
    const isTestEnv =
      context.filename === '<text>' ||
      context.filename === '<input>' ||
      context.filename.endsWith('file.ts') ||
      context.filename.endsWith('file.tsx') ||
      context.filename.endsWith('test.ts') ||
      context.filename.includes('.test.')

    if (!isTestEnv && !hasAgentDependency(context.filename)) {
      return {}
    }

    let inViewFunction = false

    function readTypeLiteral(obj: TSESTree.ObjectExpression): string | null {
      for (const prop of obj.properties) {
        if (prop.type !== AST_NODE_TYPES.Property) continue

        const isTypeKey =
          (prop.key.type === AST_NODE_TYPES.Identifier && prop.key.name === 'type') ||
          (prop.key.type === AST_NODE_TYPES.Literal && prop.key.value === 'type')

        if (!isTypeKey) continue

        if (prop.value.type === AST_NODE_TYPES.Literal && typeof prop.value.value === 'string') {
          return prop.value.value
        }
        if (prop.value.type === AST_NODE_TYPES.TemplateLiteral && prop.value.quasis.length === 1) {
          return prop.value.quasis[0]?.value.raw ?? null
        }
        return null
      }
      return null
    }

    return {
      Property(node) {
        if (node.key.type === AST_NODE_TYPES.Identifier && node.key.name === 'view') {
          inViewFunction = true
        }
      },
      'Property:exit'(node) {
        if (node.key.type === AST_NODE_TYPES.Identifier && node.key.name === 'view') {
          inViewFunction = false
        }
      },

      CallExpression(node) {
        if (!inViewFunction) return

        if (node.callee.type === AST_NODE_TYPES.Identifier && node.callee.name === 'send') {
          const first = node.arguments[0]

          if (!first || first.type !== AST_NODE_TYPES.ObjectExpression) {
            context.report({
              node,
              messageId: 'nonextractable',
            })
            return
          }

          const variant = readTypeLiteral(first)
          if (variant === null) {
            context.report({
              node,
              messageId: 'nonextractable',
            })
          }
        }
      },
    }
  },
})
