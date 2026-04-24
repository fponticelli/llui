---
title: '@llui/agent'
description: 'LLM-driven control surface: LAP server + browser client runtime for driving LLui apps from Claude and other LLM clients'
---

# @llui/agent

The agent package lets an LLM drive a running LLui app — read state, enumerate available actions, dispatch messages, and observe the result. It is **not** a debugging surface (see [`@llui/mcp`](/api/mcp) for that). It is a production-intended control channel authored into your app.

```bash
pnpm add @llui/agent
```

## The two packages

| Package                                   | Runs in                    | Purpose                                                               |
| ----------------------------------------- | -------------------------- | --------------------------------------------------------------------- |
| [`@llui/agent`](/api/agent)               | Your app server + browser  | LAP server (HTTP + WebSocket) and client runtime; defines the surface |
| [`@llui/agent-bridge`](/api/agent-bridge) | Claude Desktop (stdio MCP) | Translates MCP tool calls into LAP requests; the CLI is `llui-agent`  |

The user connects Claude to a running instance of your app by pasting a one-line command (`/llui-connect <url> <token>`) after the app mints a token. From there Claude calls MCP tools (`observe`, `send_message`, …), the bridge forwards them to the LAP server, and the LAP server RPCs the paired browser tab.

## Quick start

### 1. Enable the dev middleware

The easiest way to try the agent surface is via the Vite plugin option:

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'

export default defineConfig({
  plugins: [llui({ agent: true })],
})
```

With `agent: true`, the plugin dynamically loads `@llui/agent/server` and mounts `/agent/*` (HTTP) and `/agent/ws` (WebSocket upgrade) on your dev server. No further backend wiring is required for local development.

### 2. Wire the client runtime

After `mountApp`, construct the agent client and start it. The client owns three state slices — `connect`, `confirm`, `log` — that you fold into your app's reducer.

```ts
// main.ts
import { mountApp } from '@llui/dom'
import { createAgentClient, agentConnect, agentConfirm, agentLog } from '@llui/agent/client'
import { appDef } from './app'
import type { State, Msg } from './types'

const container = document.getElementById('app')!
const handle = mountApp(container, appDef)

const agentClient = createAgentClient<State, Msg>({
  handle,
  def: appDef,
  rootElement: container,
  slices: {
    getConnect: (s) => s.agent.connect,
    getConfirm: (s) => s.agent.confirm,
    wrapConnectMsg: (m) => ({ type: 'agent', sub: 'connect', msg: m }),
    wrapConfirmMsg: (m) => ({ type: 'agent', sub: 'confirm', msg: m }),
    wrapLogMsg: (m) => ({ type: 'agent', sub: 'log', msg: m }),
  },
})
agentClient.start()
```

In your app's `update`, route the `agent.connect`, `agent.confirm`, and `agent.log` cases to each sub-module's `update`. Initial state:

```ts
init: () => [
  {
    // …your state
    agent: {
      connect: agentConnect.init({ mintUrl: '/agent/mint' })[0],
      confirm: agentConfirm.init()[0],
      log: agentLog.init()[0],
    },
  },
  [],
]
```

### 3. Install the MCP bridge

Install the CLI globally (or add it to your dev-deps and call via `npx`):

```bash
npm install -g llui-agent
```

Add it to Claude Desktop's MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "llui": { "command": "llui-agent" }
  }
}
```

Restart Claude Desktop. The `llui_connect_session`, `observe`, `send_message`, and related tools will appear in the tool picker.

### 4. Connect

Open your app (`vite dev`), use the in-app UI to mint a token (the `agentConnect` slice provides the state machine — render a button that dispatches `{ type: 'agent', sub: 'connect', msg: { type: 'RequestMint' } }`), copy the resulting `/llui-connect <url> <token>` command, and paste it into your Claude conversation. Claude calls `llui_connect_session`, then `observe`, and you're live.

## Annotating messages

Claude decides what to dispatch by reading your `Msg` discriminated union. JSDoc tags on each variant classify its agent affordability:

<!-- prettier-ignore -->
```ts
type Msg =
  /** @intent("increment the counter") */
  | { type: 'inc' }
  /** @intent("reset to zero") @requiresConfirm */
  | { type: 'reset' }
  /** @humanOnly */
  | { type: 'internalWheelDelta'; dy: number }
  /** @alwaysAffordable @intent("navigate to route") */
  | { type: 'navigate'; to: string }
```

| Tag                 | Effect                                                                                                      |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `@intent("...")`    | Human-readable label shown to the LLM. Without it, the variant name is used directly.                       |
| `@requiresConfirm`  | The LLM's `send_message` returns `pending-confirmation`; a user must approve in the app UI before dispatch. |
| `@humanOnly`        | Hard-block — the LLM cannot dispatch. Use for pointer-event plumbing, internal UI wiring.                   |
| `@alwaysAffordable` | The variant is listed in actions even when no UI binding currently references it (e.g. hidden commands).    |

The Vite compiler extracts these tags into `__msgAnnotations` on the component. No runtime cost if the tags aren't present.

## Component-level metadata

Three optional functions on the `ComponentDef` give Claude context beyond the types:

```ts
export const App = component<State, Msg, Effect>({
  name: 'App',
  init,
  update,
  view,
})

// Purpose + static cautions — shown in `observe`'s description slice.
App.agentDocs = {
  purpose: 'Browse GitHub repositories — search, inspect code, READMEs, and issues.',
  overview:
    'Start on the search page. Type a query, submit, then open results. ' +
    'Tabs switch between code and issues; the file tree opens directories.',
  cautions: ["GitHub's unauthenticated API is rate-limited."],
}

// Dynamic per-state narrative — shown in `observe`'s context slice.
App.agentContext = (state) => {
  switch (state.route.page) {
    case 'search':
      return {
        summary: `On the search page. Query: "${state.query}".`,
        hints: ['Dispatch setQuery then submitSearch, or a single navigate Msg.'],
      }
    case 'repo':
      return { summary: `Viewing ${state.route.owner}/${state.route.name}.` }
  }
}

// Extra affordances not reachable via visible bindings — e.g. "back" or hotkeys.
App.agentAffordances = (state) => [{ type: 'navigate', to: '/search' }]
```

## DOM tagging

Mark elements you want Claude to be able to read or address with `data-agent`:

```ts
input({
  type: 'search',
  'data-agent': 'search-input',
  onInput: (e) => send({ type: 'setQuery', q: e.currentTarget.value }),
})

