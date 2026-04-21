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

// ── Agent metadata (manual) ───────────────────────────────────────────────────
//
// The vite-plugin's static extractors walk the single file containing the
// `component(...)` call. But github-explorer's Msg union lives in types.ts
// and `send(...)` calls are scattered across view/*.ts files — neither is
// visible to the extractor. So nothing gets emitted onto appDef automatically.
//
// Fix: attach the metadata here at module load. This mirrors what the
// compiler would have emitted if the extractor could see across files.

type AgentMeta = {
  agentAffordances?: (state: unknown) => Array<{ type: string; [k: string]: unknown }>
  agentDocs?: { purpose: string; overview?: string; cautions?: string[] }
  agentContext?: (state: unknown) => {
    summary: string
    hints?: string[]
    cautions?: string[]
  }
  __msgAnnotations?: Record<
    string,
    { intent: string | null; alwaysAffordable: boolean; requiresConfirm: boolean; humanOnly: boolean }
  >
  __bindingDescriptors?: Array<{ variant: string }>
  __schemaHash?: string
  __msgSchema?: Record<
    string,
    {
      payloadSchema: object
      annotations: {
        intent: string | null
        alwaysAffordable: boolean
        requiresConfirm: boolean
        humanOnly: boolean
      }
    }
  >
}

const AppWithMeta = appDef as typeof appDef & AgentMeta

// Always-affordable Msg variants — reachable even when no button is
// currently rendered that dispatches them. Navigation, openPath back.
AppWithMeta.agentAffordances = (_s: unknown) => []

AppWithMeta.agentDocs = {
  purpose: 'Browse GitHub repositories — search for repos, inspect their code, README, and issues.',
  overview:
    'Start on the search page. Type into the query box and submit to search public repos. ' +
    'Click a result to open its repo page with tabs for code and issues. ' +
    'Open directories/files from the file tree. Use prev/next for search pagination.',
  cautions: [
    "GitHub's unauthenticated API is rate-limited. Repeated searches may get throttled.",
  ],
}

AppWithMeta.agentContext = (s: unknown) => {
  const st = s as State
  switch (st.route.page) {
    case 'search':
      return {
        summary: `On the search page. Query: "${st.query}". Page: ${st.route.p}.`,
        hints: [
          'To search, dispatch setQuery with the text, then submitSearch.',
          'Or send a single navigate Msg with the full search route.',
        ],
      }
    case 'repo':
      return {
        summary: `Viewing repo ${st.route.owner}/${st.route.name}, tab: ${st.route.tab}.`,
        hints: ['Switch tabs by dispatching navigate to the other tab.'],
      }
    case 'tree':
      return {
        summary: `Browsing files in ${st.route.owner}/${st.route.name} at path "${st.route.path}".`,
        hints: ['openPath dispatches to navigate into a file or directory.'],
      }
  }
}

AppWithMeta.__msgAnnotations = {
  navigate: {
    intent: 'Navigate to a route (search / repo / tree)',
    alwaysAffordable: true,
    requiresConfirm: false,
    humanOnly: false,
  },
  setQuery: {
    intent: 'Update the search query text',
    alwaysAffordable: false,
    requiresConfirm: false,
    humanOnly: false,
  },
  submitSearch: {
    intent: 'Submit the current search query immediately',
    alwaysAffordable: false,
    requiresConfirm: false,
    humanOnly: false,
  },
  nextPage: {
    intent: 'Go to the next page of search results',
    alwaysAffordable: false,
    requiresConfirm: false,
    humanOnly: false,
  },
  prevPage: {
    intent: 'Go to the previous page of search results',
    alwaysAffordable: false,
    requiresConfirm: false,
    humanOnly: false,
  },
  openPath: {
    intent: 'Open a file or directory from the repo tree',
    alwaysAffordable: true,
    requiresConfirm: false,
    humanOnly: false,
  },
  // Effect-response msgs are humanOnly (agent cannot dispatch them).
  searchOk: { intent: null, alwaysAffordable: false, requiresConfirm: false, humanOnly: true },
  repoOk: { intent: null, alwaysAffordable: false, requiresConfirm: false, humanOnly: true },
  contentsOk: { intent: null, alwaysAffordable: false, requiresConfirm: false, humanOnly: true },
  readmeOk: { intent: null, alwaysAffordable: false, requiresConfirm: false, humanOnly: true },
  issuesOk: { intent: null, alwaysAffordable: false, requiresConfirm: false, humanOnly: true },
  apiError: { intent: null, alwaysAffordable: false, requiresConfirm: false, humanOnly: true },
  readmeError: { intent: null, alwaysAffordable: false, requiresConfirm: false, humanOnly: true },
  contentsError: { intent: null, alwaysAffordable: false, requiresConfirm: false, humanOnly: true },
}

// Binding descriptors — one entry per send() call site that's reachable
// through the rendered UI. The agent's list_actions uses these as the
// base surface (plus affordances, minus humanOnly).
AppWithMeta.__bindingDescriptors = [
  { variant: 'setQuery' },
  { variant: 'submitSearch' },
  { variant: 'nextPage' },
  { variant: 'prevPage' },
  { variant: 'openPath' },
  { variant: 'navigate' },
]

AppWithMeta.__schemaHash = 'github-explorer-v1'

// __msgSchema is the hello-frame wire shape: Record<variant, {payloadSchema, annotations}>.
// The server passes it through verbatim as describe_app.messages. Claude reads both
// the payload shape (when present) and the annotations to pick actions.
//
// payloadSchema values are JSON-Schema-ish fragments. Minimal here — the intent
// text carries the important hints.
const __msgSchema: Record<string, { payloadSchema: object; annotations: typeof AppWithMeta.__msgAnnotations[string] }> = {}
for (const [variant, ann] of Object.entries(AppWithMeta.__msgAnnotations)) {
  const payloadSchema: Record<string, unknown> = (() => {
    switch (variant) {
      case 'navigate':
        return {
          route: {
            description:
              'A Route object: {page: "search", q, p, data} | {page: "repo", owner, name, tab: "code"|"issues", data} | {page: "tree", owner, name, path, data}',
          },
        }
      case 'setQuery':
        return { value: 'string' }
      case 'openPath':
        return { path: 'string', isDir: 'boolean' }
      default:
        return {}
    }
  })()
  __msgSchema[variant] = { payloadSchema, annotations: ann }
}
AppWithMeta.__msgSchema = __msgSchema as unknown as AgentMeta['__msgSchema']

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
