// Runtime-agnostic shared types.
//
// The legacy (non-signal) runtime types that used to live here —
// ComponentDef, View, Lifetime, Binding, the structural-primitive option
// bags, etc. — were removed in the signal-runtime migration. The signal
// surface declares its own types in `signals/types.js`. Only the two
// genuinely runtime-agnostic shapes that the signal layer + transition
// helpers reference survive here.

/**
 * Lifetime-tree node for the debug/agent surface. A serialized snapshot
 * of the live scope tree — the signal devtools surface and MCP tools
 * read this shape to render scope lifecycle.
 */
export interface LifetimeNode {
  scopeId: string
  kind: 'root' | 'show' | 'each' | 'branch' | 'scope' | 'child' | 'portal' | 'foreign'
  active: boolean
  children: LifetimeNode[]
}

/**
 * Enter/leave/cross transition hooks shared by the animation/transition
 * helpers (`@llui/transitions`) and the structural primitives that
 * accept them. Runtime-agnostic — operates on raw DOM `Node`s.
 */
export interface TransitionOptions {
  enter?: (nodes: Node[]) => void | Promise<void>
  leave?: (nodes: Node[]) => void | Promise<void>
  onTransition?: (ctx: { entering: Node[]; leaving: Node[]; parent: Node }) => void | Promise<void>
}