ul({ class: 'repo-list', 'data-agent': 'search-results' }, [
  // …
])
```

The `query_dom` tool reads by `data-agent` name; `describe_visible_content` walks the visible subtree and emits a structured outline.

## Runtime support

The agent server needs a runtime that can hold a long-lived WebSocket. `{ agent: true }` in the vite-plugin is dev-only; production deployment depends on where your backend runs.

| Runtime                              | Supported | Entry point                                          | Notes                                                            |
| ------------------------------------ | --------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| Node.js (server process)             | yes       | `@llui/agent/server`                                 | Uses the `ws` library. Default path.                             |
| Bun (server process)                 | yes       | `@llui/agent/server/core` + `@llui/agent/server/web` | Wire `server.upgrade()` + `createWHATWGPairingConnection`.       |
| Deno / Deno Deploy                   | yes       | `@llui/agent/server/core` + `@llui/agent/server/web` | Uses `handleDenoUpgrade()`.                                      |
| Cloudflare Workers + Durable Objects | yes       | `@llui/agent/server/cloudflare`                      | Pairing state lives in a DO. See below.                          |
| Cloudflare Workers (bare, no DO)     | **no**    | —                                                    | Worker isolates are stateless; can't own a long-lived WebSocket. |
| Vercel Edge, plain Lambda            | **no**    | —                                                    | No native WebSocket + stateless. Not viable.                     |

All supported paths share the same LAP wire protocol and MCP bridge — the runtime differences are just in how each one accepts a WebSocket upgrade.

## Node deployment

`@llui/agent/server` exports `createLluiAgentServer`, which returns an HTTP router and a WebSocket upgrade handler you attach to your Node server:

```ts
// server.ts
import { createServer } from 'node:http'
import { createLluiAgentServer } from '@llui/agent/server'

const agent = createLluiAgentServer({
  signingKey: process.env.AGENT_SIGNING_KEY!, // ≥ 32 bytes
  // Optional — defaults are in-memory, single-process:
  // tokenStore: myRedisTokenStore,
  // identityResolver: myAuthResolver,
  // auditSink: myAuditSink,
  // rateLimiter: defaultRateLimiter({ perBucket: '30/minute' }),
  // corsOrigins: ['https://app.example.com'],
})

const server = createServer(async (req, res) => {
  // Convert Node req → Fetch Request, hand to agent.router first
  // (fall through to your own router on null)
  // …
})

server.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/agent/ws')) agent.wsUpgrade(req, socket, head)
  else socket.destroy()
})

server.listen(3000)
```

The defaults (`InMemoryTokenStore`, `consoleAuditSink`, 30-req/min limiter) are fine for a single-process dev server. For production, swap in a persistent `TokenStore`, an `IdentityResolver` tied to your auth system, and a durable `AuditSink`.

## Deno deployment

Import the runtime-neutral core + the web upgrade helper:

```ts
import { createLluiAgentCore } from '@llui/agent/server/core'
import { handleDenoUpgrade } from '@llui/agent/server/web'

const agent = createLluiAgentCore({ signingKey: Deno.env.get('AGENT_SIGNING_KEY')! })

Deno.serve(async (req) => {
  const url = new URL(req.url)
  if (url.pathname === '/agent/ws') return handleDenoUpgrade(req, agent)
  return (await agent.router(req)) ?? new Response('Not Found', { status: 404 })
})
```

## Bun deployment

Bun's `server.upgrade()` hands the socket to your `websocket.open()` handler. Wire it to `createWHATWGPairingConnection` and call `agent.acceptConnection`:

```ts
import { createLluiAgentCore } from '@llui/agent/server/core'
import { createWHATWGPairingConnection } from '@llui/agent/server/web'

const agent = createLluiAgentCore({ signingKey: Bun.env.AGENT_SIGNING_KEY! })

Bun.serve({
  fetch(req, server) {
    const url = new URL(req.url)
    if (url.pathname === '/agent/ws') {
      const token = url.searchParams.get('token')
      if (!token) return new Response('Unauthorized', { status: 401 })
      if (server.upgrade(req, { data: { token } })) return undefined
      return new Response('Upgrade failed', { status: 500 })
    }
    return agent.router(req).then((r) => r ?? new Response('Not Found', { status: 404 }))
  },
  websocket: {
    async open(ws) {
      const conn = createWHATWGPairingConnection(ws as unknown as WebSocket)
      const { token } = ws.data as { token: string }
      const result = await agent.acceptConnection(token, conn)
      if (!result.ok) ws.close()
    },
  },
})
```

## Cloudflare deployment

Cloudflare Workers are stateless isolates — a bare Worker cannot own a long-lived WebSocket. The agent's pairing state lives in a **Durable Object** (one DO per session `tid`). The DO IS the registry; the Worker just routes requests to the right DO.

```ts
// worker.ts
import { AgentPairingDurableObject, routeToAgentDO } from '@llui/agent/server/cloudflare'

export interface Env {
  AGENT_SIGNING_KEY: string
  AGENT_DO: DurableObjectNamespace
}

export class AgentDO {
  private agent: AgentPairingDurableObject
  constructor(_state: DurableObjectState, env: Env) {
    this.agent = new AgentPairingDurableObject({
      signingKey: env.AGENT_SIGNING_KEY,
    })
  }
  fetch(req: Request): Promise<Response> {
    return this.agent.fetch(req)
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return routeToAgentDO(req, env.AGENT_DO, env.AGENT_SIGNING_KEY)
  },
}
```

`wrangler.toml`:

```toml
[[durable_objects.bindings]]
name = "AGENT_DO"
class_name = "AgentDO"

[[migrations]]
tag = "v1"
new_classes = ["AgentDO"]
```

Set the signing key via `wrangler secret put AGENT_SIGNING_KEY` in production.

How it routes:

- `POST /agent/mint`, `/agent/resume/*`, `/agent/sessions`, `/agent/revoke` → all go to a shared root DO (`__root`) that owns the token store.
- `POST /agent/lap/v1/*` → routed by the `tid` in the `Authorization: Bearer` token to the per-session DO.
- `GET /agent/ws` (WebSocket upgrade) → routed by the `tid` in `?token=` to the per-session DO.

Each session DO holds its own `InMemoryPairingRegistry` + open WebSocket. Cloudflare's DO instance affinity by name guarantees every request for a given `tid` hits the same isolate, so pairing state stays consistent without external sync.

### Crypto

All HMAC operations use the WebCrypto standard (`crypto.subtle`), available in Node ≥ 15, Cloudflare Workers, Deno, and Bun. The agent package does not depend on `node:crypto`; that was removed in 0.0.31.

## Efficient tool usage

The bridge exposes a two-tier tool surface:

**Recommended path:** `observe` + `send_message`. One `observe` call returns state, actions, description, and context together — replacing `describe_app + get_state + list_actions`. `send_message` defaults to `waitFor: 'drained'`, which blocks until the message queue goes idle (`http`/`delay`/`debounce` round-trips feed back as messages), then returns the fresh state and actions in the response. Two round-trips per interaction instead of five.

```jsonc
// observe →
{
  "state": { "count": 0, "loading": false, "results": [] },
  "actions": [{ "variant": "search", "intent": "run search", "requiresConfirm": false, "source": "binding" }],
  "description": { "name": "Explorer", "messages": { /* schemas */ }, "docs": { /* agentDocs */ } },
  "context": { "summary": "On the search page", "hints": [ /* */ ] }
}

