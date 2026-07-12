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

Restart Claude Desktop. The `connect_session`, `observe`, `send_message`, and related tools will appear in the tool picker.

### 4. Connect

Open your app (`vite dev`), use the in-app UI to mint a token (the `agentConnect` slice provides the state machine — render a button that dispatches `{ type: 'agent', sub: 'connect', msg: { type: 'RequestMint' } }`), copy the resulting `/llui-connect <url> <token>` command, and paste it into your Claude conversation. Claude calls `connect_session`, then `observe`, and you're live.

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

### `computeStateDiff()`

Compute the diff. Order of operations: removes first, then adds,
then replaces. This is RFC 6902's recommended order — the receiver
can apply ops sequentially without ambiguity.
The implementation is a simple recursive walk; collection diffs
are positional (index-based for arrays, key-based for objects)
rather than structural (no LCS). Apps that pass identity-stable
collections (`[...prev, item]`-style appends) get clean diffs;
apps that rebuild arrays from scratch get noisy ones — same
tradeoff a React reconciler makes, and the same fix (stable keys

- push-don't-rebuild updates) applies.

```typescript
function computeStateDiff(prev: unknown, next: unknown): StateDiff
```

### `createAgentClient()`

```typescript
function createAgentClient<State, Msg>(opts: CreateAgentClientOpts<State, Msg>): AgentClient
```

### `createLluiAgentCore()`

Compose the runtime-neutral agent server. The returned handle has
everything the LAP HTTP routes and the WebSocket acceptance
plumbing need; runtime adapters wire the native upgrade API on
top (see `@llui/agent/server` for Node, `@llui/agent/server/web`
for WHATWG runtimes).

```typescript
function createLluiAgentCore(opts: CoreOptions = {}): AgentCoreHandle
```

### `createLluiAgentServer()`

Node adapter. Wraps the runtime-neutral core with a Node-specific
`wsUpgrade` handler that uses the `ws` library. Imports `ws`
eagerly, so this module only works where `ws` is available — use
`@llui/agent/server/web` for Cloudflare Workers, Deno, or other
WHATWG runtimes.
Spec §10.1, §10.4.

```typescript
function createLluiAgentServer(opts: ServerOptions = {}): AgentServerHandle
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

### `decodeFromWire()`

Recursively walk `value`. For any tagged shape `{ __codec, wire }`,
look up the codec by name and replace with the decoded runtime
value. Tagged shapes whose codec name is unknown pass through
untouched so the consumer can inspect them directly.

```typescript
function decodeFromWire(value: unknown, registry: CodecRegistry): unknown
```

### `defaultIdentityResolver()`

```typescript
function defaultIdentityResolver(cfg: IdentityCookieConfig): IdentityResolver
```

### `defaultRateLimiter()`

```typescript
function defaultRateLimiter(cfg: RateLimitConfig, now: () => number = () => Date.now()): RateLimiter
```

### `describeOp()`

Per-op short verb + readable path. Useful for a flat detail view:

- `{ op: 'replace', path: '/cart/total', value: 9 }` → `'changed cart.total'`
- `{ op: 'add',     path: '/items/3' }` → `'added items.3'`
- `{ op: 'remove',  path: '/items/3' }` → `'removed items.3'`
- `{ op: 'replace', path: '/' }` → `'replaced state'`
  The path is converted from JSON-Pointer to dotted form (with
  `~0`/`~1` un-escaping) so it reads as a plain field accessor.

```typescript
function describeOp(op: JsonPatchOp): string
```

### `detectSchemaChange()`

Compare a freshly-fetched app description against the cached one and
decide whether the cached schema is now stale. A changed `schemaHash`
means the app's Msg/State schema was recompiled — cached
affordances/examples/payload shapes may no longer be valid, so the
caller is told to re-read before dispatching. Exported so the
invalidation policy is unit-testable in isolation.

```typescript
function detectSchemaChange(
  prev: LapDescribeResponse | null,
  next: Pick<LapDescribeResponse, 'schemaHash'>,
): { changed: boolean; note: string | null }
```

### `encodeForWire()`

Recursively walk `value`. For any node a codec claims via
`matchesRuntime`, replace it with `{ __codec, wire }`. Returns a
fresh structure — never mutates the input.
The codec match takes precedence over object/array recursion: a
`Date` is technically `typeof === 'object'`, but the iso-date codec
should claim it before the generic walker tries to enumerate keys.

```typescript
function encodeForWire(value: unknown, registry: CodecRegistry): unknown
```

### `errorResult()`

```typescript
function errorResult(msg: string): CallToolResult
```

### `executeConnect()`

Shared tail of `connect_session`, after each surface has recorded its
own binding (bridge: url+token; server: tid+token). Prefetch the
`/observe` bundle so the LLM gets `{state, actions, description,
context}` in one call — no follow-up `observe` / `describe_app` /
`get_state` / `list_actions` on the first turn — cache the
description, and return the connected result. On failure, `onFailure`
unwinds the binding the caller set.

```typescript
function executeConnect(
  call: LapCaller,
  cache: DescribeCache,
  onFailure: () => void,
): Promise<CallToolResult>
```

### `executeForwardedTool()`

Run one forwarded tool: serve `describe_app` from cache when warm,
otherwise dispatch to LAP, then cache + schemaHash-diff the
description-bearing responses (`describe_app`, `observe`) so a
mid-session recompile is surfaced to the LLM.

```typescript
function executeForwardedTool(
  desc: McpForwardedToolDescriptor,
  args: object,
  call: LapCaller,
  cache: DescribeCache,
): Promise<CallToolResult>
```

### `extractToken()`

Extract the bearer token from a LAP WebSocket upgrade request.
Accepts the token on either `?token=` or `Authorization: Bearer` —
query-string is the common pattern because browsers can't set
arbitrary headers on WebSocket construction.

```typescript
function extractToken(req: Request): string | null
```

### `groupDiff()`

```typescript
function groupDiff(diff: StateDiff | undefined | null): DiffGroup[]
```

### `handleCloudflareUpgrade()`

Cloudflare Workers handler. Accepts a WebSocket upgrade using
`WebSocketPair`, validates the token via
`agent.acceptConnection`, and returns the 101 upgrade Response.
Usage:

```ts
const agent = createLluiAgentCore()
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

### `makeDefaultCodecs()`

```typescript
function makeDefaultCodecs(): CodecRegistry
```

### `mintToken()`

Mint an opaque random bearer token + the SHA-256 hash the server
stores as a lookup key. Tokens are 32 bytes of CSPRNG entropy (256
bits) base64url-encoded with the `agt_` prefix — total ~48 chars.
The prefix is intentionally generic so LLM clients don't mistake the
token format for a hint about which MCP tool namespace to use.
The token itself never persists; only the hash does. A leaked store
therefore does not compromise live tokens, since the bearer secret
isn't recoverable from the hash. This matches the standard "session
cookie / API key" pattern.
The opaque form is the only token format the server understands as
of 0.0.35. The previous HMAC-signed JWT format is gone; clients
carrying old tokens will fail with `unknown` on first call and need
to remint. See CHANGELOG.

```typescript
function mintToken(): Promise<{ token: AgentToken; tokenHash: string }>
```

### `okResult()`

`structuredContent` is what current Claude clients (Desktop + Claude
Code) consume preferentially when present — typed JSON instead of a
stringified blob. The `content` array stays as a `text` fallback so
older clients still see something sensible.

```typescript
function okResult(body: unknown): CallToolResult
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
  underlying primitives directly.
  As of 0.0.35 the token format is opaque (random, not signed), so we
  can't recover `tid` from the token alone. The caller passes a
  `resolveTid` callback — typically `(token) => stub.fetch(...)` to
  the root DO's token-resolution endpoint — that turns a bearer into
  its tid via the shared token store. Callers that don't shard by
  tid can pass `() => Promise.resolve(rootName)` to route everything
  through the root DO.

```typescript
function routeToAgentDO(
  req: Request,
  namespace: MinimalDurableObjectNamespace,
  resolveTid: (token: string) => Promise<string | null>,
  opts: { rootName?: string; mcpPath?: string } = {},
): Promise<Response>
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

### `signCookieValue()`

Async because `crypto.subtle.sign` is the cross-runtime standard.
Callers building a `Set-Cookie` header must `await` this.

```typescript
function signCookieValue(value: string, signingKey: string | Uint8Array): Promise<string>
```

### `summarizeDiff()`

One-line summary of the entire diff. Examples:

- `[{ op: 'replace', path: '/cart/total', value: 9 }]`
  → "1 field changed"
- `[{ op: 'add', path: '/items/-' }, { op: 'add', path: '/items/-' }]`
  → "2 items added"
- mixed adds/removes/replaces across multiple regions
  → "5 changes across 3 regions"
  The summary collapses multiple ops on the same logical path
  (e.g. updating multiple fields on the same item) into a single
  "change" — counting raw op entries would surface implementation
  detail (which JSON-Patch ops the differ emitted), not user-relevant
  counts.

```typescript
function summarizeDiff(diff: StateDiff | undefined | null): string
```

### `tokenHashOf()`

Compute the SHA-256 hash of a presented bearer token. Returns `null`
when the prefix is missing — the verify path uses that to fail-fast
on garbage-shaped Authorization headers without a crypto round-trip.
Hash is hex-encoded for portability across stores (Postgres `text`,
KV string, etc.).

```typescript
function tokenHashOf(token: string): Promise<string | null>
```

### `waitForChange()`

Long-poll for a state change under `path` (a JSON pointer; `undefined`
watches the whole state). Used by `/lap/v1/wait` for external state
pushes (WebSocket messages, timers) arriving while the LLM is idle.
Subscription-driven: the server ARMS a `watch { id, path }` on the
browser, which then emits a `state-update` carrying that `id` only
when the pointer's resolved value actually changes — so an idle
session ships nothing per commit, and a path-scoped wait matches the
right change (the old `/`-broadcast-plus-prefix scheme could never
match a specific path). We correlate strictly by `id`, disarm the
watch (`unwatch`) whichever way the poll settles, and return the full
`stateAfter` snapshot the browser sent.

```typescript
function waitForChange(
  registry: PairingRegistry,
  tid: string,
  path: string | undefined,
  timeoutMs: number,
): Promise<{ status: 'changed' | 'timeout'; stateAfter: unknown }>
```

### `waitForConfirm()`

Await a `confirm-resolved` frame for the given `confirmId`. Three-way:

- `confirmed` — the user approved (carries `stateAfter`).
- `user-cancelled` — the user explicitly rejected.
- `timeout` — no resolution arrived in `timeoutMs`, or the
  pairing dropped before one did.
  Timeout is reported HONESTLY as `timeout` (not as a fake
  `user-cancelled`): the confirm is still live in the browser and a
  later approval may still fire, so callers must surface
  `pending-confirmation` / `still-pending` rather than lie about a
  rejection. Pairing drop maps to `timeout` for the same reason — the
  user wasn't present to cancel, they simply weren't reachable.
  LEVEL-TRIGGERED. The browser emits `confirm-resolved` exactly once.
  `/message` and `/confirm-result` long-poll in series: each tears its
  subscriber down on timeout, and the next re-arms a fresh one. If the
  user approves in that inter-poll gap, an edge-triggered subscriber
  would miss the frame forever (the action ran but the agent polls
  `still-pending` indefinitely). To close that gap, the registry buffers
  every `confirm-resolved` outcome keyed by `confirmId` with a TTL, and
  this helper checks that buffer BEFORE subscribing — returning
  immediately when the resolution already arrived.

```typescript
function waitForConfirm(
  registry: PairingRegistry,
  tid: string,
  confirmId: string,
  timeoutMs: number,
): Promise<ConfirmWaitResult>
```

## Types

### `AcceptResult`

```typescript
export type AcceptResult =
  | { ok: true; tid: string }
  | { ok: false; status: number; code: 'auth-failed' | 'revoked' }
```

### `ActiveFrame`

```typescript
export type ActiveFrame = { t: 'active' }
```

### `AgentClient`

```typescript
export type AgentClient = {
  effectHandler: (effect: AgentEffect) => Promise<void>
  start(): void
  stop(): void
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
   * Origin allowlist for WebSocket upgrades (CSWSH defense), mirroring
   * the `corsOrigins` core option. `undefined`/empty means same-origin
   * only. Runtime upgrade adapters (`web/upgrade.ts`, the Node
   * `wsUpgrade`) read this to validate the handshake `Origin`.
   */
  allowedOrigins?: readonly string[]
  /**
   * Sliding (inactivity) TTL in ms, mirroring the `slidingTtlMs` core
   * option. The WS upgrade adapters apply this on acceptance via
   * `acceptConnection`, which already enforces it server-side.
   */
  slidingTtlMs?: number
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

### `AgentDocs`

```typescript
export type AgentDocs = {
  purpose: string
  overview?: string
  cautions?: string[]
  /**
   * Free-form idiomatic-usage examples authored by the app: typical
   * sequences of dispatches the LLM should know about, like "to
   * delete a saved matrix: dispatch Confirm/Ask first, then on
   * approve dispatch Cloud/Delete." Each entry is one example;
   * order is up to the author.
   */
  examples?: string[]
}
```

### `AgentEffect`

```typescript
export type AgentEffect =
  /**
   * Mint a fresh agent token. `mintUrl` is optional — when omitted the
   * effect handler derives it from `EffectHandlerHost.agentBasePath`
   * (default `/agent`), producing `<agentBasePath>/mint`. Pass an
   * explicit value when the mint endpoint lives outside the configured
   * base path.
   */
  | { type: 'AgentMintRequest'; mintUrl?: string }
  | { type: 'AgentOpenWS'; token: AgentToken; wsUrl: string }
  | { type: 'AgentCloseWS' }
  | { type: 'AgentResumeCheck'; tids: string[] }
  | { type: 'AgentResumeClaim'; tid: string }
  | { type: 'AgentRevoke'; tid: string }
  | { type: 'AgentSessionsList' }
  | { type: 'AgentForwardMsg'; payload: unknown }
  // Handler reads `text` (no state lookup needed at handler time —
  // update() resolved it from the current state.pendingToken). Lets
  // the static-bag `connect()` shape avoid leaking state-reads into
  // event handlers.
  | { type: 'AgentClipboardWrite'; text: string }
  /**
   * Persist active session credentials so a page refresh can restore
   * the same WS without re-minting (and without invalidating the
   * agent's token via the rotate-on-resume path). Hosts typically
   * write to `sessionStorage` so the credentials are tab-scoped:
   * survive refresh, die on tab close. The framework emits this on
   * `MintSucceeded`; the matching `AgentSessionClear` is emitted on
   * `Revoke` of the active tid. Hosts that don't implement the
   * persist/restore loop can ignore both — the rest of the connect
   * lifecycle still works (the page just falls back to "mint a new
   * session" after refresh, same as before this effect existed).
   */
  | {
      type: 'AgentSessionPersist'
      token: AgentToken
      tid: string
      lapUrl: string
      wsUrl: string
      expiresAt: number
    }
  | { type: 'AgentSessionClear' }
  /**
   * Schedule the next WS-reconnect attempt. The handler waits
   * `delayMs` and dispatches `ReconnectAttempt { elapsedMs: delayMs }`
   * back into the reducer, which decides whether to re-open the WS
   * or transition to `failed` based on the cumulative wait. The
   * delay schedule itself is computed reducer-side from
   * `reconnectAttempt` — this effect is a thin setTimeout wrapper.
   *
   * The handler doesn't track cancellation: if the user dispatches
   * `Disconnect` while the timer is pending, the reducer transitions
   * to `idle` and the subsequent `ReconnectAttempt` becomes a no-op
   * via the status guard. Simpler than coordinating cancel handles.
   */
  | { type: 'AgentReconnectSchedule'; delayMs: number }
  /**
   * Auto-clear the `agentAttention` spotlight after `delayMs`. The
   * handler waits and dispatches `Clear { entryId }` back into the
   * attention slice via `wrapAgentAttention`. The clear is conditional
   * (matches `entryId` against `latestDispatch.entryId` in the reducer),
   * so a fast follow-up dispatch isn't wiped by the previous dispatch's
   * pending timer — same race-avoidance pattern as
   * `AgentReconnectSchedule`'s status guard.
   *
   * No cancel handle: the handler is a thin `setTimeout` wrapper. If
   * the host doesn't wire `wrapAttentionMsg` in the factory, the
   * handler no-ops and the spotlight stays set until the next dispatch
   * overwrites it (graceful degradation — the activity log still
   * works, just without auto-clearing visual highlights).
   */
  | { type: 'AgentAttentionFlashTimeout'; entryId: string; delayMs: number }
```

### `AgentEffectHandler`

```typescript
export type AgentEffectHandler = (effect: AgentEffect) => Promise<void>
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

### `AgentToken`

```typescript
export type AgentToken = string & { readonly [TokenBrand]: 'AgentToken' }
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

### `AuditSink`

```typescript
export type AuditSink = {
  write: (entry: AuditEntry) => void | Promise<void>
}
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

### `ConfirmExpireFrame`

Server → browser: abandon a pending confirmation. Sent when the server
has told the agent a confirm is terminally `rejected` (user-cancelled)
so a late user Approve on that same `confirmId` can no longer fire a
dispatch the agent was told would never run. The browser marks the
matching pending confirm entry rejected (idempotent — no-op if already
resolved). Distinct from `revoked` (which kills the whole session).

```typescript
export type ConfirmExpireFrame = { t: 'confirm-expire'; confirmId: string }
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

### `CoreOptions`

Options accepted by `createLluiAgentCore`. Strict subset of
`ServerOptions` — everything needed to build the router, registry,
and accept-connection primitive. The Node factory adds WebSocket
upgrade wiring on top.

```typescript
export type CoreOptions = {
  tokenStore?: TokenStore
  identityResolver?: IdentityResolver
  auditSink?: AuditSink
  rateLimiter?: RateLimiter
  lapBasePath?: string
  /**
   * Allow minting tokens for unauthenticated callers (identity resolves
   * to `null`). SECURITY: defaults to `false` (fail closed). See
   * `MintDeps.allowAnonymous`.
   */
  allowAnonymous?: boolean
  /**
   * Sliding (inactivity) TTL in ms. When set, a token unused for longer
   * than this is rejected on every verify (LAP/MCP and WS upgrade) even
   * before its hard expiry. Undefined / `0` disables the check.
   */
  slidingTtlMs?: number
  /**
   * Allowed `Origin` allowlist for WebSocket upgrades (CSWSH defense).
   * Unset → same-origin only. Stored on the returned handle as
   * `allowedOrigins` for the runtime upgrade adapters to enforce.
   */
  corsOrigins?: readonly string[]
  /**
   * Override the default `InMemoryPairingRegistry`. Web runtimes that
   * need a different pairing implementation (e.g. a Cloudflare
   * Durable Object that persists across isolates) pass it here.
   */
  registry?: PairingRegistry
  /**
   * How long, in milliseconds, a token's record stays in
   * `pending-resume` after the WS pairing closes. During this window
   * the same browser can reconnect with the same bearer token and
   * the WS re-pairs without going through the rotate-on-resume path
   * (`/resume/claim`). The agent's existing token stays valid the
   * whole time, so brief network drops, page reloads, and quick
   * server restarts don't invalidate the agent's session.
   *
   * After the window, LAP calls report `X-LLui-Reconnect: expired`
   * and the record becomes resume-claimable (rotation required).
   * Set to `0` to opt out — the WS close immediately drops the
   * record and any reconnect must go through `/resume/claim`.
   *
   * Default: 60 seconds — long enough for laptop sleep, brief Wi-Fi
   * flicker, and a server restart; short enough that a deliberately-
   * closed tab doesn't keep the record alive forever.
   */
  pendingResumeGraceMs?: number
}
```

### `CreateAgentClientOpts`

```typescript
export type CreateAgentClientOpts<State, Msg> = {
  handle: SignalComponentHandle<State, unknown>
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
    /**
     * Optional: wrap an agentAttention msg so the visual-attention
     * slice can clear its spotlight on the auto-clear timer. Hosts
     * that wire `agentAttention` should set this; hosts that don't
     * leave it unset and the spotlight (which they aren't rendering)
     * never matters. The factory uses it for the reverse direction
     * too: `onLogEntry` re-dispatches the same `Append { entry }`
     * payload into the attention slice when wired, so a single
     * incoming `log-append` frame fans out to both slices without
     * the host needing to write the routing.
     */
    wrapAttentionMsg?: (m: unknown) => Msg
  }
  /**
   * Codec registry for non-JSON-safe values (Date, Blob, Map, …)
   * crossing the LAP boundary. Defaults to `makeDefaultCodecs()`
   * which ships `iso-date` and `epoch-millis`. Provide a custom
   * registry to register additional codecs (e.g. `base64-blob` for
   * file uploads). See `@llui/agent/codecs` for the convention.
   */
  codecs?: CodecRegistry
  /**
   * Redaction hook applied to app state **at the source**, before any
   * snapshot leaves the browser for the agent/LLM. Runs on every
   * wire-bound read — `get_state`/`observe`/`query_state`, the
   * per-change `state-update` broadcast, and confirm-resolution
   * snapshots — so a secret omitted here never transits the WS, the
   * server, or the model. Return a redacted COPY (do not mutate the
   * input); the reducer/app keep the real state. Omit fields, mask
   * values, or return `{}` to withhold state entirely. This is the
   * only place that can use the app's own knowledge of which fields
   * are sensitive — prefer it over any downstream/server-side filter.
   */
  redactState?: (state: State) => State
  /**
   * Payload-validation policy for agent `send_message` dispatches.
   * `'strict'` rejects payload fields not in the compiled schema and
   * warns on `'unknown'`-typed fields the agent supplied a value for;
   * `'lenient'` (default) accepts extras silently. Wired through to the
   * per-dispatch validator so strict mode is usable in production, not
   * only in tests.
   */
  dispatchPolicy?: 'strict' | 'lenient'
  /**
   * Base path for agent HTTP endpoints. Default: `'/agent'` (matches
   * the canonical paths in `@llui/vite-plugin`'s dev middleware and
   * `@llui/agent/server`). The mint URL, resume URLs, and revoke URL
   * derive from this so consumers don't have to keep them in sync.
   *
   * Override when:
   *   - **Cross-origin agent server**: pass the full base, e.g.
   *     `'https://api.example.com/agent'` or `'http://localhost:8787/agent'`.
   *   - **`@cloudflare/vite-plugin` in dev**: pass `'/cdn-cgi/agent'`
   *     because cloudflare-vite shadows non-`/cdn-cgi/*` routes.
   */
  agentBasePath?: string
  /**
   * Storage adapter for the active session blob. When provided the
   * framework owns the persist/restore loop end-to-end: writes on
   * `MintSucceeded`, reads on `start()` (auto-dispatching
   * `RestoreSession` when a non-expired blob is found), clears on
   * `Disconnect` / `Revoke` / explicit clear effects.
   *
   * Default: `defaultSessionStorage()` — uses `window.sessionStorage`
   * under the key `'llui-agent:session'`. Tab-scoped (survives
   * refresh, dies on tab close), which matches how a single-tab
   * agent connection should behave.
   *
   * Pass `null` to opt out entirely; the framework then emits the
   * `AgentSessionPersist` / `AgentSessionClear` effects unchanged
   * and the host owns storage. Useful for SSR builds where
   * `sessionStorage` is undefined and the host wants to no-op the
   * storage layer.
   *
   * Pass a custom adapter for tests, IndexedDB-backed apps, or
   * environments where `sessionStorage` is unavailable but the
   * persistence semantics are still wanted (e.g. Web Workers).
   */
  sessionStorage?: AgentSessionStorage | null
}
```

### `DiffGroup`

Per-top-level-path breakdown. Returns an array (stable order) where
each entry describes the changes affecting one top-level region.
Useful for a sidecar that wants to render a row per region with the
affected fields beneath it.
The returned `paths` are the FULL JSON-Pointer paths of the ops, so
a consumer can render "/items/3/name" verbatim or further humanize
it. The renderer doesn't make policy choices about how deeply to
label — that's the host's call.

```typescript
export type DiffGroup = {
  /** Top-level state field, or `'*'` for whole-state replace. */
  region: string
  adds: number
  removes: number
  replaces: number
  /** Full op paths in arrival order. */
  paths: string[]
}
```

### `DispatchMode`

Who can dispatch a Msg variant.

- `'shared'` (default) — both UI bindings and the agent can dispatch.
- `'human-only'` — UI-only. Agent calls to `/message` for these variants
  are rejected with `LapMessageRejectReason: 'human-only'`. Use for
  internal UI events (focus/blur, scroll, hover) the LLM has no business
  triggering.
- `'agent-only'` — no UI binding exists. Reserved for LLM-driven flows
  like batch operations or "explain this state" introspection variants.
  Lint warns if a view references one via `send({ type: 'X' })`.
  JSDoc sugar: `@humanOnly` → `'human-only'`, `@agentOnly` → `'agent-only'`.
  Absence of either tag → `'shared'`. The two tags are mutually exclusive
  (enforced by `llui/agent-exclusive-annotations` ESLint rule).

```typescript
export type DispatchMode = 'shared' | 'human-only' | 'agent-only'
```

### `DurableObjectOptions`

```typescript
export type DurableObjectOptions = Omit<CoreOptions, 'registry'> & {
  /**
   * Enable the server-side MCP endpoint at `/agent/mcp` (or a custom
   * path). Pass `true` for all defaults, or an `McpRouterOptions`
   * object to customise path, server name, and connect_session
   * description.
   */
  mcp?: boolean | McpRouterOptions
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
  /**
   * LAP wire-protocol version the browser runtime speaks (see
   * {@link LAP_VERSION}). Optional so an older client that predates
   * versioning (which omits it) is still routable — the server treats a
   * missing value as "unknown/legacy" and logs it.
   */
  lapVersion?: number
}
```

### `IdentityResolver`

```typescript
export type IdentityResolver = (req: Request) => Promise<string | null>
```

### `JsonPatchOp`

Compute a structural diff between two state snapshots and return it
in JSON-Patch-shaped form (RFC 6902 subset: `add`, `remove`,
`replace`).
Why JSON Patch shape: LLMs see this exact format in their training
data — it's the standard for describing object mutations on the
wire. The agent learns the schema implicitly and can answer "what
changed?" in a sentence by reading the ops.
Why not unified-diff or per-binding dirty masks: the dirty mask
tracks what bindings need re-rendering, which is a layout concern.
The agent wants to know what _values_ changed, which is a state
concern. Dirty masks miss field-level resolution; per-path JSON
Patch gives it.
Cost is O(state size) per dispatch. For typical app states (a few
KB) that's microseconds. Apps with very large states (collections
of thousands of items) should subscribe to specific slices via
`query_state` / `wait_for_change` instead of reading full diffs.
Path escaping follows JSON Pointer (RFC 6901): `/` becomes `~1`,
`~` becomes `~0`. The escape happens per-segment.

```typescript
export type JsonPatchOp =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown }
```

### `LapActionsResponse`

```typescript
export type LapActionsResponse = {
  actions: Array<{
    variant: string
    /**
     * Human-readable phrase from `@intent("…")`, or `null` when the
     * variant has no `@intent` annotation. Callers that surface
     * affordances to an LLM should treat `null` as "this action is
     * undocumented" — neither synthesise a label from the variant name
     * nor invent one. Pre-`@intent` variants would previously surface
     * as `intent: "<variant>"` here, which made unannotated actions
     * indistinguishable from properly-labelled ones; emitting `null`
     * keeps the gap visible.
     */
    intent: string | null
    requiresConfirm: boolean
    /**
     * `'shared'` — both UI and agent can dispatch. `'agent-only'` — no UI
     * binding exists; the agent is the sole dispatcher. `'human-only'`
     * variants never appear here (filtered before serialization).
     */
    dispatchMode: 'shared' | 'agent-only'
    /**
     * Where this affordance came from:
     *   - `'binding'`           — a tagged event handler is currently
     *     mounted in the rendered DOM.
     *   - `'always-affordable'` — the app's `agentAffordances(state)`
     *     hook listed it as available right now.
     *   - `'schema'`            — neither of the above; the variant
     *     is in the Msg union and annotated `@agentOnly`. The
     *     `payloadHint` carries a synthesized example from the
     *     compiler-derived field types — copy-paste-ready for
     *     `send_message`. Bulk-edit operations land here.
     */
    source: 'binding' | 'always-affordable' | 'schema'
    selectorHint: string | null
    payloadHint: object | null
    /**
     * Whether the action can be dispatched right now. Omitted (treated as
     * `true`) for reachable actions. `false` for a variant whose
     * `@routeGated` predicate is currently falsy — it's surfaced (so the
     * agent knows it exists and what unblocks it) rather than hidden.
     * Pair with `unavailableReason`.
     */
    available?: boolean
    /**
     * Why an `available: false` action can't be dispatched now — from the
     * `@routeGated` reason (its optional 2nd arg), or a generic fallback.
     * Null/absent for available actions.
     */
    unavailableReason?: string | null
    /** Cautionary text from `@warning` JSDoc, or null. */
    warning: string | null
    /** Concrete examples from `@example` JSDoc, in source order. */
    examples: string[]
    /**
     * Effect kinds this variant emits, from `@emits("k1", "k2")`.
     * Empty when not annotated.
     */
    emits: string[]
    /**
     * Per-field guidance lifted from `@should("…")` JSDoc on payload
     * fields. Path is dot/bracket notation rooted at the payload (e.g.
     * `"cells[].meta"`). Surfaces hints that would otherwise be buried
     * inside the schema tree, so callers can read them alongside
     * `examples` without diving into `description.messages.variants`.
     */
    fieldHints: Array<{ path: string; hint: string }>
  }>
}
```

### `LapCaller`

Call a LAP endpoint. The server surface routes a synthetic WHATWG
Request through the agent core (`coreRouter`); the bridge surface
POSTs over HTTP (`forwardLap`). Both collapse to this shape.

```typescript
export type LapCaller = (path: string, args: object) => Promise<LapEnvelope>
```

### `LapConfirmResultRequest`

```typescript
export type LapConfirmResultRequest = { confirmId: string; timeoutMs?: number }
```

### `LapConfirmResultResponse`

```typescript
export type LapConfirmResultResponse =
  // `still-pending` is the honest timeout outcome (the confirm is still
  // live in the browser — poll again). `rejected` only ever carries
  // `user-cancelled`; a plain timeout never fabricates a rejection.
  | { status: 'confirmed'; stateAfter: unknown }
  | { status: 'rejected'; reason: 'user-cancelled' }
  | { status: 'still-pending' }
