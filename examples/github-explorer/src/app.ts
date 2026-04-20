/**
 * Shared app definition — used by both client and server entry points.
 */
import { component } from '@llui/dom'
import { handleEffects } from '@llui/effects'
import type { State, Msg, Effect } from './types'
import { agentConnect, agentConfirm, agentLog } from './types'
import type { AgentClient } from '@llui/agent/client'
import { update } from './update'
import { router, routing } from './router'
import { header } from './views/header'
import { searchView } from './views/search'
import { repoPage } from './views/repo'
import { agentPanel } from './views/agent-panel'

// ── Late-bound agent client reference ────────────────────────────────────────
// The client is created after mountApp/hydrateApp (in main.ts, browser only).
// Agent effects can only fire after user interaction, by which time the client
// is already bound.
let agentClient: AgentClient | null = null

export function setAgentClient(client: AgentClient): void {
  agentClient = client
}

// ── Agent effect type guard ───────────────────────────────────────────────────
function isAgentEffect(e: Effect): boolean {
  return (e as { type: string }).type.startsWith('Agent')
}

export const appDef = component<State, Msg, Effect>({
  name: 'GitHubExplorer',
  init: () => {
    const state = initialState()
    const [s, effects] = update(state, { type: 'navigate', route: state.route })
    return [s, effects]
  },
  update,
  view: (h) => {
    const { send, branch } = h
    return [
      header(send),
      agentPanel(send),

      ...routing.listener(send),

      ...branch({
        on: (s) => s.route.page,
        cases: {
          search: ({ send }) => searchView(send),
          // routing.link needs literal owner/name for href. Read from
          // location.pathname which is current when the branch re-enters
          // (routing.handleEffect pushes state before navigate resolves).
          repo: ({ send }) => repoPage(h, router.match(location.pathname), send),
          tree: ({ send }) => repoPage(h, router.match(location.pathname), send),
        },
      }),
    ]
  },
  onEffect: handleEffects<Effect, Msg>()
    .use(routing.handleEffect)
    .else(({ effect }) => {
      if (isAgentEffect(effect)) {
        if (agentClient) {
          void agentClient.effectHandler(effect as Parameters<typeof agentClient.effectHandler>[0])
        }
        return
      }
      console.warn('[github-explorer] unhandled effect:', effect)
    }),
})

export function initialState(url?: string): State {
  const input = url ?? (typeof location !== 'undefined' ? location.pathname + location.search : '/')
  const route = router.match(input)
  return {
    route,
    query: route.page === 'search' ? route.q : '',
    agent: {
      connect: agentConnect.init({ mintUrl: '/agent/mint' })[0],
      confirm: agentConfirm.init()[0],
      log: agentLog.init()[0],
    },
  }
}