// send_message { msg: { type: "search", q: "llui" } } →
{
  "status": "dispatched",
  "stateAfter": { "count": 0, "loading": false, "results": [ /* 10 items */ ] },
  "actions": [ /* now includes nextPage */ ],
  "drain": { "effectsObserved": 3, "durationMs": 184, "timedOut": false, "errors": [] }
}
```

`send_message` controls:

- `waitFor: 'drained' | 'idle' | 'none'` — `'drained'` (default) waits for quiescence; `'idle'` flushes the synchronous update cycle only (no async effects); `'none'` is fire-and-forget.
- `drainQuietMs` — quiet-window size. Drain completes when no commit fires for this many ms. Default 100.
- `timeoutMs` — hard cap. Default 5000. If reached, `drain.timedOut: true` returns a partial snapshot; call `observe` again once activity settles.

**Legacy path:** `describe_app`, `get_state`, `list_actions`, `wait_for_change`. Kept for back-compat and specialized cases (e.g. JSON-pointer state slices, long-polling for externally-pushed state changes like WebSocket events arriving while the LLM is idle).

See [`@llui/agent-bridge`](/api/agent-bridge) for the full MCP tool list and CLI reference.

## Security notes

- `signingKey` must be ≥ 32 bytes. Rotating it invalidates all outstanding tokens.
- Tokens are stored with a 1-hour sliding TTL by default; re-configure via `slidingTtlMs`.
- Rate limiting applies per-token. The default `30/minute` limiter is a coarse ceiling — tune it for your workload.
- `@humanOnly` is a hard block at the browser RPC layer, not just a convention.
- `@requiresConfirm` flows a confirmation message through state; approval requires the user to interact with the app UI, not just the LLM.
- The `corsOrigins` option defaults to "any" — set it explicitly in production.

<!-- auto-api:start -->

## Functions

### `createLluiAgentCore()`

Compose the runtime-neutral agent server. The returned handle has
everything the LAP HTTP routes and the WebSocket acceptance
plumbing need; runtime adapters wire the native upgrade API on
top (see `@llui/agent/server` for Node, `@llui/agent/server/web`
for WHATWG runtimes).

```typescript
function createLluiAgentCore(opts: CoreOptions): AgentCoreHandle
```

### `createLluiAgentServer()`

Node adapter. Wraps the runtime-neutral core with a Node-specific
`wsUpgrade` handler that uses the `ws` library. Imports `ws`
eagerly, so this module only works where `ws` is available — use
`@llui/agent/server/web` for Cloudflare Workers, Deno, or other
WHATWG runtimes.
Spec §10.1, §10.4.

```typescript
function createLluiAgentServer(opts: ServerOptions): AgentServerHandle
```

### `signToken()`

Serialize a payload to `llui-agent_<base64url(json)>.<base64url(hmac)>`.
See spec §6.1. Async because WebCrypto's HMAC sign/verify is the
cross-runtime standard; Node, Cloudflare, Deno, and Bun all expose
`crypto.subtle` identically.

```typescript
function signToken(payload: TokenPayload, key: string | Uint8Array): Promise<AgentToken>
```

### `verifyToken()`

Verify the signature, parse the payload, and check expiry.
`crypto.subtle.verify` does the constant-time compare internally,
so we don't need a separate `timingSafeEqual`.

```typescript
function verifyToken(
  token: string,
  key: string | Uint8Array,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<VerifyResult>
```

### `defaultIdentityResolver()`

```typescript
function defaultIdentityResolver(cfg: IdentityCookieConfig): IdentityResolver
```

### `signCookieValue()`

Async because `crypto.subtle.sign` is the cross-runtime standard.
Callers building a `Set-Cookie` header must `await` this.

```typescript
function signCookieValue(value: string, signingKey: string | Uint8Array): Promise<string>
```

### `defaultRateLimiter()`

```typescript
function defaultRateLimiter(cfg: RateLimitConfig, now: () => number = () => Date.now()): RateLimiter
```

### `rpc()`

Send an `rpc` frame to the paired browser and await its
matching `rpc-reply` / `rpc-error`. Runs its own one-shot frame
subscription against the registry — no state stored on the
registry itself, which keeps the registry small enough to
implement in a Durable Object or other stateful primitive.
Rejects with `{code: 'paused'}` when the pairing is absent,
`{code: 'timeout'}` when the browser doesn't reply in time,
or whatever the browser sent in its `rpc-error` frame otherwise.

```typescript
function rpc(
  registry: PairingRegistry,
  tid: string,
  tool: string,
  args: unknown,
  opts: RpcOptions = {},
): Promise<unknown>
```

### `waitForConfirm()`

Await a `confirm-resolved` frame for the given `confirmId`.
Resolves with `{outcome: 'user-cancelled'}` on timeout or pairing
drop (approvals lapse when the user isn't present to act on them).

```typescript
function waitForConfirm(
  registry: PairingRegistry,
  tid: string,
  confirmId: string,
  timeoutMs: number,
): Promise<{ outcome: 'confirmed' | 'user-cancelled'; stateAfter?: unknown }>
```

### `waitForChange()`

Await a `state-update` frame whose path matches (exact or prefix).
Used by the long-poll `/lap/v1/wait` endpoint for external state
pushes (WebSocket messages, timers) arriving while the LLM is idle.

```typescript
function waitForChange(
  registry: PairingRegistry,
  tid: string,
  path: string | undefined,
  timeoutMs: number,
): Promise<{ status: 'changed' | 'timeout'; stateAfter: unknown }>
```

### `createWHATWGPairingConnection()`

Wrap a WHATWG `WebSocket` in a `PairingConnection`. This is the
common denominator across Cloudflare Workers (`WebSocketPair`
server half), Deno (`Deno.upgradeWebSocket().socket`), Bun's
upgraded socket, and any other runtime that exposes a
standards-compliant WebSocket object.
The input type is intentionally the browser/global `WebSocket`
interface — _not_ the Node `ws` library's variant, which uses an
EventEmitter API (`on('message', ...)`) rather than
`addEventListener('message', ...)`. Use `./node/upgrade.ts` for
the `ws` library path.

```typescript
function createWHATWGPairingConnection(socket: WebSocket): PairingConnection
```

### `extractToken()`

Extract the bearer token from a LAP WebSocket upgrade request.
Accepts the token on either `?token=` or `Authorization: Bearer` —
query-string is the common pattern because browsers can't set
arbitrary headers on WebSocket construction.

```typescript
function extractToken(req: Request): string | null
```

### `handleCloudflareUpgrade()`

Cloudflare Workers handler. Accepts a WebSocket upgrade using
`WebSocketPair`, validates the token via
`agent.acceptConnection`, and returns the 101 upgrade Response.
Usage:

```ts
const agent = createLluiAgentCore({ signingKey: env.AGENT_KEY })
export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    if (url.pathname === '/agent/ws') return handleCloudflareUpgrade(req, agent)
    return (await agent.router(req)) ?? new Response('Not Found', { status: 404 })
  },
}
```

```typescript
function handleCloudflareUpgrade(req: Request, agent: AgentCoreHandle): Promise<Response>
```

### `handleDenoUpgrade()`

Deno handler. Uses `Deno.upgradeWebSocket(req)` to produce the
response + socket pair, then plugs the socket into the registry.
Usage:

```ts
Deno.serve(async (req) => {
  const url = new URL(req.url)
  if (url.pathname === '/agent/ws') return handleDenoUpgrade(req, agent)
  return (await agent.router(req)) ?? new Response('Not Found', { status: 404 })
})
```

```typescript
function handleDenoUpgrade(req: Request, agent: AgentCoreHandle): Promise<Response>
```

### `routeToAgentDO()`

Route an incoming Worker `fetch` request to the Durable Object
that owns its `tid`.
The token travels in three places depending on the route:

- LAP HTTP calls: `Authorization: Bearer <token>` header
- Mint / resume HTTP calls: no token (identity resolver runs
  inside the DO via the LAP router; we route by origin or a
  special `/agent/mint` path — see below)
- WebSocket upgrade: `?token=<token>` in the URL
  Requests that don't carry a tid (mint, resume-list, sessions) are
  routed to a "root" DO named `__root`, which handles identity /
  token store operations centrally. LAP and WS calls route to the
  per-tid DO so the pairing state stays local.
  This is the recommended entry for Cloudflare Workers deployments;
  users who need custom routing can write their own and call the
  underlying primitives (`verifyToken`, `namespace.get`, etc).

```typescript
function routeToAgentDO(
  req: Request,
  namespace: MinimalDurableObjectNamespace,
  signingKey: string | Uint8Array,
  opts: { rootName?: string } = {},
): Promise<Response>
```

### `createAgentClient()`

```typescript
function createAgentClient<State, Msg>(opts: CreateAgentClientOpts<State, Msg>): AgentClient
```

### `init()`

Component shape is [State, Effect[]] — consistent with @llui/components.

```typescript
function init(_opts: AgentConnectInitOpts): [AgentConnectState, AgentEffect[]]
```

### `update()`

```typescript
function update(
  state: AgentConnectState,
  msg: AgentConnectMsg,
  opts: AgentConnectInitOpts,
): [AgentConnectState, AgentEffect[]]
```

### `connect()`

Builds prop bags for the view. See spec §9.1 and the @llui/components
dialog.ts pattern.

```typescript
function connect<S>(
  get: (s: S) => AgentConnectState,
  send: Send<AgentConnectMsg>,
  _opts: AgentConnectConnectOptions = {},
): (state: S) => ConnectBag
```

## Types

### `CoreOptions`

Options accepted by `createLluiAgentCore`. Strict subset of
`ServerOptions` — everything needed to build the router, registry,
and accept-connection primitive. The Node factory adds WebSocket
upgrade wiring on top.

```typescript
export type CoreOptions = {
  signingKey: ServerOptions['signingKey']
  tokenStore?: TokenStore
  identityResolver?: IdentityResolver
  auditSink?: AuditSink
  rateLimiter?: RateLimiter
  lapBasePath?: string
  /**
   * Override the default `InMemoryPairingRegistry`. Web runtimes that
   * need a different pairing implementation (e.g. a Cloudflare
   * Durable Object that persists across isolates) pass it here.
   */
  registry?: PairingRegistry
}
```

### `AcceptResult`

```typescript
export type AcceptResult =
  | { ok: true; tid: string }
  | { ok: false; status: number; code: 'auth-failed' | 'revoked' }