```

### `LapContextResponse`

```typescript
export type LapContextResponse = { context: AgentContext }
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

### `LapDescribeVisibleResponse`

```typescript
export type LapDescribeVisibleResponse = {
  /**
   * The user's current URL (`window.location.href`), or `null` when the
   * runtime has no `location` (SSR / non-browser). The client handler
   * has always returned this; the type previously omitted it (drift).
   */
  url: string | null
  outline: OutlineNode[]
  /**
   * Where the outline came from:
   *   - `'data-agent'`: the app has `data-agent`-tagged zones and the
   *     walker scoped the outline to them. The author chose what to
   *     surface; trust the result.
   *   - `'fallback'`: no `data-agent` tags exist; the walker fell back
   *     to a depth- and count-limited semantic walk of the entire
   *     root element. Useful for first-pass dogfood targets that
   *     haven't tagged their views.
   *   - `'truncated'`: same as `'fallback'` but the cap (200 nodes)
   *     was hit before the walk finished. The visible content beyond
   *     that point is not represented; reach for `query_dom` or state
   *     reads if you need more.
   */
  source: 'data-agent' | 'fallback' | 'truncated'
}
```

### `LapDrainMeta`

Drain metadata attached to `dispatched` / `confirmed` responses.
`effectsObserved` counts update-cycle commits (not individual effects) —
it's a proxy for "how much activity happened during the drain window."
`errors` surfaces sync throws from `onEffect` and unhandled rejections
from effect handlers that fired during the drain window, so the LLM
can see when an HTTP handler crashed silently.
`warnings` surfaces non-blocking observations from the schema
validator — typically `untyped-field` flags raised in strict mode
when the agent provided a value for an `'unknown'`-typed field. The
dispatch landed (we accepted the value) but the validator couldn't
structurally check it, so the agent learns of the gap and can
tighten the next try if needed. Lenient mode never emits warnings;
the field is omitted in that case.

