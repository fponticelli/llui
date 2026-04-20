import type { MessageAnnotations } from '../../protocol.js'

type Binding = { variant: string }
type Annotations = Record<string, MessageAnnotations>

export type ListActionsHost = {
  getState(): unknown
  getBindingDescriptors(): Binding[] | null
  getMsgAnnotations(): Annotations | null
  getAgentAffordances(): ((state: unknown) => Array<{ type: string; [k: string]: unknown }>) | null
}

export type ListActionsResult = {
  actions: Array<{
    variant: string
    intent: string
    requiresConfirm: boolean
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

  // From bindings
  for (const d of descriptors) {
    const ann = annotations[d.variant]
    if (ann?.humanOnly) continue
    out.push({
      variant: d.variant,
      intent: ann?.intent ?? d.variant,
      requiresConfirm: ann?.requiresConfirm ?? false,
      source: 'binding',
      selectorHint: null,
      payloadHint: null,
    })
  }

  // From always-affordable
  for (const msg of affordances) {
    const ann = annotations[msg.type]
    if (ann?.humanOnly) continue
    const { type, ...rest } = msg
    out.push({
      variant: type,
      intent: ann?.intent ?? type,
      requiresConfirm: ann?.requiresConfirm ?? false,
      source: 'always-affordable',
      selectorHint: null,
      payloadHint: Object.keys(rest).length > 0 ? rest : null,
    })
  }

  return { actions: out }
}