```

### `AgentCoreHandle`

Handle returned by `createLluiAgentCore`. Purely runtime-neutral —
`router` is a Fetch-style handler, `acceptConnection` is the
primitive that runtime-specific WebSocket adapters call after
accepting a socket in their native way.

```typescript
export type AgentCoreHandle = {
  router: (req: Request) => Promise<Response | null>
  registry: PairingRegistry
  tokenStore: TokenStore
  auditSink: AuditSink
  /**
   * Validate an agent token and register a `PairingConnection` with
   * the registry. Use this after accepting a WebSocket upgrade via
   * your runtime's native API (e.g. `WebSocketPair` on Cloudflare,
   * `Deno.upgradeWebSocket` on Deno, `server.upgrade` on Bun).
   *
   * On success: marks the token `awaiting-claude`, writes an audit
   * entry, and returns `{ok: true, tid}`. On failure: returns an
   * appropriate HTTP status for the caller to encode into the
   * upgrade response (401 for auth failure, 403 for revoked).
   */
  acceptConnection: (token: string, conn: PairingConnection) => Promise<AcceptResult>
}
```

### `ServerOptions`

Options accepted by `createLluiAgentServer`. All values except
`signingKey` are optional and fall back to in-memory defaults.
See spec §10.1.

```typescript
export type ServerOptions = {
  /** HMAC key for signing tokens. ≥32 bytes; rotation invalidates all tokens. */
  signingKey: string | Uint8Array

  /** Token store. Defaults to an `InMemoryTokenStore`. */
  tokenStore?: TokenStore

  /** Identity resolver. Defaults to anonymous (always null). */
  identityResolver?: IdentityResolver

  /** Audit sink. Defaults to `consoleAuditSink`. */
  auditSink?: AuditSink

  /** Rate limiter. Defaults to `defaultRateLimiter` with 30/minute. */
  rateLimiter?: RateLimiter

  /** Base path prefix for LAP endpoints. Defaults to `/agent/lap/v1`. */
  lapBasePath?: string

  /** Pairing grace window after a tab closes, in ms. Default 15 min. */
  pairingGraceMs?: number

  /** Sliding TTL for active tokens, in ms. Default 1 h. */
  slidingTtlMs?: number

  /** Allowed origins for the HTTP surface (CORS). Empty = any. */
  corsOrigins?: readonly string[]
}
```

### `AgentServerHandle`

Value returned by `createLluiAgentServer`. `router` matches any
`/agent/*` request and returns a Response (or null to fall through).
`wsUpgrade` handles Node HTTP upgrade events for `/agent/ws`.

```typescript
export type AgentServerHandle = {
  router: (req: Request) => Promise<Response | null>
  /**
   * Handles Node HTTP upgrade events for `/agent/ws`. Returns a Promise
   * because token verification uses WebCrypto (async). Node's
   * `server.on('upgrade', handler)` fires the handler without awaiting,
   * which is fine — the handler writes errors directly to the socket
   * and never throws back to the caller.
   */
  wsUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>
  /** The pairing registry. Runtime-neutral adapters may access it. */
  registry: PairingRegistry
  /** The active token store. */
  tokenStore: TokenStore
  /** The active audit sink. */
  auditSink: AuditSink
  /**
   * Runtime-neutral WebSocket acceptance primitive. Validates a token
   * and registers a `PairingConnection` with the registry. The Node
   * `wsUpgrade` above calls this internally; web-runtime adapters
   * (`@llui/agent/server/web`) use it after accepting a WebSocket via
   * their native API.
   */
  acceptConnection: (token: string, conn: PairingConnection) => Promise<AcceptResult>
}
```

### `TokenPayload`

```typescript
export type TokenPayload = {
  tid: string
  iat: number
  exp: number
  scope: 'agent'
}
```

### `VerifyResult`

```typescript
export type VerifyResult =
  | { kind: 'ok'; payload: TokenPayload }
  | { kind: 'invalid'; reason: 'malformed' | 'bad-signature' | 'expired' }