```typescript
export type LapDrainMeta = {
  effectsObserved: number
  durationMs: number
  timedOut: boolean
  errors: Array<{ kind: 'error' | 'unhandledrejection'; message: string; stack?: string }>
  warnings?: Array<{ path: string; code: string; message: string }>
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
  '/lap/v1/narrate': { req: LapNarrateRequest; res: LapNarrateResponse }
  '/lap/v1/query-dom': { req: LapQueryDomRequest; res: LapQueryDomResponse }
  '/lap/v1/describe-visible': { req: null; res: LapDescribeVisibleResponse }
  '/lap/v1/context': { req: null; res: LapContextResponse }
  '/lap/v1/observe': { req: null; res: LapObserveResponse }
}
```

### `LapEnvelope`

Discriminated result of one LAP call, transport-independent.

```typescript
export type LapEnvelope =
  | { ok: true; body: unknown }
  | { ok: false; status: number; error: unknown }
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

### `LapMessageRejectReason`

```typescript
export type LapMessageRejectReason =
  | 'human-only'
  | 'user-cancelled'
  | 'invalid'
  | 'schema-error'
  | 'revoked'
  | 'paused'
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
  /**
   * Include the full post-drain `stateAfter` snapshot in the response.
   * Default `false` — the response carries `stateDiff` only and the
   * caller applies it to the prior snapshot (from connect/observe). For
   * apps with non-trivial state, the diff is orders of magnitude
   * smaller than the full state, and resending the snapshot on every
   * dispatch wastes bandwidth and (for LLM callers) context budget.
   *
   * Set `true` when the caller doesn't track state incrementally and
   * wants the snapshot back. The legacy `confirmed` and `wait` paths
   * always carry `stateAfter` because their flow is asynchronous and
   * a diff would be ambiguous.
   */
  includeState?: boolean
}
```

### `LapMessageResponse`

```typescript
export type LapMessageResponse =
  | {
      status: 'dispatched'
      /**
       * Full post-drain state snapshot. Present only when the caller
       * passed `includeState: true` in the request — by default,
       * `stateDiff` is the only state-shaped field on the response
       * because callers can apply the diff to the prior snapshot from
       * `connect` / `observe`. See `LapMessageRequest.includeState`.
       */
      stateAfter?: unknown
      /**
       * Structural diff from pre-dispatch state to post-drain state,
       * in JSON-Patch shape (RFC 6902 subset: `add`, `remove`,
       * `replace`). Empty when the dispatch produced no observable
       * state change. The default state surface for callers — apply
       * incrementally to the snapshot from `connect`/`observe`.
       */
      stateDiff: import('./state-diff.js').StateDiff
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

### `LapNarrateRequest`

Push narration prose into the activity feed without dispatching a
Msg. The agent uses this for "I'm thinking…" / "About to do X
because…" / "I noticed Y, going to investigate" — running commentary
the user can read inline with agent actions.
The server synthesizes a `LogEntry { kind: 'narrate', detail: text }`,
appends it to the per-tid recent-log buffer (visible to subsequent
`describe_recent_actions` calls), AND pushes a `log-push` frame to
the paired browser so the in-app activity feed renders it in real
time. No client roundtrip — the agent gets `{ ok: true }` synchronously
once the server has accepted the narration.

```typescript
export type LapNarrateRequest = {
  text: string
  /**
   * Optional one-line label for the entry's `intent` field, e.g.
   * "Thinking" / "Notice" / "Plan". Defaults to "Agent narrated"
   * when omitted.
   */
  intent?: string
}
```

### `LapNarrateResponse`

```typescript
export type LapNarrateResponse = { ok: true }
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

### `LapPath`

```typescript
export type LapPath = keyof LapEndpointMap
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

### `LapRequest`

```typescript
export type LapRequest<P extends LapPath> = LapEndpointMap[P]['req']
```

### `LapResponse`

```typescript
export type LapResponse<P extends LapPath> = LapEndpointMap[P]['res']
```

### `LapStateRequest`

```typescript
export type LapStateRequest = { path?: string }
```

### `LapStateResponse`

```typescript
export type LapStateResponse = { state: unknown }
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

### `LogAppendFrame`

```typescript
export type LogAppendFrame = { t: 'log-append'; entry: LogEntry }
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
  /**
   * Structural diff from pre-dispatch state to post-drain state, in
   * JSON-Patch shape. Populated only for `kind: 'dispatched'` entries
   * — read entries (get_state / list_actions / observe / …) don't
   * mutate state, and an empty diff would just be noise. Lets the
   * agent reconstruct what each past action did without re-fetching
   * state snapshots.
   */
  stateDiff?: import('./state-diff.js').StateDiff
}
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
  /**
   * The agent emitted prose into the activity feed via `/lap/v1/narrate`
   * — narration like "thinking about your request…", "I'm about to add
   * an alternative because…", or any out-of-band commentary that
   * doesn't fit a `dispatched` / `read` lifecycle. Lets the agent talk
   * to the user inside the app without inventing a fake `@agentOnly`
   * Msg type.
   */
  | 'narrate'
