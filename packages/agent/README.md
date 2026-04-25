# @llui/agent

Server and browser-client libraries for the [LLui Agent Protocol (LAP)](../../docs/superpowers/specs/2026-04-19-llui-agent-design.md).

## What this buys you

Your app's users can install the `llui-agent` bridge into Claude Desktop once, paste a token you mint for them, and drive your LLui app from Claude. Same Msgs and State you're already using — Claude dispatches like a remote user.

## Install

```bash
pnpm add @llui/agent @llui/effects ws
pnpm add -D @llui/vite-plugin  # if not already present
```

Enable agent-metadata emission in `vite.config.ts`:

```ts
import llui from '@llui/vite-plugin'
export default { plugins: [llui({ agent: true })] }
```

## Server

```ts
import { createLluiAgentServer } from '@llui/agent/server'
import express from 'express'

const agent = createLluiAgentServer({
  signingKey: process.env.LLUI_AGENT_KEY!,
  identityResolver: async (req) => req.cookies.user_id ?? null,
})

const app = express()
// The router is Web-standards; adapt it:
app.use('/agent', async (req, res) => {
  const webReq = expressToWebRequest(req) // adapter
  const webRes = await agent.router(webReq)
  if (!webRes) {
    res.status(404).end()
    return
  }
  webRes.headers.forEach((v, k) => res.setHeader(k, v))
  res.status(webRes.status).send(await webRes.text())
})

const server = app.listen(8787)
server.on('upgrade', agent.wsUpgrade)
```

## Client

```ts
// @doc-skip — illustration uses `...` placeholders for handlers
import { mountApp } from '@llui/dom'
import { createAgentClient, agentConnect, agentConfirm, agentLog } from '@llui/agent/client'
import { handleEffects } from '@llui/effects'
import { App } from './App'

const root = document.getElementById('app')!
const handle = mountApp(root, App)

const client = createAgentClient({
  handle,
  def: App,
  rootElement: root,
  slices: {
    getConnect: (s) => s.agent.connect,
    getConfirm: (s) => s.agent.confirm,
    wrapConnectMsg: (m) => ({ type: 'agent', sub: 'connect', msg: m }),
    wrapConfirmMsg: (m) => ({ type: 'agent', sub: 'confirm', msg: m }),
  },
})
client.start()

// Chain client.effectHandler into your onEffect:
const onEffect = handleEffects<MyEffect | AgentEffect>()
  .when('http', ...)
  .else(client.effectHandler)
```

## App-side annotations

```ts
// @doc-skip — illustration uses `...` placeholders for init/update/view
type Msg =
  /** @intent("Increment the counter") */
  | { type: 'inc' }
  /** @intent("Delete item") @requiresConfirm */
  | { type: 'delete', id: string }
  /** @intent("Place order") @humanOnly */
  | { type: 'checkout' }
  /** @intent("Navigate") @alwaysAffordable */
  | { type: 'nav', to: 'reports' | 'settings' | 'home' }

export const App = component<State, Msg, Effect>({
  name: 'App',
  init: ...,
  update: ...,
  view: ...,
  agentAffordances: (state) => [
    { type: 'nav', to: 'reports' },
    ...(state.user ? [{ type: 'signOut' }] : []),
  ],
  agentDocs: {
    purpose: 'Kanban for a 3-person design team.',
    overview: 'Columns: To do / Doing / Done. Cards carry owner, due date, tags.',
    cautions: ['Moving to Done locks edits — reopen first.'],
  },
  agentContext: (state) => ({
    summary: `Viewing board "${state.boardName}", ${state.cards.length} cards visible.`,
    hints: state.selectedCard
      ? ['Card focused; enter advances status.']
      : ['Tab to list, arrow to select.'],
  }),
})
```

## Annotations reference

| Tag                 | Semantics                                                    |
| ------------------- | ------------------------------------------------------------ |
| `@intent("...")`    | Human-readable label for Claude + confirmation UI + log      |
| `@alwaysAffordable` | Surfaces to Claude even when no binding is currently visible |
| `@requiresConfirm`  | Claude must propose; user approves before dispatch           |
| `@humanOnly`        | Claude cannot dispatch; not in `list_actions`                |

## App state shape (host integration)

Wire your root state and Msg to include agent sub-slices:

```ts
type State = {
  // ...your app state...
  agent: {
    connect: agentConnect.State
    confirm: agentConfirm.State
    log: agentLog.State
  }
}

type Msg =
  // ...your app msgs...
  | { type: 'agent'; sub: 'connect'; msg: agentConnect.Msg }
  | { type: 'agent'; sub: 'confirm'; msg: agentConfirm.Msg }
  | { type: 'agent'; sub: 'log'; msg: agentLog.Msg }
```

Delegate in `update`:

```ts
update: (state, msg) => {
  if (msg.type === 'agent') {
    if (msg.sub === 'connect') {
      const [connect, effects] = agentConnect.update(state.agent.connect, msg.msg)
      return [{ ...state, agent: { ...state.agent, connect } }, effects]
    }
    if (msg.sub === 'confirm') {
      const [confirm, effects] = agentConfirm.update(state.agent.confirm, msg.msg)
      return [{ ...state, agent: { ...state.agent, confirm } }, effects]
    }
    if (msg.sub === 'log') {
      const [log, effects] = agentLog.update(state.agent.log, msg.msg)
      return [{ ...state, agent: { ...state.agent, log } }, effects]
    }
  }
  // ...your app logic...
}
```

## View wiring

Render `agentConnect`, `agentConfirm`, and `agentLog` anywhere in your view tree:

```ts
view: ({ send, branch, show }) => {
  const connectParts = agentConnect.connect(
    (s) => s.agent.connect,
    (m) => send({ type: 'agent', sub: 'connect', msg: m }),
    { mintUrl: '/agent/mint' },
  )

  const confirmParts = agentConfirm.connect(
    (s) => s.agent.confirm,
    (m) => send({ type: 'agent', sub: 'confirm', msg: m }),
  )

  return [
    // Renders the "Connect with Claude" button + token copy box + session list:
    div(connectParts.root, [
      button(connectParts.mintTrigger, ['Connect with Claude']),
      ...show({
        when: (s) => s.agent.connect.pendingToken !== null,
        render: () => [
          pre(connectParts.pendingTokenBox),
          button(connectParts.copyConnectSnippetButton, ['Copy']),
        ],
      }),
    ]),
    // Renders pending confirmation cards:
    div(confirmParts.root),
  ]
}
```

## Entry points

- `@llui/agent/protocol` — all LAP types, WS frame types, token types, audit types.
- `@llui/agent/server` — `createLluiAgentServer`, `InMemoryTokenStore`, `consoleAuditSink`, interfaces.
- `@llui/agent/client` — `createAgentClient`, `agentConnect`, `agentConfirm`, `agentLog`, `AgentEffect`.

See the [Agent Protocol doc](../../docs/designs/10%20Agent%20Protocol.md) for the full wire protocol and security model.