```

### `IdentityResolver`

```typescript
export type IdentityResolver = (req: Request) => Promise<string | null>
```

### `IdentityCookieConfig`

```typescript
export type IdentityCookieConfig = {
  name: string
  signingKey: string | Uint8Array
}
```

### `AuditSink`

```typescript
export type AuditSink = {
  write: (entry: AuditEntry) => void | Promise<void>
}
```

### `RateLimitResult`

```typescript
export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterMs: number }
```

### `RateLimitConfig`

```typescript
export type RateLimitConfig = {
  perBucket: string
}
```

### `FrameSubscriber`

A per-call frame subscriber. Return `true` to remove this
subscriber (one-shot), or `false` to keep receiving. The registry
dispatches every inbound `ClientFrame` to every active subscriber
for the given `tid`; subscribers filter by `frame.t` + identifiers
(correlation id, confirm id, state path) to find the one that
belongs to their request.

```typescript
export type FrameSubscriber = (frame: ClientFrame) => boolean
```

### `RpcError`

```typescript
export type RpcError = {
  code: 'paused' | 'invalid' | 'timeout' | 'schema-error' | 'internal' | string
  detail?: string
}
```

### `RpcOptions`

```typescript
export type RpcOptions = { timeoutMs?: number }
```

### `DurableObjectOptions`

```typescript
export type DurableObjectOptions = Omit<CoreOptions, 'registry'>
```

### `CreateAgentClientOpts`

```typescript
export type CreateAgentClientOpts<State, Msg> = {
  handle: AppHandle
  def: ComponentMetadata
  appVersion?: string
  rootElement: Element | null
  slices: {
    getConnect: (s: State) => unknown
    getConfirm: (s: State) => AgentConfirmState
    wrapConnectMsg: (m: unknown) => Msg
    wrapConfirmMsg: (m: unknown) => Msg
    /**
     * Optional: wrap an agentLog msg so the client-side activity feed
     * mirrors what Claude is doing. If omitted, outbound log-append
     * frames still go to the server, but the local agent.log slice
     * stays empty (the UI won't show activity).
     */
    wrapLogMsg?: (m: unknown) => Msg
  }
}
```

### `AgentClient`

```typescript
export type AgentClient = {
  effectHandler: (effect: AgentEffect) => Promise<void>
  start(): void
  stop(): void
}
```

### `AgentEffect`

```typescript
export type AgentEffect =
  | { type: 'AgentMintRequest'; mintUrl: string }
  | { type: 'AgentOpenWS'; token: AgentToken; wsUrl: string }
  | { type: 'AgentCloseWS' }
  | { type: 'AgentResumeCheck'; tids: string[] }
  | { type: 'AgentResumeClaim'; tid: string }
  | { type: 'AgentRevoke'; tid: string }
  | { type: 'AgentSessionsList' }
  | { type: 'AgentForwardMsg'; payload: unknown }
```

### `AgentEffectHandler`

```typescript
export type AgentEffectHandler = (effect: AgentEffect) => Promise<void>
```

### `AgentConnectStatus`

```typescript
export type AgentConnectStatus = 'idle' | 'minting' | 'pending-claude' | 'active' | 'error'
```

### `AgentConnectPendingToken`

```typescript
export type AgentConnectPendingToken = {
  token: AgentToken
  tid: string
  lapUrl: string
  connectSnippet: string // "/llui-connect <lapUrl> <token>"
  expiresAt: number
}
```

### `AgentConnectState`

```typescript
export type AgentConnectState = {
  status: AgentConnectStatus
  pendingToken: AgentConnectPendingToken | null
  sessions: AgentSession[]
  resumable: AgentSession[]
  error: { code: string; detail: string } | null
}
```

### `AgentConnectMsg`

```typescript
export type AgentConnectMsg =
  | { type: 'Mint' }
  | {
      type: 'MintSucceeded'
      token: AgentToken
      tid: string
      lapUrl: string
      wsUrl: string
      expiresAt: number
    }
  | { type: 'MintFailed'; error: { code: string; detail: string } }
  | { type: 'WsOpened' }
  | { type: 'WsClosed' }
  | { type: 'ActivatedByClaude' }
  | { type: 'ResumeList'; tids: string[] }
  | { type: 'ResumeListLoaded'; sessions: AgentSession[] }
  | { type: 'Resume'; tid: string }
  | { type: 'Revoke'; tid: string }
  | { type: 'ClearError' }
  | { type: 'SessionsLoaded'; sessions: AgentSession[] }
  | { type: 'RefreshSessions' }
```

### `AgentConnectInitOpts`

```typescript
export type AgentConnectInitOpts = { mintUrl: string }
```

### `AgentConnectConnectOptions`

```typescript
export type AgentConnectConnectOptions = {
  id?: string // optional DOM id prefix
}
```

### `ConfirmEntry`

```typescript
export type ConfirmEntry = {
  id: string
  variant: string
  payload: unknown
  intent: string
  reason: string | null
  proposedAt: number
  status: 'pending' | 'approved' | 'rejected'
}
```

### `AgentConfirmState`

```typescript
export type AgentConfirmState = { pending: ConfirmEntry[] }
```

### `AgentConfirmMsg`

```typescript
export type AgentConfirmMsg =
  | { type: 'Propose'; entry: ConfirmEntry }
  | { type: 'Approve'; id: string }
  | { type: 'Reject'; id: string }
  | { type: 'ExpireStale'; now: number; maxAgeMs: number }
```

### `AgentLogFilter`

```typescript
export type AgentLogFilter = { kinds?: LogKind[]; since?: number }
```

### `AgentLogState`

```typescript
export type AgentLogState = {
  entries: LogEntry[]
  filter: AgentLogFilter
}
```

### `AgentLogInitOpts`

```typescript
export type AgentLogInitOpts = { maxEntries?: number }
```

### `AgentLogMsg`

```typescript
export type AgentLogMsg =
  | { type: 'Append'; entry: LogEntry }
  | { type: 'Clear' }
  | { type: 'SetFilter'; filter: AgentLogFilter }
