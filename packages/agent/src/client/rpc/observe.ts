import type { AgentContext, LapActionsResponse } from '../../protocol.js'
import { handleListActions, type ListActionsHost } from './list-actions.js'

export type ObserveHost = ListActionsHost & {
  getAgentContext(): ((state: unknown) => AgentContext) | null
}

/**
 * Dynamic slice of the unified `observe` response. The server-side LAP
 * endpoint composes this with the static description (name/version/
 * messages/docs from the cached hello frame) to produce the full
 * `LapObserveResponse`. Keeping the split here means a single WS
 * round-trip captures everything that changes with state, while the
 * static metadata stays server-side where it's already cached.
 */
export type ObserveResult = {
  state: unknown
  actions: LapActionsResponse['actions']
  context: AgentContext | null
}

export function handleObserve(host: ObserveHost): ObserveResult {
  const state = host.getState()
  const actions = handleListActions(host).actions
  const contextFn = host.getAgentContext()
  const context = contextFn ? contextFn(state) : null
  return { state, actions, context }
}
