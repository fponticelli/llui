import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

/**
 * Verifies that every variant of a local `Msg` union is handled by
 * `update()`'s top-level switch. Catches the common stale-update bug:
 * author adds a new Msg variant, dispatches it from a new view branch,
 * but forgets to wire a corresponding `case` — the new message lands
 * in update() and silently no-ops.
 *
 * Limitations: only inspects `type Msg = ...` declared in the same
 * file (mirroring the original Vite diagnostic). A `default:` clause
 * silences the rule on the assumption the author has explicit
 * fall-through handling.
 *
 * Migrated from the Vite plugin's `exhaustive-update` diagnostic.
 */

function collectMsgVariants(program: TSESTree.Program): Set<string> {
  const out = new Set<string>()

  function fromTypeNode(node: TSESTree.TypeNode): void {
    if (node.type === AST_NODE_TYPES.TSUnionType) {
      for (const m of node.types) fromTypeNode(m)
      return
    }
    if (node.type !== AST_NODE_TYPES.TSTypeLiteral) return
    for (const m of node.members) {
      if (m.type !== AST_NODE_TYPES.TSPropertySignature) continue
      if (!m.key || m.key.type !== AST_NODE_TYPES.Identifier) continue
      if (m.key.name !== 'type') continue
      const t = m.typeAnnotation?.typeAnnotation
      if (!t || t.type !== AST_NODE_TYPES.TSLiteralType) continue
      const lit = t.literal
      if (lit.type === AST_NODE_TYPES.Literal && typeof lit.value === 'string') {
        out.add(lit.value)
      }
    }
  }

  for (const stmt of program.body) {
    if (stmt.type === AST_NODE_TYPES.TSTypeAliasDeclaration && stmt.id.name === 'Msg') {
      fromTypeNode(stmt.typeAnnotation)
      continue
    }
    if (stmt.type === AST_NODE_TYPES.ExportNamedDeclaration && stmt.declaration) {
      const d = stmt.declaration
      if (d.type === AST_NODE_TYPES.TSTypeAliasDeclaration && d.id.name === 'Msg') {
        fromTypeNode(d.typeAnnotation)
      }
    }
  }
  return out
}

function findUpdateSwitch(
  fn: TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression,
): TSESTree.SwitchStatement | null {
  if (fn.body.type !== AST_NODE_TYPES.BlockStatement) return null
  let found: TSESTree.SwitchStatement | null = null
  const visit = (n: TSESTree.Node | null | undefined): void => {
    if (!n || found) return
    if (n.type === AST_NODE_TYPES.SwitchStatement) {
      found = n
      return
    }
    for (const key of Object.keys(n) as (keyof typeof n)[]) {
      if (key === 'parent' || key === 'loc' || key === 'range') continue
      const child = n[key] as unknown
      if (Array.isArray(child)) {
        for (const c of child) {
          if (c && typeof c === 'object' && 'type' in c) visit(c as TSESTree.Node)
        }
      } else if (child && typeof child === 'object' && 'type' in (child as object)) {
        visit(child as TSESTree.Node)
      }
    }
  }
  visit(fn.body)
  return found
}

export const exhaustiveUpdateRule = createRule({
  name: 'exhaustive-update',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Verify that update()’s switch handles every variant of the local `Msg` union — silent no-ops on missing cases are a stale-reducer bug.',
    },
    schema: [],
    messages: {
      missing:
        "update() does not handle message type{{plural}} {{names}}.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      Program(program) {
        const variants = collectMsgVariants(program)
        if (variants.size === 0) return

        // Find every property named `update` whose value is a function
        // — `update: (s, m) => { switch (m.type) { ... } }`.
        const visit = (n: TSESTree.Node | null | undefined) => {
          if (!n) return
          if (
            n.type === AST_NODE_TYPES.Property &&
            n.key.type === AST_NODE_TYPES.Identifier &&
            n.key.name === 'update' &&
            (n.value.type === AST_NODE_TYPES.ArrowFunctionExpression ||
              n.value.type === AST_NODE_TYPES.FunctionExpression)
          ) {
            const sw = findUpdateSwitch(n.value)
            if (sw) {
              const handled = new Set<string>()
              let hasDefault = false
              for (const c of sw.cases) {
                if (!c.test) {
                  hasDefault = true
                  continue
                }
                if (c.test.type === AST_NODE_TYPES.Literal && typeof c.test.value === 'string') {
                  handled.add(c.test.value)
                }
              }
              if (!hasDefault) {
                const missing = [...variants].filter((v) => !handled.has(v))
                if (missing.length > 0) {
                  context.report({
                    node: n,
                    messageId: 'missing',
                    data: {
                      plural: missing.length > 1 ? 's' : '',
                      names: missing.map((m) => `'${m}'`).join(', '),
                    },
                  })
                }
              }
            }
          }
          for (const key of Object.keys(n) as (keyof typeof n)[]) {
            if (key === 'parent' || key === 'loc' || key === 'range') continue
            const child = n[key] as unknown
            if (Array.isArray(child)) {
              for (const c of child) {
                if (c && typeof c === 'object' && 'type' in c) visit(c as TSESTree.Node)
              }
            } else if (child && typeof child === 'object' && 'type' in (child as object)) {
              visit(child as TSESTree.Node)
            }
          }
        }
        visit(program)
      },
    }
  },
})