```

### `LapErrorCode`

```typescript
export type LapErrorCode =
  | 'auth-failed'
  | 'revoked'
  | 'paused'
  | 'rate-limited'
  | 'invalid'
  | 'schema-error'
  | 'timeout'
  | 'internal'
```

### `LapError`

```typescript
export type LapError = {
  error: {
    code: LapErrorCode
    detail?: string
    retryAfterMs?: number
  }
}
```

### `MessageAnnotations`

```typescript
export type MessageAnnotations = {
  intent: string | null
  alwaysAffordable: boolean
  requiresConfirm: boolean
  humanOnly: boolean
}
```

### `MessageSchemaEntry`

```typescript
export type MessageSchemaEntry = {
  payloadSchema: object
  annotations: MessageAnnotations
}
```

### `LapDescribeResponse`

```typescript
export type LapDescribeResponse = {
  name: string
  version: string
  stateSchema: object
  messages: Record<string, MessageSchemaEntry>
  docs: AgentDocs | null
  conventions: {
    dispatchModel: 'TEA'
    confirmationModel: 'runtime-mediated'
    readSurfaces: readonly (
      | 'state'
      | 'query_dom'
      | 'describe_visible_content'
      | 'describe_context'
    )[]
  }
  schemaHash: string
}
```

### `LapStateRequest`

```typescript
export type LapStateRequest = { path?: string }
```

### `LapStateResponse`

```typescript
export type LapStateResponse = { state: unknown }
```

### `LapActionsResponse`

```typescript
export type LapActionsResponse = {
  actions: Array<{
    variant: string
    intent: string
    requiresConfirm: boolean
    source: 'binding' | 'always-affordable'
    selectorHint: string | null
    payloadHint: object | null
  }>
}
```

### `LapMessageRequest`

```typescript
export type LapMessageRequest = {
  msg: { type: string; [k: string]: unknown }
  reason?: string
  /**
   * Backpressure contract for how long `/message` waits before returning:
   * - `drained` (default): dispatch, then loop until the message queue is
   *   idle for `drainQuietMs` ms or the 5s hard cap trips. Captures any
   *   effect round-trips (http/delay/debounce) that feed back as messages.
   * - `idle`: dispatch + flush + one microtask yield. Captures the
   *   synchronous update cycle but not async effects.
   * - `none`: dispatch and return without flushing. For high-throughput
   *   fire-and-forget dispatch.
   */
  waitFor?: 'drained' | 'idle' | 'none'
  /**
   * Quiescence window when `waitFor === 'drained'`. Drain completes when
   * no new update cycle fires for this many ms. Default 100ms — long
   * enough for a localhost HTTP round-trip, short enough to be
   * imperceptible. Ignored for `idle` / `none`.
   */
  drainQuietMs?: number
  /**
   * Hard cap on total wait time. When `waitFor === 'drained'`, this is
   * the upper bound on how long the drain loop can run; if reached, the
   * response carries `drain.timedOut: true` with partial results. For
   * `pending-confirmation` messages, this is how long to wait for
   * the user's confirm/reject. Default 5_000ms.
   */
  timeoutMs?: number
}
```

### `LapMessageRejectReason`

```typescript
export type LapMessageRejectReason =
  | 'humanOnly'
  | 'user-cancelled'
  | 'timeout'
  | 'invalid'
  | 'schema-error'
  | 'revoked'
  | 'paused'
```

### `LapDrainMeta`

Drain metadata attached to `dispatched` / `confirmed` responses.
`effectsObserved` counts update-cycle commits (not individual effects) —
it's a proxy for "how much activity happened during the drain window."
`errors` surfaces sync throws from `onEffect` and unhandled rejections
from effect handlers that fired during the drain window, so the LLM
can see when an HTTP handler crashed silently.

```typescript
export type LapDrainMeta = {
  effectsObserved: number
  durationMs: number
  timedOut: boolean
  errors: Array<{ kind: 'error' | 'unhandledrejection'; message: string; stack?: string }>
}
```

### `LapMessageResponse`

```typescript
export type LapMessageResponse =
  | {
      status: 'dispatched'
      stateAfter: unknown
      actions: LapActionsResponse['actions']
      drain: LapDrainMeta
    }
  | { status: 'pending-confirmation'; confirmId: string }
  | {
      /**
       * The user approved a `pending-confirmation` message. `stateAfter`
       * is the state snapshot captured when the approve was resolved;
       * effects produced by the approved dispatch may still be in
       * flight. The LLM should follow up with an `observe` call to
       * pick up a drained view and fresh actions — by design the
       * confirm path doesn't carry drain semantics because approval
       * can arrive arbitrarily later than the original request.
       */
      status: 'confirmed'
      stateAfter: unknown
    }
  | { status: 'rejected'; reason: LapMessageRejectReason; detail?: string }
```

### `LapConfirmResultRequest`

```typescript
export type LapConfirmResultRequest = { confirmId: string; timeoutMs?: number }
```

### `LapConfirmResultResponse`

```typescript
export type LapConfirmResultResponse =
  | { status: 'confirmed'; stateAfter: unknown }
  | { status: 'rejected'; reason: 'user-cancelled' | 'timeout' }
  | { status: 'still-pending' }
```

### `LapWaitRequest`

```typescript
export type LapWaitRequest = { path?: string; timeoutMs?: number }
```

### `LapWaitResponse`

```typescript
export type LapWaitResponse =
  | { status: 'changed'; stateAfter: unknown }
  | { status: 'timeout'; stateAfter: unknown }
```

### `LapQueryDomRequest`

```typescript
export type LapQueryDomRequest = { name: string; multiple?: boolean }
```

### `LapQueryDomResponse`

```typescript
export type LapQueryDomResponse = {
  elements: Array<{ text: string; attrs: Record<string, string>; path: number[] }>
}
```

### `OutlineNode`

```typescript
export type OutlineNode =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'list'; items: OutlineNode[] }
  | { kind: 'item'; text: string; children?: OutlineNode[] }
  | { kind: 'button'; text: string; disabled: boolean; actionVariant: string | null }
  | { kind: 'input'; label: string | null; value: string | null; type: string }
  | { kind: 'link'; text: string; href: string }
