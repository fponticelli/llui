import { component, mountApp, div, button, text } from '@llui/dom'
import type { AgentDocs, AgentContext } from '@llui/agent/protocol'
import {
  createAgentClient,
  agentConnect,
  agentConfirm,
  agentLog,
  type AgentEffect,
  type AgentClient,
} from '@llui/agent/client'

// ── State / Msg types ─────────────────────────────────────────────────────────

type State = {
  count: number
  lastDelete: string | null
  agent: {
    connect: agentConnect.AgentConnectState
    confirm: agentConfirm.AgentConfirmState
    log: agentLog.AgentLogState
  }
}

type Msg =
  // ──────────────── annotated variants (exercised by e2e tests) ─────────────
  /** @intent("Increment the counter") */
  | { type: 'inc' }
  /** @intent("Decrement the counter") */
  | { type: 'dec' }
  /** @intent("Reset to zero") */
  | { type: 'reset' }
  /** @intent("Delete an item") @requiresConfirm */
  | { type: 'delete'; id: string }
  /** @intent("Sign out") @humanOnly */
  | { type: 'signOut' }
  /** @intent("Navigate") @alwaysAffordable */
  | { type: 'nav'; to: 'home' | 'reports' }
  // ──────────────── agent sub-component messages ────────────────────────────
  | { type: 'agent'; sub: 'connect'; msg: agentConnect.AgentConnectMsg }
  | { type: 'agent'; sub: 'confirm'; msg: agentConfirm.AgentConfirmMsg }
  | { type: 'agent'; sub: 'log'; msg: agentLog.AgentLogMsg }

// ── Late-bound client reference ───────────────────────────────────────────────
// The component's onEffect closure needs a reference to the agent client,
// but the client is created after mountApp(). Use a closure variable
// populated once the client exists. First effects can only fire after the
// first user action, by which time client is bound.

let client: AgentClient | null = null

// ── Component definition ──────────────────────────────────────────────────────

const App = component<State, Msg, AgentEffect>({
  name: 'TestApp',

  init: () => [
    {
      count: 0,
      lastDelete: null,
      agent: {
        connect: agentConnect.init({ mintUrl: '/agent/mint' })[0],
        confirm: agentConfirm.init()[0],
        log: agentLog.init()[0],
      },
    },
    [],
  ],

  update: (s, m) => {
    switch (m.type) {
      case 'inc':
        return [{ ...s, count: s.count + 1 }, []]
      case 'dec':
        return [{ ...s, count: s.count - 1 }, []]
      case 'reset':
        return [{ ...s, count: 0 }, []]
      case 'delete':
        return [{ ...s, lastDelete: m.id }, []]
      case 'signOut':
        // humanOnly — agent can never reach this path
        return [s, []]
      case 'nav':
        // alwaysAffordable — agent may always call it
        return [s, []]
      case 'agent': {
        switch (m.sub) {
          case 'connect': {
            const [next, effects] = agentConnect.update(s.agent.connect, m.msg, {
              mintUrl: '/agent/mint',
            })
            return [{ ...s, agent: { ...s.agent, connect: next } }, effects]
          }
          case 'confirm': {
            const [next, effects] = agentConfirm.update(s.agent.confirm, m.msg)
            return [{ ...s, agent: { ...s.agent, confirm: next } }, effects]
          }
          case 'log': {
            const [next, effects] = agentLog.update(s.agent.log, m.msg)
            return [{ ...s, agent: { ...s.agent, log: next } }, effects]
          }
        }
      }
    }
  },

  onEffect: async ({ effect }) => {
    if (client) await client.effectHandler(effect)
  },

  view: ({ send, text: t }) => [
    div({ 'data-agent': 'root' }, [
      div({ 'data-agent': 'count-display' }, [t((s) => `count: ${String(s.count)}`)]),
      button({ 'data-agent': 'inc', onClick: () => send({ type: 'inc' }) }, [text('+')]),
      button({ 'data-agent': 'dec', onClick: () => send({ type: 'dec' }) }, [text('-')]),
      button({ 'data-agent': 'reset', onClick: () => send({ type: 'reset' }) }, [text('reset')]),
      button(
        {
          'data-agent': 'delete-42',
          onClick: () => send({ type: 'delete', id: '42' }),
        },
        [text('delete 42')],
      ),
      button({ 'data-agent': 'sign-out', onClick: () => send({ type: 'signOut' }) }, [
        text('sign out'),
      ]),
    ]),
  ],
})