```

### `LogPushFrame`

Server-pushed log entry. Used today by the `narrate` LAP method:
the agent calls `/lap/v1/narrate { text }`, the server synthesizes
a `LogEntry { kind: 'narrate' }` and pushes it down to the paired
runtime so the in-app activity feed renders the narration in real
time. Distinct from the browser-emitted `log-append` frame:
`log-append` is browser → server (rpc-derived audit), `log-push`
is server → browser (server-originated entries, no echo).

```typescript
export type LogPushFrame = { t: 'log-push'; entry: LogEntry }
```

### `McpToolDescriptor`

```typescript
export type McpToolDescriptor = McpForwardedToolDescriptor | McpMetaToolDescriptor
```

### `MessageAnnotations`

```typescript
export type MessageAnnotations = {
  intent: string | null
  alwaysAffordable: boolean
  requiresConfirm: boolean
  dispatchMode: DispatchMode
  /**
   * Concrete copy-paste example dispatches authored as `@example`
   * JSDoc tags. Multiple tags on one variant become multiple
   * entries (mix typical / edge cases without nesting strings).
   */
  examples: string[]
  /**
   * Non-blocking caution authored as `@warning`. Distinct from
   * `requiresConfirm` (runtime user gate); this informs the LLM at
   * affordance time so it can decide whether the dispatch's
   * downstream is acceptable.
   */
  warning: string | null
  /**
   * Effect kinds this variant emits when dispatched, declared via
   * `@emits("kind1", "kind2")`. Lets the agent reason about side
   * effects (cloud writes, analytics, persistent state changes)
   * before dispatching, and chunk multi-step flows accordingly
   * ("don't dispatch X 100 times — each one fires cloud/save").
   * Empty when the variant doesn't emit effects or the author hasn't
   * annotated it yet.
   */
  emits: string[]
  /**
   * Boolean predicate authored as `@routeGated("expr")` JSDoc, with
   * `state` bound at evaluation time. The variant only surfaces in
   * `list_actions` when the predicate returns true. Compile-time
   * alternative to `agentAffordances(state) => Msg[]` for the common
   * case of "this Msg is reachable when state.X looks like Y." Null
   * when the variant has no `@routeGated` tag (default affordance
   * behavior applies).
   */
  routeGate?: string | null
  /**
   * Human-readable reason surfaced when `routeGate` is FALSE — the
   * optional 2nd argument of `@routeGated("expr", "reason")`. Becomes the
   * `unavailableReason` on the gated action in `list_actions`. Null/absent
   * when not authored (a generic reason is used instead).
   */
  routeGateReason?: string | null
}
```

### `MessageSchemaEntry`

```typescript
export type MessageSchemaEntry = {
  payloadSchema: object
  annotations: MessageAnnotations
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
  /** LAP wire-protocol version the server speaks (see {@link LAP_VERSION}). */
  lapVersion?: number
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

### `ResumeClaimRequest`

```typescript
export type ResumeClaimRequest = { tid: string }
```

### `ResumeClaimResponse`

The rotated bearer plus everything the client needs to persist a full
session blob (mirrors `MintResponse`), so a resume survives a
subsequent refresh the same way a fresh mint does. `expiresAt` is in
seconds-since-epoch (same units as `MintResponse.expiresAt`).

```typescript
export type ResumeClaimResponse = {
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

### `RevokedFrame`

```typescript
export type RevokedFrame = { t: 'revoked' }
```

### `RevokeRequest`

```typescript
export type RevokeRequest = { tid: string }
```

### `RevokeResponse`

```typescript
export type RevokeResponse = { status: 'revoked' }
```

### `RpcError`

```typescript
export type RpcError = {
  code: 'paused' | 'invalid' | 'timeout' | 'schema-error' | 'internal' | string
  detail?: string
}
```

### `RpcErrorFrame`

```typescript
export type RpcErrorFrame = { t: 'rpc-error'; id: string; code: string; detail?: string }
```

### `RpcFrame`

```typescript
export type RpcFrame = { t: 'rpc'; id: string; tool: string; args: unknown }
```

### `RpcOptions`

```typescript
export type RpcOptions = { timeoutMs?: number }
```

### `RpcReplyFrame`

```typescript
export type RpcReplyFrame = { t: 'rpc-reply'; id: string; result: unknown }
```

### `ServerFrame`

```typescript
export type ServerFrame =
  | RpcFrame
  | RevokedFrame
  | ActiveFrame
  | LogPushFrame
  | ConfirmExpireFrame
  | WatchFrame
  | UnwatchFrame
```

### `ServerOptions`

Options accepted by `createLluiAgentServer`. All values are
optional and fall back to in-memory defaults.
Pre-0.0.35 this required a `signingKey` for HMAC-signed JWT tokens.
The new opaque-token scheme (token.ts) doesn't sign anything — the
server stores the SHA-256 hash and looks tokens up. The option is
gone; existing config that passed `signingKey` should drop it.

```typescript
export type ServerOptions = {
  /** Token store. Defaults to an `InMemoryTokenStore`. */
  tokenStore?: TokenStore

  /**
   * Identity resolver. Defaults to one that always resolves `null`
   * (unauthenticated). With the default resolver and `allowAnonymous`
   * left `false`, `/agent/mint` fails closed — see `allowAnonymous`.
   */
  identityResolver?: IdentityResolver

  /**
   * Allow minting remote-control tokens for unauthenticated callers
   * (identity resolves to `null`).
   *
   * SECURITY: defaults to `false`. When false, `/agent/mint` rejects
   * with 401 unless the identity resolver returns a real uid, so a
   * deployment without a configured resolver does NOT let any anonymous
   * visitor mint a token. Set `true` only for apps that deliberately
   * allow anonymous agent pairing.
   */
  allowAnonymous?: boolean

  /** Audit sink. Defaults to `consoleAuditSink`. */
  auditSink?: AuditSink

  /** Rate limiter. Defaults to `defaultRateLimiter` with 30/minute. */
  rateLimiter?: RateLimiter

  /** Base path prefix for LAP endpoints. Defaults to `/agent/lap/v1`. */
  lapBasePath?: string

  /**
   * Grace window, in ms, during which a closed pairing can re-pair with
   * the same bearer token without going through the rotate-on-resume
   * (`/resume/claim`) path. Wired to the core's pending-resume grace.
   * Default 60 s; `0` opts out (a WS close immediately requires a
   * rotated token to reconnect).
   */
  pairingGraceMs?: number

  /**
   * Sliding (inactivity) TTL for tokens, in ms. A token whose
   * `lastSeenAt + slidingTtlMs` is in the past is treated as expired on
   * the next verify — on every LAP/MCP call AND on the WebSocket
   * upgrade — even though its hard expiry hasn't elapsed. Caps the live
   * window of a leaked-but-idle bearer.
   *
   * SECURITY-relevant: undefined / `0` disables the sliding check (the
   * hard `expiresAt` ceiling still applies). Set a value to enforce
   * inactivity expiry.
   */
  slidingTtlMs?: number

  /**
   * Allowed `Origin` values for the WebSocket upgrade (CSWSH defense).
   *
   * When set, a browser-issued WS upgrade whose `Origin` is not in this
   * list is rejected with 403 before the handshake completes. When
   * unset, the upgrade defaults to same-origin (the request `Origin`
   * must equal the server's own origin). Requests with NO `Origin`
   * header (non-browser clients) are always allowed, since CSWSH
   * requires a browser-supplied Origin.
   */
  corsOrigins?: readonly string[]

  /**
   * Enable the server-side MCP endpoint at `/agent/mcp` (or a custom
   * path). When set, Claude Desktop can connect directly to the app
   * backend without installing the `llui-agent` bridge — the user pastes
   * the token via `connect_session` in chat, same flow as the bridge but
   * no separate process required.
   *
   * Pass `true` to use all defaults, or an `McpRouterOptions` object to
   * customise the path, server name, and connect_session description.
   */
  mcp?: boolean | McpRouterOptions
}
```

### `SessionsResponse`

```typescript
export type SessionsResponse = { sessions: AgentSession[] }
```

### `StateDiff`

```typescript
export type StateDiff = JsonPatchOp[]
```

### `StateUpdateFrame`

Browser → server: a watched sub-path changed. `id` correlates to the
server `watch` frame that armed it (a specific `/wait` long-poll);
the browser only emits these for currently-armed watches, so idle
sessions cost nothing per commit. `path` echoes the watched pointer
for debugging; `stateAfter` is the full redacted+encoded snapshot.

```typescript
export type StateUpdateFrame = { t: 'state-update'; id?: string; path: string; stateAfter: unknown }
```

### `TokenRecord`

```typescript
export type TokenRecord = {
  tid: string
  /**
   * SHA-256 hex of the bearer token. The plaintext token is never
   * stored — incoming requests hash their `Authorization: Bearer …`
   * value and look up by this field. Hash-only storage keeps a leaked
   * store from being a live-token leak. Mirrors the standard session-
   * cookie / API-key pattern.
   */
  tokenHash: string
  uid: string | null
  status: TokenStatus
  createdAt: number
  /**
   * Hard-expiry in milliseconds since epoch. The mint endpoint sets
   * this to `now + hardExpiryMs`; the verify path rejects requests
   * presenting tokens whose record has `expiresAt <= now`. Pre-0.0.35
   * the equivalent value lived inside the JWT payload as `exp` (in
   * seconds); the new opaque-token flow keeps it server-side so the
   * record is the single source of truth.
   */
  expiresAt: number
  lastSeenAt: number
  pendingResumeUntil: number | null
  origin: string
  label: string | null
}
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

### `UnwatchFrame`

Server → browser: disarm a previously-armed watch (`id`).

```typescript
export type UnwatchFrame = { t: 'unwatch'; id: string }
```

### `VerifyResult`

Result of looking up a presented token. The `expired` reason is
returned by the verify path when the token's record exists but its
hard-expiry has passed; `unknown` covers both "no record" and
"wrong hash" so a probe-by-hash leak surface is uniform.

```typescript
export type VerifyResult =
  | { kind: 'ok'; tid: string }
  | { kind: 'invalid'; reason: 'malformed' | 'unknown' | 'expired' }
```

### `WatchFrame`

Server → browser: arm a state watch. Sent when a `/wait` long-poll
begins. The browser resolves `path` (a JSON pointer; `undefined` /
`''` watches the whole state) against each commit and emits a
`state-update` carrying this `id` only when the resolved value
changes. This makes the per-commit broadcast subscription-driven —
an idle session with no armed watch ships nothing.

```typescript
export type WatchFrame = { t: 'watch'; id: string; path?: string }
```

## Interfaces

### `AgentCodec`

```typescript
export interface AgentCodec<TWire = unknown, TRuntime = unknown> {
  /** Stable identifier used as the value of the `__codec` tag. */
  readonly name: string
  /** Convert a runtime value to its wire representation. */
  encode(value: TRuntime): TWire
  /** Convert a wire representation back to the runtime value. */
  decode(wire: TWire): TRuntime
  /**
   * Predicate identifying runtime values this codec should handle. The
   * universal encoder calls this on every value it walks; the first
   * codec to return `true` claims the value.
   */
  matchesRuntime(value: unknown): boolean
}
```

### `DescribeCache`

A per-session cache of the app `description`. Populated on connect
(from the `/observe` bundle) and on every `describe_app` / `observe`
call; read to serve `describe_app` from cache and to diff schemaHash
for staleness. Each surface backs this with its own session store
(bridge: `BindingMap`; server: `McpSessionMap`).

```typescript
export interface DescribeCache {
  get(): LapDescribeResponse | null
  set(d: LapDescribeResponse): void
}
```

### `McpForwardedToolDescriptor`

```typescript
export interface McpForwardedToolDescriptor {
  kind: 'forward'
  name: string
  description: string
  schema: z.ZodObject<z.ZodRawShape>
  /** LAP endpoint path relative to the base path, e.g. '/observe'. */
  lapPath: string
}
```

### `McpMetaToolDescriptor`

```typescript
export interface McpMetaToolDescriptor {
  kind: 'meta'
  name: string
  description: string
  schema: z.ZodObject<z.ZodRawShape>
}
```

### `MinimalDurableObjectId`

```typescript
export interface MinimalDurableObjectId {
  // Opaque, but DO ids are passed back into `namespace.get()`.
  readonly name?: string
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

### `MinimalDurableObjectStub`

```typescript
export interface MinimalDurableObjectStub {
  fetch(req: Request): Promise<Response>
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

  /**
   * Read the most recent `n` log entries for a tid (newest first).
   * Backed by an in-memory ring buffer populated as the registry
   * sees `log-append` frames; capped per-tid to bound memory across
   * long-lived sessions. Drained on close. Returns an empty array
   * for unknown tids.
   */
  getRecentLog(tid: string, n: number): LogEntry[]

  /**
   * Per-tid cap on the recent-log ring buffer — the ceiling
   * `getRecentLog` clamps to. Exposed so callers that need "everything
   * the buffer can hold" (e.g. the `/recent-actions` handler pulling the
   * full buffer before filtering by kind) reference the registry's own
   * bound instead of hardcoding a literal that could drift.
   */
  readonly recentLogCap: number

  /**
   * Level-triggered confirm-resolution buffer. The browser emits a
   * `confirm-resolved` frame exactly once; the registry records its
   * outcome keyed by `confirmId` with a TTL, independently of whether
   * any subscriber is currently armed. `waitForConfirm` reads this
   * BEFORE subscribing so an approval arriving in the gap between one
   * long-poll's subscriber teardown and the next re-arming is not lost.
   *
   * Returns the recorded frame if one landed within the TTL window,
   * else `null`. Idempotent: repeated reads return the same outcome
   * until it ages out (confirmIds are UUIDs, so no cross-confirm reuse).
   */
  getConfirmOutcome(tid: string, confirmId: string): ConfirmResolvedFrame | null

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
  /** See `./rpc.ts::waitForConfirm`. Three-way: confirmed | user-cancelled | timeout. */
  waitForConfirm(tid: string, confirmId: string, timeoutMs: number): Promise<ConfirmWaitResult>
  /** See `./rpc.ts::waitForChange`. */
  waitForChange(
    tid: string,
    path: string | undefined,
    timeoutMs: number,
  ): Promise<{ status: 'changed' | 'timeout'; stateAfter: unknown }>
}
```

### `RateLimiter`

```typescript
export interface RateLimiter {
  check(key: string, bucket: 'token' | 'identity'): Promise<RateLimitResult>
}
```

### `TokenStore`

Append-only, read-friendly storage for token records.
Tokens are looked up by `tokenHash` (SHA-256 of the presented bearer
value) on every authenticated request. The `tid` index is kept for
the resume / revoke / sessions surfaces — those operate on session
IDs the user can see and copy.

```typescript
export interface TokenStore {
  create(record: TokenRecord): Promise<void>
  findByTid(tid: string): Promise<TokenRecord | null>
  /**
   * Look up a record by the SHA-256 hash of its bearer token. Returns
   * `null` when the hash isn't in the store (the typical "this token
   * isn't ours / has been revoked / never existed" case).
   */
  findByTokenHash(tokenHash: string): Promise<TokenRecord | null>
  listByIdentity(uid: string): Promise<TokenRecord[]>
  touch(tid: string, now: number): Promise<void>
  markPendingResume(tid: string, until: number): Promise<void>
  /** Transition to awaiting-claude: browser WS is connected, waiting for Claude's first call. */
  markAwaitingClaude(tid: string, now: number): Promise<void>
  markActive(tid: string, label: string, now: number): Promise<void>
  revoke(tid: string): Promise<void>
  /**
   * Replace the bearer token's hash and bump expiry. Used by the
   * resume-claim flow: the old token is invalidated (its hash is no
   * longer indexed) and a freshly-minted opaque token takes its
   * place. The `tid` stays stable so existing audit / pairing state
   * carries over.
   */
  rotateTokenHash(tid: string, newTokenHash: string, expiresAt: number): Promise<void>
  /**
   * Evict records whose hard expiry lapsed more than `retentionMs` ago —
   * bounding memory for long-lived, high-churn deployments (every mint
   * creates a record; nothing removed them before). Optional: stores
   * backed by a database with row-level TTL manage this themselves and
   * can leave it unimplemented. Returns the number of records evicted.
   */
  sweepExpired?(now: number, retentionMs: number): Promise<number>
}
```

## Classes

### `AgentPairingDurableObject`

Agent server instance scoped to a single Durable Object. All
pairing state lives in the DO's in-process memory — which is safe
here because the DO is a persistent addressable entity, not a
one-shot Worker isolate.
Users instantiate one of these inside their DO class's constructor
and delegate `fetch` to `agent.fetch(req)`. LAP HTTP routes,
WebSocket upgrades, the optional MCP endpoint, and the internal
`/__resolve` token-resolution endpoint all flow through this single
entry.
── SHARDED-DEPLOYMENT REQUIREMENT ────────────────────────────────
`routeToAgentDO` shards by `tid`: the root DO (`__root`) owns
`/agent/mint` and friends, while LAP/WS calls route to a per-tid DO.
Because each DO defaults to its own `InMemoryTokenStore`, a token
minted on the root DO is INVISIBLE to a per-tid DO — `/__resolve`
(and every LAP auth check) would 401. So the sharded recipe REQUIRES
a single shared external `TokenStore` (a KV/D1-backed implementation
of the `TokenStore` interface) injected into EVERY DO:

```ts
const tokenStore = new KvTokenStore(env.AGENT_KV) // your adapter
this.agent = new AgentPairingDurableObject({ tokenStore })
```

The only no-shared-store option is to NOT shard — route everything
through the root DO by passing `() => Promise.resolve('__root')` as
`resolveTid`. Then all state (tokens + pairings) lives in one DO and
the default `InMemoryTokenStore` is sufficient, at the cost of a
single-DO bottleneck.

```typescript
class AgentPairingDurableObject {
  agent: AgentCoreHandle
  mcpRouter: ((req: Request) => Promise<Response | null>) | null
  constructor(opts: DurableObjectOptions)
  fetch(req: Request): Promise<Response>
  resolveToken(req: Request): Promise<Response>
}
```

### `CodecRegistry`

```typescript
class CodecRegistry {
  byName
  inOrder: AgentCodec[]
  register(codec: AgentCodec): void
  get(name: string): AgentCodec | undefined
  matchRuntime(value: unknown): AgentCodec | undefined
  clone(): CodecRegistry
}
```

### `InMemoryPairingRegistry`

```typescript
class InMemoryPairingRegistry implements PairingRegistry {
  recentLogCap
  pairings
  onLogAppend: ((tid: string, entry: LogEntry) => void) | null
  recentLog
  confirmOutcomes
  constructor(
    opts: {
      onLogAppend?: (tid: string, entry: LogEntry) => void
    } = {},
  )
  getRecentLog(tid: string, n: number): LogEntry[]
  getConfirmOutcome(tid: string, confirmId: string): ConfirmResolvedFrame | null
  recordConfirmOutcome(tid: string, frame: ConfirmResolvedFrame): void
  register(tid: string, conn: PairingConnection): void
  unregister(tid: string): void
  isPaired(tid: string): boolean
  getHello(tid: string): HelloFrame | null
  send(tid: string, frame: ServerFrame): void
  subscribe(tid: string, handler: FrameSubscriber): () => void
  onClose(tid: string, handler: () => void): () => void
  dispatch(tid: string, frame: ClientFrame): void
  rpc(tid: string, tool: string, args: unknown, opts: RpcOptions = {}): Promise<unknown>
  waitForConfirm(tid: string, confirmId: string, timeoutMs: number): Promise<ConfirmWaitResult>
  waitForChange(
    tid: string,
    path: string | undefined,
    timeoutMs: number,
  ): Promise<{ status: 'changed' | 'timeout'; stateAfter: unknown }>
  notify(tid: string, frame: ServerFrame): void
  handleClose(tid: string, conn?: PairingConnection): void
}
```

### `InMemoryTokenStore`

```typescript
class InMemoryTokenStore implements TokenStore {
  byTid
  tidByTokenHash
  create(record: TokenRecord): Promise<void>
  findByTid(tid: string): Promise<TokenRecord | null>
  findByTokenHash(tokenHash: string): Promise<TokenRecord | null>
  listByIdentity(uid: string): Promise<TokenRecord[]>
  touch(tid: string, now: number): Promise<void>
  markPendingResume(tid: string, until: number): Promise<void>
  markAwaitingClaude(tid: string, now: number): Promise<void>
  markActive(tid: string, label: string, now: number): Promise<void>
  revoke(tid: string): Promise<void>
  rotateTokenHash(tid: string, newTokenHash: string, expiresAt: number): Promise<void>
  sweepExpired(now: number, retentionMs: number): Promise<number>
}
```

## Constants

### `FORWARDED_TOOL_DESCRIPTORS`

```typescript
const FORWARDED_TOOL_DESCRIPTORS: McpForwardedToolDescriptor[]
```

### `LAP_VERSION`

LAP wire-protocol version. Bumped on a breaking change to frame
shapes / endpoint contracts. Sent by the browser in `hello.lapVersion`
and returned by `/agent/mint` as `MintResponse.lapVersion` so the two
ends can detect a mismatch (see the version check in the pairing
registry, which logs — rather than hard-fails — an unknown version so
a newer client against an older server degrades loudly, not silently).

```typescript
const LAP_VERSION
```

### `WIRE_TAG`

Wire-format codecs for non-JSON-safe values flowing across the LAP
boundary.
JSON natively supports `string | number | boolean | null | array |
object`. Component messages and state often carry values that don't
round-trip through JSON: `Date`, `Blob`, `File`, `Map`, `Set`,
`BigInt`, `ArrayBuffer`. A codec is the convention that lets these
cross the wire without forcing every component author to invent
their own envelope.
**Wire convention.** A non-JSON-safe runtime value travels as a
tagged object:
{ \_\_codec: '<name>', wire: <encoded form> }
The runtime walks every value crossing the LAP boundary and applies
the codec registry symmetrically:

- **Outgoing** (component → agent, e.g. `stateAfter`): the encoder
  looks up a codec whose `matchesRuntime` returns true and replaces
  the value with its tagged shape.
- **Incoming** (agent → component, e.g. dispatched `msg`): the
  decoder detects the tagged shape, calls the codec's `decode`,
  and substitutes the runtime value before `update()` runs.
  Component code never observes the tagged form. By the time a
  reducer sees `msg.value`, a real `Date` (or whatever) is in place;
  by the time the agent reads `stateAfter`, every `Date` has been
  encoded.
  **Authoring.** When a Msg variant carries a non-JSON-safe field,
  tag the variant's JSDoc with both `@intent` and `@codec("<name>")`.
  For example, a date-input message:
  @intent("Set the parsed date")
  @codec("iso-date")
  | { type: 'setValue'; value: Date | null }
  The `@codec` tag is documentation for human readers and the
  eventual schema generator that publishes the message catalogue to
  the agent client. The runtime encode/decode is registry-driven and
  doesn't need per-field metadata.
  **Defaults.** `makeDefaultCodecs()` ships with `iso-date` (Date ↔
  ISO 8601 string) and `epoch-millis` (Date ↔ number). The
  `epoch-millis` codec is registered but its `matchesRuntime` returns
  `false` by default — it's available for explicit decode but doesn't
  shadow `iso-date` on the encode side. Consumers who prefer epoch
  millis can construct a registry that lists `epoch-millis` first.
  **File / Blob.** Not in the default registry. File/Blob handling is
  environment-specific (browser File API vs. Node Buffer vs. workers)
  and the encoded form is large enough that consumers should opt in
  deliberately. Provide your own codec via `registry.register({...})`
  when a component needs it.

```typescript
const WIRE_TAG
```

### `WIRE_VALUE`

```typescript
const WIRE_VALUE
```

<!-- auto-api:end -->