```

### `LapDescribeVisibleResponse`

```typescript
export type LapDescribeVisibleResponse = { outline: OutlineNode[] }
```

### `AgentDocs`

```typescript
export type AgentDocs = {
  purpose: string
  overview?: string
  cautions?: string[]
}
```

### `AgentContext`

```typescript
export type AgentContext = {
  summary: string
  hints?: string[]
  cautions?: string[]
}
```

### `LapContextResponse`

```typescript
export type LapContextResponse = { context: AgentContext }
```

### `LapObserveResponse`

```typescript
export type LapObserveResponse = {
  state: unknown
  actions: LapActionsResponse['actions']
  description: LapDescribeResponse
  context: AgentContext | null
}
```

### `LapEndpointMap`

```typescript
export type LapEndpointMap = {
  '/lap/v1/describe': { req: null; res: LapDescribeResponse }
  '/lap/v1/state': { req: LapStateRequest; res: LapStateResponse }
  '/lap/v1/actions': { req: null; res: LapActionsResponse }
  '/lap/v1/message': { req: LapMessageRequest; res: LapMessageResponse }
  '/lap/v1/confirm-result': { req: LapConfirmResultRequest; res: LapConfirmResultResponse }
  '/lap/v1/wait': { req: LapWaitRequest; res: LapWaitResponse }
  '/lap/v1/query-dom': { req: LapQueryDomRequest; res: LapQueryDomResponse }
  '/lap/v1/describe-visible': { req: null; res: LapDescribeVisibleResponse }
  '/lap/v1/context': { req: null; res: LapContextResponse }
  '/lap/v1/observe': { req: null; res: LapObserveResponse }
}
```

### `LapPath`

```typescript
export type LapPath = keyof LapEndpointMap
```

### `LapRequest`

```typescript
export type LapRequest<P extends LapPath> = LapEndpointMap[P]['req']
```

### `LapResponse`

```typescript
export type LapResponse<P extends LapPath> = LapEndpointMap[P]['res']
```

### `LogKind`

```typescript
export type LogKind =
  | 'proposed'
  | 'dispatched'
  | 'confirmed'
  | 'rejected'
  | 'blocked'
  | 'read'
  | 'error'
```

### `LogEntry`

```typescript
export type LogEntry = {
  id: string
  at: number
  kind: LogKind
  variant?: string
  intent?: string
  detail?: string
}
```

### `HelloFrame`

```typescript
export type HelloFrame = {
  t: 'hello'
  appName: string
  appVersion: string
  msgSchema: Record<string, MessageSchemaEntry>
  stateSchema: object
  affordancesSample: object[]
  docs: AgentDocs | null
  schemaHash: string
}
```

### `RpcReplyFrame`

```typescript
export type RpcReplyFrame = { t: 'rpc-reply'; id: string; result: unknown }
```

### `RpcErrorFrame`

```typescript
export type RpcErrorFrame = { t: 'rpc-error'; id: string; code: string; detail?: string }
```

### `ConfirmResolvedFrame`

```typescript
export type ConfirmResolvedFrame = {
  t: 'confirm-resolved'
  confirmId: string
  outcome: 'confirmed' | 'user-cancelled'
  stateAfter?: unknown
}
```

### `StateUpdateFrame`

```typescript
export type StateUpdateFrame = { t: 'state-update'; path: string; stateAfter: unknown }
```

### `LogAppendFrame`

```typescript
export type LogAppendFrame = { t: 'log-append'; entry: LogEntry }
```

### `ClientFrame`

```typescript
export type ClientFrame =
  | HelloFrame
  | RpcReplyFrame
  | RpcErrorFrame
  | ConfirmResolvedFrame
  | StateUpdateFrame
  | LogAppendFrame
```

### `RpcFrame`

```typescript
export type RpcFrame = { t: 'rpc'; id: string; tool: string; args: unknown }
```

### `RevokedFrame`

```typescript
export type RevokedFrame = { t: 'revoked' }
```

### `ActiveFrame`

```typescript
export type ActiveFrame = { t: 'active' }
```

### `ServerFrame`

```typescript
export type ServerFrame = RpcFrame | RevokedFrame | ActiveFrame
```

### `AgentToken`

```typescript
export type AgentToken = string & { readonly [TokenBrand]: 'AgentToken' }
```

### `TokenStatus`

```typescript
export type TokenStatus =
  | 'awaiting-ws'
  | 'awaiting-claude'
  | 'active'
  | 'pending-resume'
  | 'revoked'
```

### `TokenRecord`

```typescript
export type TokenRecord = {
  tid: string
  uid: string | null
  status: TokenStatus
  createdAt: number
  lastSeenAt: number
  pendingResumeUntil: number | null
  origin: string
  label: string | null
}
```

### `AgentSession`

```typescript
export type AgentSession = {
  tid: string
  label: string
  status: 'active' | 'pending-resume' | 'revoked'
  createdAt: number
  lastSeenAt: number
}
```

### `MintRequest`

```typescript
export type MintRequest = Record<string, never>
```

### `MintResponse`

```typescript
export type MintResponse = {
  token: AgentToken
  tid: string
  wsUrl: string
  lapUrl: string
  expiresAt: number
}
```

### `ResumeListRequest`

```typescript
export type ResumeListRequest = { tids: string[] }
```

### `ResumeListResponse`

```typescript
export type ResumeListResponse = { sessions: AgentSession[] }
```

### `ResumeClaimRequest`

```typescript
export type ResumeClaimRequest = { tid: string }
```

### `ResumeClaimResponse`

```typescript
export type ResumeClaimResponse = { token: AgentToken; wsUrl: string }
```

### `RevokeRequest`

```typescript
export type RevokeRequest = { tid: string }
```

### `RevokeResponse`

```typescript
export type RevokeResponse = { status: 'revoked' }
```

### `SessionsResponse`

```typescript
export type SessionsResponse = { sessions: AgentSession[] }
```

### `AuditEvent`

```typescript
export type AuditEvent =
  | 'mint'
  | 'claim'
  | 'resume'
  | 'revoke'
  | 'lap-call'
  | 'msg-dispatched'
  | 'msg-blocked'
  | 'confirm-proposed'
  | 'confirm-approved'
  | 'confirm-rejected'
  | 'rate-limited'
  | 'auth-failed'
