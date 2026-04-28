import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../createRule.js'

/**
 * Flags variable-length list rendering inside a `sample()` callback.
 *
 * `sample(selector)` is a one-shot imperative read at view-construction
 * time. The pattern that looks idiomatic but silently breaks:
 *
 *   sample((s) => s.list.items.length === 0
 *     ? [emptyState]
 *     : [table(s.list.items.map(rowFn))])
 *
 * The `.map()` runs once at construction, captures each row in
 * closure, and never re-runs when state updates in place. Cells
 * inside the captured rows show stale data; only a parent structural
 * rebuild (e.g. a `branch` swapping arms) refreshes them — which
 * makes the bug invisible to typecheck, tests, and casual smoke
 * testing.
 *
 * Heuristic: a `sample(<fn>)` callsite whose callback body contains a
 * `<expr>.map(...)` call where `<expr>` is a member expression read
 * (e.g. `s.list.items`). The narrow signal "iterating over a
 * state-derived array inside sample" catches the variable-length-list
 * antipattern without false-positiving on legitimate sample uses
 * (passing a state snapshot to an imperative renderer, computing a
 * static value).
 */

function isStateRootedMemberMap(node: TSESTree.Node): boolean {
  if (node.type !== AST_NODE_TYPES.CallExpression) return false
  if (node.callee.type !== AST_NODE_TYPES.MemberExpression) return false
  if (node.callee.property.type !== AST_NODE_TYPES.Identifier) return false
  if (node.callee.property.name !== 'map') return false
  // Walk leftward from the .map receiver — find the root identifier
  // and check whether it looks like a state read. We're conservative:
  // if the chain bottoms out at a known state-source identifier (s,
  // state, props, anything ending in State by convention), call it
  // state-rooted. Bare-array literals (`[1,2,3].map(...)`) and
  // call-results (`computeRows().map(...)`) don't fire.
  let cursor: TSESTree.Node = node.callee.object
  while (cursor.type === AST_NODE_TYPES.MemberExpression) {
    cursor = cursor.object
  }
  if (cursor.type !== AST_NODE_TYPES.Identifier) return false
  // Common parameter names for state-reading callbacks. A param named
  // `s`, `state`, or `props` (covering `Props<T, S>` accessors that
  // wrap state too) signals "this iterates state-derived data."
  return cursor.name === 's' || cursor.name === 'state' || cursor.name === 'props'
}

function bodyContainsStateMap(body: TSESTree.Node): boolean {
  let found = false
  const visit = (n: TSESTree.Node | null | undefined) => {
    if (!n || found) return
    if (isStateRootedMemberMap(n)) {
      found = true
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
  visit(body)
  return found
}

export const noListRenderInSampleRule = createRule({
  name: 'no-list-render-in-sample',
  meta: {
    type: 'problem',
    docs: {
      description:
        '`sample()` is a one-shot imperative read — wrapping a `.map()` over state-derived items in it captures the rows once and the rendered cells go stale on in-place updates. Use `each` + `ItemAccessor` for variable-length lists.',
    },
    schema: [],
    messages: {
      mapInSample:
        '`sample()` is a one-shot read — `.map()` over state-derived items inside it captures the rows at view-construction and the cells go stale when row data updates in place. Use `each({items: (s) => s.<list>, key, render})` and bind cells reactively via `text(item.field)` / `show({when: () => item.flag()})`. See the cookbook recipe "List of editable rows."',
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        // Match `sample(...)` and `h.sample(...)`.
        let isSample = false
        if (node.callee.type === AST_NODE_TYPES.Identifier && node.callee.name === 'sample') {
          isSample = true
        } else if (
          node.callee.type === AST_NODE_TYPES.MemberExpression &&
          node.callee.property.type === AST_NODE_TYPES.Identifier &&
          node.callee.property.name === 'sample'
        ) {
          isSample = true
        }
        if (!isSample) return

        const arg = node.arguments[0]
        if (
          !arg ||
          (arg.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
            arg.type !== AST_NODE_TYPES.FunctionExpression)
        ) {
          return
        }

        if (bodyContainsStateMap(arg.body)) {
          context.report({ node, messageId: 'mapInSample' })
        }
      },
    }
  },
})
