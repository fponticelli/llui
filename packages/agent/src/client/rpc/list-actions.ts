import type { MessageAnnotations } from '../../protocol.js'

type Binding = { variant: string }
type Annotations = Record<string, MessageAnnotations>

export type ListActionsHost = {
  getState(): unknown
  getBindingDescriptors(): Binding[] | null
  getMsgAnnotations(): Annotations | null
  getAgentAffordances(): ((state: unknown) => Array<{ type: string; [k: string]: unknown }>) | null
}

/**
 * `dispatchMode` on each action is `'shared'` (human can also click via
 * a UI affordance) or `'agent-only'` (no UI binding — agent is the only
 * dispatcher). `'human-only'` variants are filtered out before this
 * point — they never reach the LLM.
 */
export type ListActionsResult = {
  actions: Array<{
    variant: string
    intent: string
    requiresConfirm: boolean
    dispatchMode: 'shared' | 'agent-only'
    source: 'binding' | 'always-affordable'
    selectorHint: string | null
    payloadHint: object | null
  }>
}

export function handleListActions(host: ListActionsHost): ListActionsResult {
  const annotations = host.getMsgAnnotations() ?? {}
  const state = host.getState()
  const descriptors = host.getBindingDescriptors() ?? []
  const affordances = host.getAgentAffordances()?.(state) ?? []

  const out: ListActionsResult['actions'] = []

  // From bindings — these have UI affordances by definition, so they're
  // either 'shared' (default) or, in the malformed case where someone
  // bound an `@agentOnly` Msg in a view, 'agent-only'. Either way the
  // agent can dispatch them.
  for (const d of descriptors) {
    const ann = annotations[d.variant]
    if (ann?.dispatchMode === 'human-only') continue
    out.push({
      variant: d.variant,
      intent: ann?.intent ?? d.variant,
      requiresConfirm: ann?.requiresConfirm ?? false,
      dispatchMode: ann?.dispatchMode === 'agent-only' ? 'agent-only' : 'shared',
      source: 'binding',
      selectorHint: null,
      payloadHint: null,
    })
  }

  // From always-affordable
  for (const msg of affordances) {
    const ann = annotations[msg.type]
    if (ann?.dispatchMode === 'human-only') continue
    const { type, ...rest } = msg
    out.push({
      variant: type,
      intent: ann?.intent ?? type,
      requiresConfirm: ann?.requiresConfirm ?? false,
      dispatchMode: ann?.dispatchMode === 'agent-only' ? 'agent-only' : 'shared',
      source: 'always-affordable',
      selectorHint: null,
      payloadHint: Object.keys(rest).length > 0 ? rest : null,
    })
  }

  return { actions: out }
}