// ── Agent metadata ────────────────────────────────────────────────────────────
//
// The vite-plugin compiler normally emits these at build time by analysing
// JSDoc annotations on the Msg union. For e2e we skip the Vite transform
// (esbuild doesn't speak the LLui 3-pass pipeline) and attach the metadata
// directly at runtime. This is the "pragmatic fallback" from Plan 10.
//
// The fields are defined on ComponentMetadata in @llui/agent/client (not on
// the core ComponentDef), so we cast through unknown to attach them.

type AgentMeta = {
  agentAffordances?: (state: unknown) => Array<{ type: string; [k: string]: unknown }>
  agentDocs?: AgentDocs
  agentContext?: (state: unknown) => AgentContext
  __msgAnnotations?: Record<
    string,
    { intent: string | null; alwaysAffordable: boolean; requiresConfirm: boolean; humanOnly: boolean }
  >
  __bindingDescriptors?: Array<{ variant: string }>
  __schemaHash?: string
}

const AppWithMeta = App as typeof App & AgentMeta

AppWithMeta.agentAffordances = (_s: unknown) => [
  { type: 'nav', to: 'home' },
  { type: 'nav', to: 'reports' },
]

AppWithMeta.agentDocs = {
  purpose: 'Counter with deletion — used by the LLui Agent e2e test harness.',
  overview:
    'Msg variants: inc / dec / reset / delete (requiresConfirm) / signOut (humanOnly) / nav (alwaysAffordable).',
}

AppWithMeta.agentContext = (s: unknown) => {
  const st = s as State
  return {
    summary: `Count is ${st.count}; lastDelete is ${st.lastDelete ?? 'null'}.`,
    hints: [],
  }
}

AppWithMeta.__msgAnnotations = {
  inc: { intent: 'Increment the counter', alwaysAffordable: false, requiresConfirm: false, humanOnly: false },
  dec: { intent: 'Decrement the counter', alwaysAffordable: false, requiresConfirm: false, humanOnly: false },
  reset: { intent: 'Reset to zero', alwaysAffordable: false, requiresConfirm: false, humanOnly: false },
  delete: { intent: 'Delete an item', alwaysAffordable: false, requiresConfirm: true, humanOnly: false },
  signOut: { intent: 'Sign out', alwaysAffordable: false, requiresConfirm: false, humanOnly: true },
  nav: { intent: 'Navigate', alwaysAffordable: true, requiresConfirm: false, humanOnly: false },
}

AppWithMeta.__bindingDescriptors = [
  { variant: 'inc' },
  { variant: 'dec' },
  { variant: 'reset' },
  { variant: 'delete' },
]

AppWithMeta.__schemaHash = 'e2e-test-hash'

// ── Boot ──────────────────────────────────────────────────────────────────────

const root = document.getElementById('app')!
const handle = mountApp(root, App)

client = createAgentClient<State, Msg>({
  handle,
  def: AppWithMeta,
  rootElement: root,
  slices: {
    getConnect: (s) => s.agent.connect,
    getConfirm: (s) => s.agent.confirm,
    wrapConnectMsg: (m) => ({ type: 'agent', sub: 'connect', msg: m as agentConnect.AgentConnectMsg }),
    wrapConfirmMsg: (m) => ({ type: 'agent', sub: 'confirm', msg: m as agentConfirm.AgentConfirmMsg }),
  },
})

// Expose globals so the test harness (running in Node via Playwright
// page.evaluate) can reach in without any in-browser MCP wiring.
//
// __lluiE2eClient: lets tests call client.effectHandler() to open a WS
//   after minting a token — bypasses the "Connect with Claude" button.
// __lluiE2eHandle: lets tests call handle.getState() to read state.
;(globalThis as Record<string, unknown>)['__lluiE2eClient'] = client
;(globalThis as Record<string, unknown>)['__lluiE2eHandle'] = handle

client.start()
