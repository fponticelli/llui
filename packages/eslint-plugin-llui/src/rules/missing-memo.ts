import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

const ELEMENT_HELPER_RECEIVERS = new Set([
  'a',
  'abbr',
  'article',
  'aside',
  'b',
  'blockquote',
  'br',
  'button',
  'canvas',
  'code',
  'dd',
  'details',
  'dialog',
  'div',
  'dl',
  'dt',
  'em',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'iframe',
  'img',
  'input',
  'kbd',
  'label',
  'legend',
  'li',
  'main',
  'mark',
  'menu',
  'meter',
  'nav',
  'ol',
  'optgroup',
  'option',
  'output',
  'p',
  'picture',
  'pre',
  'progress',
  'q',
  's',
  'samp',
  'section',
  'select',
  'small',
  'source',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'track',
  'u',
  'ul',
  'var',
  'video',
  'wbr',
])

export const missingMemoRule = createRule({
  name: 'missing-memo',
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Duplicate accessor arrow function used in multiple binding sites without memo(). Wrap in memo() to share computation.',
    },
    schema: [],
    messages: {
      missing:
        'Duplicate accessor arrow function used in multiple binding sites without memo(). Wrap in memo() to share computation.',
    },
  },
  defaultOptions: [],
  create(context) {
    let inViewFunction = false
    const sourceCode = context.sourceCode

    const arrowsByText = new Map<
      string,
      { node: TSESTree.ArrowFunctionExpression; inMemo: boolean }[]
    >()

    function isInMemoCall(node: TSESTree.Node): boolean {
      const parent = node.parent
      if (
        parent &&
        parent.type === AST_NODE_TYPES.CallExpression &&
        parent.callee.type === AST_NODE_TYPES.Identifier &&
        parent.callee.name === 'memo'
      ) {
        return true
      }
      return false
    }

    function isReactiveBinding(node: TSESTree.ArrowFunctionExpression): boolean {
      const parent = node.parent
      if (!parent) return false

      // Case 1: first arg to text()
      if (
        parent.type === AST_NODE_TYPES.CallExpression &&
        parent.callee.type === AST_NODE_TYPES.Identifier &&
        parent.callee.name === 'text' &&
        parent.arguments[0] === node
      ) {
        return true
      }

      // Case 2: property in an object literal passed to an element helper
      if (parent.type === AST_NODE_TYPES.Property) {
        const objectLit = parent.parent
        if (!objectLit || objectLit.type !== AST_NODE_TYPES.ObjectExpression) return false
        const call = objectLit.parent
        if (!call || call.type !== AST_NODE_TYPES.CallExpression) return false
        if (call.callee.type !== AST_NODE_TYPES.Identifier) return false
        return ELEMENT_HELPER_RECEIVERS.has(call.callee.name)
      }

      return false
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

      ArrowFunctionExpression(node) {
        if (!inViewFunction) return
        if (node.params.length === 0) return

        if (isReactiveBinding(node)) {
          const sourceText = sourceCode.getText(node).replace(/\s+/g, ' ').trim()
          const inMemo = isInMemoCall(node)
          const entries = arrowsByText.get(sourceText) ?? []
          entries.push({ node, inMemo })
          arrowsByText.set(sourceText, entries)
        }
      },

      'Program:exit'() {
        for (const [_, entries] of arrowsByText) {
          if (entries.length < 2) continue
          const unmemoized = entries.filter((e) => !e.inMemo)
          if (unmemoized.length < 2) continue

          for (let i = 1; i < unmemoized.length; i++) {
            const entry = unmemoized[i]!
            context.report({
              node: entry.node,
              messageId: 'missing',
            })
          }
        }
      },
    }
  },
})