```

### `AuditEntry`

```typescript
export type AuditEntry = {
  at: number
  tid: string | null
  uid: string | null
  event: AuditEvent
  detail: object
}
```

## Interfaces

### `TokenStore`

Append-only, read-friendly storage for token records. See spec §10.3.

```typescript
export interface TokenStore {
  create(record: TokenRecord): Promise<void>
  findByTid(tid: string): Promise<TokenRecord | null>
  listByIdentity(uid: string): Promise<TokenRecord[]>
  touch(tid: string, now: number): Promise<void>
  markPendingResume(tid: string, until: number): Promise<void>
  /** Transition to awaiting-claude: browser WS is connected, waiting for Claude's first call. */
  markAwaitingClaude(tid: string, now: number): Promise<void>
  markActive(tid: string, label: string, now: number): Promise<void>
  revoke(tid: string): Promise<void>
}
```

### `RateLimiter`

```typescript
export interface RateLimiter {
  check(key: string, bucket: 'token' | 'identity'): Promise<RateLimitResult>
}
```

### `PairingConnection`

Thin abstraction over a single paired WebSocket. Consumed by the
registry implementations; runtime-specific adapters (`ws`-lib,
`WebSocketPair`, `Deno.upgradeWebSocket`, `Bun.serve` upgrade) build
one of these and pass it to `registry.register()`.

```typescript
export interface PairingConnection {
  send(frame: ServerFrame): void
  onFrame(handler: (f: ClientFrame) => void): void
  onClose(handler: () => void): void
  close(): void
}
```

### `PairingRegistry`

Registry of live browser pairings. Pure routing + hello cache —
request-lifecycle state (in-flight RPC promises, confirm waits,
long-polls) lives in the LAP handlers that need it, not here.
Two implementations ship today:

- `InMemoryPairingRegistry` for long-lived server processes
  (Node, Bun, Deno, Deno Deploy).
- A Cloudflare Durable Object implementation (see
  `server/cloudflare`) for stateless Worker runtimes.
  Other runtimes can implement this interface the same way; the
  contract is intentionally small.

```typescript
export interface PairingRegistry {
  // ── Routing primitives ─────────────────────────────────────────
  register(tid: string, conn: PairingConnection): void
  unregister(tid: string): void
  isPaired(tid: string): boolean
  getHello(tid: string): HelloFrame | null
  /** Send a frame. No-op when the pairing is absent or closed. */
  send(tid: string, frame: ServerFrame): void
  /**
   * Subscribe to frames from the paired browser. Returns an
   * unsubscribe function. A subscriber can remove itself mid-dispatch
   * by returning `true` from its callback — useful for one-shot
   * request/response correlation.
   */
  subscribe(tid: string, handler: FrameSubscriber): () => void
  /**
   * Observe the pairing closing (WebSocket drop, `unregister`, etc.).
   * Handlers registered before close fire; handlers registered after
   * close fire synchronously. Returns an unsubscribe function.
   */
  onClose(tid: string, handler: () => void): () => void

  // ── Request/response helpers ───────────────────────────────────
  // These are part of the contract (LAP handlers call them directly)
  // but implementations almost always delegate to the free helpers in
  // `./rpc.ts`, which are built on the routing primitives above. The
  // Cloudflare Durable Object registry uses the same helpers; the
  // split exists so the routing surface is small enough to implement
  // across stateful boundaries (DO storage, WebSocket hibernation),
  // while the correlation logic lives once in a runtime-neutral file.

  /**
   * Send a typed rpc frame and await its matching reply. See
   * `./rpc.ts::rpc` for the full contract.
   */
  rpc(tid: string, tool: string, args: unknown, opts?: RpcOptions): Promise<unknown>
  /** See `./rpc.ts::waitForConfirm`. */
  waitForConfirm(
    tid: string,
    confirmId: string,
    timeoutMs: number,
  ): Promise<{ outcome: 'confirmed' | 'user-cancelled'; stateAfter?: unknown }>
  /** See `./rpc.ts::waitForChange`. */
  waitForChange(
    tid: string,
    path: string | undefined,
    timeoutMs: number,
  ): Promise<{ status: 'changed' | 'timeout'; stateAfter: unknown }>
}
```

### `MinimalDurableObjectNamespace`

Minimal DurableObjectNamespace surface we need — `idFromName` +
`get` returning a `Stub` with `fetch(req)`. Kept structural so we
don't depend on `@cloudflare/workers-types` (the user's project has
them; we shouldn't duplicate).

```typescript
export interface MinimalDurableObjectNamespace {
  idFromName(name: string): MinimalDurableObjectId
  get(id: MinimalDurableObjectId): MinimalDurableObjectStub
}
```

### `MinimalDurableObjectId`

```typescript
export interface MinimalDurableObjectId {
  // Opaque, but DO ids are passed back into `namespace.get()`.
  readonly name?: string
}
```

### `MinimalDurableObjectStub`

```typescript
export interface MinimalDurableObjectStub {
  fetch(req: Request): Promise<Response>
}
```

## Classes

### `InMemoryTokenStore`

```typescript
class InMemoryTokenStore implements TokenStore {
  byTid
  create(record: TokenRecord): Promise<void>
  findByTid(tid: string): Promise<TokenRecord | null>
  listByIdentity(uid: string): Promise<TokenRecord[]>
  touch(tid: string, now: number): Promise<void>
  markPendingResume(tid: string, until: number): Promise<void>
  markAwaitingClaude(tid: string, now: number): Promise<void>
  markActive(tid: string, label: string, now: number): Promise<void>
  revoke(tid: string): Promise<void>
}
```

### `InMemoryPairingRegistry`

Single-process in-memory registry. Correct for Node/Bun/Deno/Deno
Deploy — anywhere the server process can hold a long-lived
WebSocket. Not suitable for stateless Worker isolates; use the
Durable Object registry for Cloudflare.

```typescript
class InMemoryPairingRegistry implements PairingRegistry {
  pairings
  onLogAppend: ((tid: string, entry: LogEntry) => void) | null
  constructor(
    opts: {
      onLogAppend?: (tid: string, entry: LogEntry) => void
    } = {},
  )
  register(tid: string, conn: PairingConnection): void
  unregister(tid: string): void
  isPaired(tid: string): boolean
  getHello(tid: string): HelloFrame | null
  send(tid: string, frame: ServerFrame): void
  subscribe(tid: string, handler: FrameSubscriber): () => void
  onClose(tid: string, handler: () => void): () => void
  dispatch(tid: string, frame: ClientFrame): void
  rpc(tid: string, tool: string, args: unknown, opts: RpcOptions = {}): Promise<unknown>
  waitForConfirm(
    tid: string,
    confirmId: string,
    timeoutMs: number,
  ): Promise<{ outcome: 'confirmed' | 'user-cancelled'; stateAfter?: unknown }>
  waitForChange(
    tid: string,
    path: string | undefined,
    timeoutMs: number,
  ): Promise<{ status: 'changed' | 'timeout'; stateAfter: unknown }>
  notify(tid: string, frame: ServerFrame): void
  handleClose(tid: string): void
}
```

### `AgentPairingDurableObject`

Agent server instance scoped to a single Durable Object. All
pairing state lives in the DO's in-process memory — which is safe
here because the DO is a persistent addressable entity, not a
one-shot Worker isolate.
Users instantiate one of these inside their DO class's constructor
and delegate `fetch` to `agent.fetch(req)`. LAP HTTP routes and
WebSocket upgrades both flow through this single entry.

```typescript
class AgentPairingDurableObject {
  agent: AgentCoreHandle
  constructor(opts: DurableObjectOptions)
  fetch(req: Request): Promise<Response>
}
```

## Constants

### `WsPairingRegistry`

Back-compat alias for the prior class name. New code should use
`InMemoryPairingRegistry`. Removed in a future major.
@deprecated Use `InMemoryPairingRegistry` directly.

```typescript
const WsPairingRegistry
```

<!-- auto-api:end -->
