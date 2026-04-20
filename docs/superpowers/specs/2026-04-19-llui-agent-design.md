# `@llui/agent` + `llui-agent` — Design Spec

**Date:** 2026-04-19
**Status:** Proposed
**Author:** Franco Ponticelli (w/ Claude)

## 1. Goal

Let end users of an LLui app drive their current browser session from Claude Desktop (or any MCP-speaking LLM client), using the same Msg/State vocabulary the app already uses, and with the user in the loop — observing everything in real time and explicitly confirming sensitive actions.

"LLui Agent" is a **protocol** (LAP — LLui Agent Protocol), not an app-specific endpoint. Users install a single **bridge** into their LLM client once; every LLui app they use is reachable through it via a token + URL pair.

## 2. Non-goals (v1)

- A hosted relay operated by LLui (each developer runs their own app server).
- A turnkey CLI binary for app developers to run a zero-code app server (deferred follow-up; `@llui/agent/server` is a library meant to be mounted in the developer's backend).
- Persistent token-store adapters beyond in-memory (SQLite / Redis / Postgres are follow-ups).
- Pixel screenshots (`take_screenshot`). Replaced by `describe_visible_content`.
- Streaming state subscriptions as a long-lived MCP resource. HTTP long-poll + `wait_for_change` covers v1 needs.
- Non-MCP LLM front-ends (OpenAI tool-use, raw Anthropic tool-use). MCP only in v1, absorbed by the bridge.
- Composite / cross-component agent affordances. Each component declares its own.
- Multiple apps bound to a single Claude conversation. One bound app per Claude chat in v1.

## 3. Topology

Four tiers.

```
┌──────────────────┐  MCP (stdio) ┌──────────────────┐  LAP (HTTPS+JSON) ┌──────────────────┐  WebSocket  ┌──────────────────┐
│ Claude Desktop   │ ───────────▶ │  llui-agent      │ ────────────────▶ │  @llui/agent     │ ──────────▶ │  Browser session │
│ (MCP client)     │              │  bridge (user)   │                   │  server (dev)    │   /agent/ws │  (LLui runtime)  │
│                  │ ◀─────────── │                  │ ◀──────────────── │                  │ ◀────────── │                  │
└──────────────────┘   tool       └──────────────────┘   responses       └──────────────────┘   frames    └──────────────────┘
         ▲              results            │                                      │
         │                                 │  per-chat binding                    │  in-memory (default)
         │  /llui-connect <url> <token>    │  { url, token }                      │  or pluggable
         │                                 ▼                                      ▼
┌──────────────────┐                  ┌──────────────────┐                   ┌──────────────────┐
│ agentConnect UI  │                  │  MCP prompt +    │                   │  TokenStore,     │
│ in the app       │                  │  tool surface    │                   │  AuditSink,      │
│                  │                  │  Claude sees     │                   │  IdentityResolver│
└──────────────────┘                  └──────────────────┘                   └──────────────────┘
```

- **Claude Desktop** (or any MCP client): the LLM chat. Speaks MCP to the bridge.
- **llui-agent bridge** (unscoped npm package, installed once by the user into Claude): a generic MCP server that Claude sees. Stateless about app logic; stores a per-chat `{url, token}` binding; forwards every tool call to the bound URL over LAP. Implements `/llui-connect` as an MCP prompt + tool.
- **@llui/agent server library** (mounted by the app developer in their backend): implements LAP over HTTPS. Authenticates bearer tokens; forwards requests to the paired browser over WS; emits audit entries.
- **Browser runtime** (`@llui/agent/client`): holds the paired session, answers schema/state queries, dispatches Msgs respecting annotations, maintains `agentConnect` / `agentConfirm` / `agentLog` state slices.

## 4. Key invariants

- **Claude is just a remote user.** Same update loop, same bindings. Claude `send`s Msgs and `get`s state like anything else.
- **Ground truth is the view.** The currently-affordable action surface is derived from the live binding array (what the user can click right now), unioned with an opt-in `agentAffordances` registry (Msgs agent-affordable regardless of UI state).
- **Annotations over runtime flags.** `@intent`, `@alwaysAffordable`, `@humanOnly`, `@requiresConfirm` live on Msg variants as JSDoc and are read from the compiler-emitted `__msgSchema`. `update` stays a pure function of state and Msg.
- **User-visible, user-approvable.** Every action appends to `agentLog`. Confirm-gated actions route through `agentConfirm`.
- **Protocol, not endpoint.** App developers implement LAP. Users install the bridge once. The bridge is the only party that speaks MCP. App servers are MCP-free.

## 5. Action surface

### 5.1 Annotations

JSDoc tags on Msg union variants. Read at build time by the vite plugin's TypeScript Compiler API pass; flattened into a per-variant annotation record on `__msgSchema`.

```ts
type Msg =
  /** @intent("Increment the counter") */
  | { type: 'inc' }
  /** @intent("Set display name") */
  | { type: 'setName', name: string }
  /** @intent("Delete item") @requiresConfirm */
  | { type: 'delete', id: string }
  /** @intent("Place order") @humanOnly */
  | { type: 'checkout' }
  /** @intent("Navigate") @alwaysAffordable */
  | { type: 'nav', to: 'reports' | 'settings' | 'home' }
```

| Tag                  | Semantics                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `@intent("...")`     | Human-readable label. Shown to Claude; shown in `agentConfirm` and `agentLog` to the user.  |
| `@alwaysAffordable`  | Agent-surfaceable even when no binding is currently rendered.                               |
| `@requiresConfirm`   | Claude must route through `agentConfirm`; user approves per dispatch.                       |
| `@humanOnly`         | Agent cannot dispatch at all; not shown in `list_actions`; `send_message` returns `blocked`.|

Composition:
- `@humanOnly` dominates; combining with others is redundant (lint warning).
- `@alwaysAffordable` + `@requiresConfirm` + `@intent` is the common combination for nav/dialog actions that need confirmation.
- `@intent` on every variant is strongly recommended; missing intent falls back to a human-readable synthesis of the variant name, with a lint warning.

### 5.2 Binding introspection

The vite plugin emits a `__bindingDescriptors` table per component, parallel to `__dirty`/`__update`, mapping event-handler call sites to a descriptor:

```ts
type BindingDescriptor = {
  variant: string                              // Msg type discriminant
  argsShape: Array<{ from: 'literal', value: unknown } | { from: 'state', path: string } | { from: 'event' }>
  annotations: AnnotationSet                   // resolved from the Msg variant
  selectorHint: string | null                  // best-effort CSS selector for observability
}
```

At runtime, each event binding carries a reference to its descriptor. `list_actions` walks the currently-live per-scope binding array (already reconciled by `branch`/`show`/`each`), skips `@humanOnly`, unions with `agentAffordances(state)`, and returns the list.

### 5.3 `agentAffordances`

A new optional field on the component record:

```ts
component<State, Msg, Effect>({
  name: 'App',
  init, update, view,
  agentAffordances: (state) => [
    { type: 'nav', to: 'reports' },
    { type: 'nav', to: 'settings' },
    ...(state.user ? [{ type: 'signOut' }] : []),
  ],
})
```

Pure function of state. Re-evaluated lazily on `list_actions` (not on every state change).

### 5.4 Dispatch flow for a Claude-proposed Msg

1. Claude calls `send_message({ type: 'delete', id: 'abc' })`. Bridge forwards as `POST /lap/v1/message`.
2. App server validates payload against `__msgSchema`, verifies pairing is live, forwards over WS to the browser.
3. Browser runtime reads the Msg's annotation set:
   - `@humanOnly` → returns `{ status: 'rejected', reason: 'humanOnly' }`. No state change.
   - `@requiresConfirm` → push entry onto `agentConfirm.pending`, return `{ status: 'pending-confirmation', confirmId }`. App server holds the LAP request open; browser notifies when the user resolves the confirmation.
   - Otherwise → dispatch through the normal `send()` pipeline. After `waitFor` settles (default `'idle'`), return `{ status: 'dispatched', stateAfter }`.
4. Every outcome appends an entry to `agentLog`.

## 6. Token & pairing

### 6.1 Token shape

Opaque to Claude; signed payload the app server verifies without a DB hit:

```
llui-agent_<base64url(payload)>.<base64url(hmac-sha256(payload))>
```

Payload:
```ts
{
  tid: string      // token id (UUID, primary key in store)
  iat: number      // issued-at (unix seconds)
  exp: number      // hard expiry (issued + 24h ceiling, non-sliding)
  scope: 'agent'   // reserved for future scopes
}
```

Sliding TTL (default 1 h) tracked in the store, not the token.

### 6.2 Mint flow

1. User clicks "Connect with Claude" → `agentConnect.mintTrigger` binding fires.
2. Client `POST {origin}/agent/mint` (developer's auth cookies/headers ride along).
3. Server calls `identityResolver(req)` to derive `uid`, generates `tid`, creates pairing record `{ tid, uid, status: 'awaiting-ws', origin, ... }`, signs and returns:
   ```ts
   { token, tid, wsUrl, lapUrl, expiresAt }
   ```
   `lapUrl` is the LAP endpoint the bridge will hit, e.g. `https://kanban.example.com/agent/lap/v1`.
4. Client stores `tid` in `localStorage['llui-agent.tids']` (append, deduped), opens WS to `wsUrl` with `Authorization: Bearer <token>`.
5. Server flips pairing to `awaiting-claude`.
6. `agentConnect.pendingToken` populates; view renders a copy-paste box with:
   ```
   /llui-connect https://kanban.example.com/agent/lap/v1 llui-agent_…
   ```
7. User pastes into Claude Desktop; the bridge's `llui-connect` MCP prompt (or `llui_connect_session` tool) is invoked → bridge records `{ sessionId, lapUrl, token }`, pings `POST {lapUrl}/describe` to verify + cache schema, replies to Claude with a summary of the bound app.
8. Subsequent tool calls in this Claude chat → bridge forwards to `lapUrl` with `Authorization: Bearer <token>`.

### 6.3 Resume flow (option C — user-confirmed resume)

1. Tab closes or WS disconnects ungracefully → app server marks pairing `pending-resume`, starts 15 min grace window.
2. Next app load, `agentConnect.init` reads `localStorage['llui-agent.tids']` and dispatches a `ResumeList` effect.
3. Client `POST {origin}/agent/resume/list { tids }` — app server intersects tids with the caller's identity, returns `[{ tid, label, lastSeenAt }…]` for still-resumable pairings.
4. `agentConnect.resumable` populates.
5. Developer renders a banner (or pick-list) from `agentConnect.resumable`; user picks one and clicks Resume.
6. Client `POST {origin}/agent/resume/claim { tid }` → app server returns fresh `{ token, wsUrl }` → client opens new WS → pairing rebinds.
7. Bridge's cached `{lapUrl, token}` binding for the Claude chat stays valid if the token is the same `tid`; resume rotates the token *value* but retains `tid`, so bridge entries keyed on tid persist. (Implementation detail: resume rotates the signed payload's `iat`/`exp`; the token string changes and the bridge receives the new one from the *next* user action. Cleanest UX: `agentConnect` surfaces a one-line `/llui-connect` refresh snippet so the user can optionally repaste if Claude is the active conversation. Otherwise the bridge's next tool call returns 401; bridge tells Claude "binding stale — ask user to re-paste /llui-connect".)
8. Grace expires or user dismisses → app server revokes.

### 6.4 Identity

`identityResolver: (req) => Promise<string | null>` — developer-supplied; derives `uid` from whatever their app's auth uses.

- Authenticated apps: binds tokens to user accounts; revocation list per user.
- Anonymous apps: resolver may return a stable device-scoped id (signed long-lived cookie) or `null` (session-local only).

The package ships a default resolver that reads a signed `llui-agent-uid` cookie. Off by default.

### 6.5 Revocation

`agentConnect.sessions` is populated from `GET {origin}/agent/sessions` (scoped to the current identity). `revoke(tid)` connect-helper fires `POST {origin}/agent/revoke { tid }`. Revocation is immediate server-side: token moves to `revoked`, any in-flight LAP request returns `{ status: 'rejected', reason: 'revoked' }`, paired WS is closed. Bridge's next forwarded call for that binding returns 401; bridge surfaces `revoked` to Claude.

### 6.6 Security

- **HMAC key**: `createLluiAgentServer({ signingKey })`. ≥32 bytes. Rotation invalidates all tokens.
- **Bearer-only auth on `/agent/lap/*` and `/agent/ws`**: no cookies required; CORS can be open. Cookies carried only on `/agent/mint`, `/agent/resume/*`, `/agent/sessions`, `/agent/revoke` for `identityResolver`.
- **Rate limits**: pluggable; default in-memory token bucket keyed per `tid` and per `uid`.
- **Origin pinning**: server records the origin that minted each token; rejects `resume/claim` from a different origin. LAP calls from the bridge carry no Origin header (Node), so origin pinning is enforced only at mint/resume time, which is sufficient.

## 7. LAP — LLui Agent Protocol

JSON over HTTPS. All endpoints under a developer-chosen base path (default `/agent/lap/v1`). All accept `Authorization: Bearer <token>`. All return JSON. Framework-neutral.

### 7.1 Endpoints

| Path                             | Method | Purpose                                                         |
| -------------------------------- | ------ | --------------------------------------------------------------- |
| `/lap/v1/describe`               | POST   | App name, version, state schema, message schema w/ annotations  |
| `/lap/v1/state`                  | POST   | `{ path? }` → `{ state }`                                       |
| `/lap/v1/actions`                | POST   | `{}` → `{ actions[] }`                                          |
| `/lap/v1/message`                | POST   | `{ msg, reason?, waitFor?, timeoutMs? }` → discriminated result |
| `/lap/v1/confirm-result`         | POST   | `{ confirmId, timeoutMs? }` → discriminated result              |
| `/lap/v1/wait`                   | POST   | `{ path?, timeoutMs? }` → `changed` or `timeout` (long-poll)    |
| `/lap/v1/query-dom`              | POST   | `{ name, multiple? }` → `{ elements[] }`                        |
| `/lap/v1/describe-visible`       | POST   | `{}` → `{ outline[] }`                                          |

### 7.2 Response envelope

Read calls return their payload directly (e.g. `{ state }`, `{ actions }`, `{ outline }`). Write/wait calls return a discriminated `{ status, ... }` union (`dispatched`, `confirmed`, `pending-confirmation`, `rejected`, `changed`, `timeout`, etc.). Errors use HTTP non-2xx status codes with a structured body:

```ts
type LapError = {
  error: {
    code: 'auth-failed' | 'revoked' | 'paused' | 'rate-limited' | 'invalid' | 'schema-error' | 'timeout' | 'internal'
    detail?: string
    retryAfterMs?: number
  }
}
```

- `paused` means the token is valid but no browser WS is currently paired (tab closed, pre-resume, etc.).
- `auth-failed` is distinct from `revoked` — `auth-failed` = bad signature / expired; `revoked` = explicitly invalidated.

### 7.3 Transport notes

- All calls are request/response. `/lap/v1/wait` and `/lap/v1/message` (when the underlying Msg is `@requiresConfirm`) are long-poll: the server holds the HTTP response open until the event fires or `timeoutMs` elapses.
- Keep-alive connections are fine; no SSE/WS between bridge and app server in v1.
- Idempotency: repeated `describe`/`state`/`actions` are safe. `message` is not idempotent (each call dispatches); bridge does not retry on network errors without Claude's instruction.

### 7.4 Schema handoff

On WS open (browser → app server), the browser sends:
```ts
{ t: 'hello', appName, appVersion, msgSchema, stateSchema, affordancesSample, schemaHash }
```
App server caches per-pairing. `/lap/v1/describe` serves from the cache. Browser re-sends `hello` when `schemaHash` changes (dev hot-reload).

## 8. Tool surface (what Claude sees via the bridge)

The bridge registers these tools over MCP. Every tool maps 1:1 to a LAP endpoint (plus two bridge-local meta-tools).

### 8.1 Bridge-local meta-tools

#### `llui_connect_session`
```ts
// Args
{ url: string; token: string }
// Response
{ appName: string; appVersion: string; status: 'connected' }
```
Records the binding for this MCP session, pings `/lap/v1/describe` to validate, caches the schema.

#### `llui_disconnect_session`
```ts
// Args: none
// Response
{ status: 'disconnected' }
```
Clears the binding for this MCP session.

### 8.2 Forwarded tools

Each forwards to the corresponding LAP endpoint using the session's bound `{url, token}`. If no binding, returns an error directing Claude to ask the user to run `/llui-connect`.

#### `describe_app`
```ts
// Response
{
  name: string
  version: string
  stateSchema: object           // JSON Schema from __stateSchema
  messages: Record<string, {
    payloadSchema: object
    intent: string | null
    alwaysAffordable: boolean
    requiresConfirm: boolean
    humanOnly: boolean
  }>
  conventions: {
    dispatchModel: 'TEA'
    confirmationModel: 'runtime-mediated'
    readSurfaces: ['state', 'query_dom', 'describe_visible_content']
  }
}
```
Bridge may serve from cache (keyed by session's `schemaHash`) after the first call.

#### `get_state`
```ts
// Args
{ path?: string }               // JSON-pointer; default = root state
// Response
{ state: unknown }
```

#### `list_actions`
```ts
// Args: none
// Response
{
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

#### `send_message`
```ts
// Args
{
  msg: { type: string; [k: string]: unknown }
  reason?: string                 // required when variant is @requiresConfirm
  waitFor?: 'idle' | 'none'       // default 'idle'
  timeoutMs?: number              // default 15000
}
// Response (discriminated)
| { status: 'dispatched',            stateAfter: unknown }
| { status: 'pending-confirmation',  confirmId: string }
| { status: 'confirmed',             stateAfter: unknown }
| { status: 'rejected',              reason: 'humanOnly' | 'user-cancelled' | 'timeout' | 'invalid' | 'schema-error' | 'revoked' | 'paused', detail?: string }
```

#### `get_confirm_result`
```ts
// Args
{ confirmId: string; timeoutMs?: number }
// Response
| { status: 'confirmed',    stateAfter: unknown }
| { status: 'rejected',     reason: 'user-cancelled' | 'timeout' }
| { status: 'still-pending' }
```

#### `wait_for_change`
```ts
// Args
{ path?: string; timeoutMs?: number }   // default 10000
// Response
| { status: 'changed', stateAfter: unknown }
| { status: 'timeout', stateAfter: unknown }
```

#### `query_dom`
```ts
// Args
{ name: string; multiple?: boolean }    // matches data-agent="<name>"
// Response
{ elements: Array<{ text: string; attrs: Record<string,string>; path: number[] }> }
```

#### `describe_visible_content`
```ts
// Args: none
// Response
{
  outline: Array<
    | { kind: 'heading'; level: number; text: string }
    | { kind: 'text';    text: string }
    | { kind: 'list';    items: OutlineNode[] }
    | { kind: 'item';    text: string; children?: OutlineNode[] }
    | { kind: 'button';  text: string; disabled: boolean; actionVariant: string | null }
    | { kind: 'input';   label: string | null; value: string | null; type: string }
    | { kind: 'link';    text: string; href: string }
  >
}
```

### 8.3 MCP prompt

The bridge also registers an MCP prompt named `llui-connect` with two parameters (`url`, `token`). Claude Desktop users see it as a slash completion (`/llui-connect`). When invoked, it calls `llui_connect_session` under the hood. On MCP clients that don't support prompts, the natural-language fallback is documented: the user pastes `/llui-connect <url> <token>` as a chat message; Claude is instructed via tool description to call `llui_connect_session` when it sees that pattern.

## 9. Client runtime (`@llui/agent/client`)

Three headless components, following the `@llui/components` convention (`init`, `update`, `connect`, typed `xxxState` / `xxxMsg`).

### 9.1 `agentConnect`

```ts
type AgentConnectState = {
  status: 'idle' | 'minting' | 'pending-claude' | 'active' | 'error'
  pendingToken: {
    token: string
    tid: string
    lapUrl: string
    connectSnippet: string        // "/llui-connect <lapUrl> <token>"
    expiresAt: number
  } | null
  sessions: AgentSession[]
  resumable: AgentSession[]
  error: { code: string; detail: string } | null
}

type AgentSession = {
  tid: string
  label: string                   // e.g. "Claude Desktop · Opus 4.7"
  status: 'active' | 'pending-resume' | 'revoked'
  createdAt: number
  lastSeenAt: number
}
```

Msgs: `Mint`, `MintSucceeded(token, tid, lapUrl, wsUrl, expiresAt)`, `MintFailed(err)`, `WsOpened`, `WsClosed`, `ResumeList(tids)`, `ResumeListLoaded(sessions)`, `Resume(tid)`, `Revoke(tid)`, `ClearError`, `SessionsLoaded(sessions)`, `RefreshSessions`.

Connect bag:
```ts
agentConnect.connect<State>(slice, send, { mintUrl })
  => {
    root,
    mintTrigger,
    pendingTokenBox,                  // contains connectSnippet
    copyConnectSnippetButton,
    sessionsList, sessionItem(tid), revokeButton(tid),
    resumeBanner, resumeItem(tid), resumeButton(tid), dismissButton(tid),
    error
  }
```

### 9.2 `agentConfirm`

```ts
type AgentConfirmState = { pending: ConfirmEntry[] }
type ConfirmEntry = {
  id: string; variant: string; payload: unknown
  intent: string; reason: string | null
  proposedAt: number
  status: 'pending' | 'approved' | 'rejected'
}
```

Msgs: `Propose(entry)`, `Approve(id)`, `Reject(id)`, `ExpireStale(now)`.

On `Approve`, `agentConfirm.update` emits a side-output naming the original Msg; the root `update` re-dispatches. Keeps TEA clean: each step is a pure Msg dispatch.

Connect bag:
```ts
agentConfirm.connect<State>(slice, send)
  => { root, entry(id): { card, approveButton, rejectButton, intentText, reasonText, payloadText }, empty }
```

### 9.3 `agentLog`

```ts
type AgentLogState = {
  entries: LogEntry[]             // capped ring buffer; default 100
  filter: { kinds?: LogKind[]; since?: number }
}
type LogKind = 'proposed' | 'dispatched' | 'confirmed' | 'rejected' | 'blocked' | 'read' | 'error'
type LogEntry = { id: string; at: number; kind: LogKind; variant?: string; intent?: string; detail?: string }
```

Msgs: `Append(entry)`, `Clear`, `SetFilter(filter)`.

Connect bag:
```ts
agentLog.connect<State>(slice, send)
  => { root, list, entryItem(id), filterControls }
```

### 9.4 WS client wiring

`ws-client.ts` subscribes to `agentConnect` state transitions:
- `minting → pending-claude` with a non-null `pendingToken` → open WS to `pendingToken.wsUrl` with the token as Bearer.
- `active → idle` (revocation, resume-claim by a new client) → close WS.

On incoming frames:
- `rpc` frames ≡ LAP requests forwarded from the bridge → route to the appropriate handler (`get_state` reads state, `message` either dispatches or proposes to `agentConfirm`, etc.).
- `hello` is sent once outbound on WS open.

### 9.5 Effects

```ts
type AgentEffect =
  | { type: 'AgentMintRequest';   mintUrl: string }
  | { type: 'AgentOpenWS';        token: string; wsUrl: string }
  | { type: 'AgentCloseWS' }
  | { type: 'AgentResumeCheck';   tids: string[] }
  | { type: 'AgentResumeClaim';   tid: string }
  | { type: 'AgentRevoke';        tid: string }
  | { type: 'AgentSessionsList' }
```
Composes with the app's own effect handler via `handleEffects` from `@llui/effects`.

### 9.6 Host app integration

```ts
type State = {
  // app state...
  agent: {
    connect: agentConnect.State
    confirm: agentConfirm.State
    log:     agentLog.State
  }
}
type Msg =
  // app msgs...
  | { type: 'agent'; sub: 'connect'; msg: agentConnect.Msg }
  | { type: 'agent'; sub: 'confirm'; msg: agentConfirm.Msg }
  | { type: 'agent'; sub: 'log';     msg: agentLog.Msg }
```

When `agentConnect` transitions to `pending-claude` with a token, the runtime opens the WS and routes incoming frames: confirm-gated msgs → `agentConfirm`, direct `send` for the rest, `agentLog.Append` across the board.

## 10. Server library (`@llui/agent/server`)

Framework-neutral LAP server + mint/resume/revoke/sessions HTTP endpoints + `/agent/ws` upgrade handler. No MCP SDK dependency.

### 10.1 Public API

```ts
import { createLluiAgentServer, InMemoryTokenStore, consoleAuditSink } from '@llui/agent/server'

const agent = createLluiAgentServer({
  signingKey: process.env.LLUI_AGENT_SIGNING_KEY!,
  tokenStore: new InMemoryTokenStore(),
  identityResolver: async (req) => req.cookies.user_id ?? null,
  auditSink: consoleAuditSink,
  rateLimit: { perToken: '30/minute', perIdentity: '300/minute' },
  corsOrigins: ['https://myapp.com'],
  lapBasePath: '/agent/lap/v1',          // default
  pairingGraceMs: 15 * 60 * 1000,
  slidingTtlMs: 60 * 60 * 1000,
})

app.use('/agent', agent.router)
server.on('upgrade', agent.wsUpgrade)
```

### 10.2 Endpoints

| Path                         | Method | Purpose                                                 |
| ---------------------------- | ------ | ------------------------------------------------------- |
| `/agent/mint`                | POST   | Mint a new token + pairing record                        |
| `/agent/resume/list`         | POST   | Given `tids`, return still-resumable ones                |
| `/agent/resume/claim`        | POST   | Claim a `pending-resume` token; returns fresh `{token,wsUrl}` |
| `/agent/revoke`              | POST   | Revoke by `tid`                                          |
| `/agent/sessions`            | GET    | List sessions for current identity                       |
| `/agent/lap/v1/*`            | POST   | LAP endpoints (§7)                                       |
| `/agent/ws`                  | WS     | Browser bridge — token-authed                            |

### 10.3 Interfaces

```ts
interface TokenStore {
  create(record: TokenRecord): Promise<void>
  findByTid(tid: string): Promise<TokenRecord | null>
  listByIdentity(uid: string): Promise<TokenRecord[]>
  touch(tid: string, now: number): Promise<void>
  markPendingResume(tid: string, until: number): Promise<void>
  markActive(tid: string, label: string, now: number): Promise<void>
  revoke(tid: string): Promise<void>
}

type TokenRecord = {
  tid: string
  uid: string | null
  status: 'awaiting-ws' | 'awaiting-claude' | 'active' | 'pending-resume' | 'revoked'
  createdAt: number
  lastSeenAt: number
  pendingResumeUntil: number | null
  origin: string
  label: string | null
}

interface AuditSink { write(entry: AuditEntry): void | Promise<void> }

type AuditEntry = {
  at: number
  tid: string | null
  uid: string | null
  event:
    | 'mint' | 'claim' | 'resume' | 'revoke'
    | 'lap-call' | 'msg-dispatched' | 'msg-blocked'
    | 'confirm-proposed' | 'confirm-approved' | 'confirm-rejected'
    | 'rate-limited' | 'auth-failed'
  detail: object
}

interface IdentityResolver { (req: Request): Promise<string | null> }       // Web-standards Request

interface RateLimiter {
  check(key: string, bucket: 'token' | 'identity'): Promise<{ allowed: boolean; retryAfterMs?: number }>
}
```

Adapters (Node http / Express / Hono / Fastify) convert their native request shapes to Web `Request` on the way into `identityResolver` and route handlers.

### 10.4 LAP dispatch (request handling)

1. Parse `Authorization: Bearer` header; validate signature + expiry + revocation.
2. Resolve paired WS channel via `tid`. If none live → HTTP 503 with `{ error: { code: 'paused' } }`.
3. Record sliding-TTL touch + audit entry.
4. Forward as `rpc` frame over WS; await `rpc-reply` or `rpc-error`.
5. `/lap/v1/message`:
   - Browser replies `dispatched` or `rejected` → return inline.
   - Browser replies `pending-confirmation` → hold HTTP response open up to `timeoutMs`; resolve with `confirmed` / `user-cancelled` follow-up. On timeout, return `pending-confirmation` with `confirmId`; bridge polls `/lap/v1/confirm-result`.
6. `/lap/v1/wait` → forward; browser streams state updates back; server returns the first matching event or `timeout`.
7. Every step: audit write + rate-limit check.

### 10.5 Browser-to-server frames (over WS)

```ts
type ClientFrame =
  | { t: 'hello'; appName: string; appVersion: string; msgSchema: object; stateSchema: object; affordancesSample: object[]; schemaHash: string }
  | { t: 'rpc-reply'; id: string; result: unknown }
  | { t: 'rpc-error'; id: string; code: string; detail?: string }
  | { t: 'confirm-resolved'; confirmId: string; outcome: 'confirmed' | 'user-cancelled'; stateAfter?: unknown }
  | { t: 'state-update'; path: string; stateAfter: unknown }
  | { t: 'log-append'; entry: LogEntry }

type ServerFrame =
  | { t: 'rpc'; id: string; tool: string; args: unknown }
  | { t: 'revoked' }
```

### 10.6 Reference implementations

- `InMemoryTokenStore` — default; `Map<tid, TokenRecord>` + TTL sweep.
- `consoleAuditSink` — JSON lines to stdout.
- `defaultRateLimiter` — in-memory token bucket.
- `defaultIdentityResolver` — reads a signed `llui-agent-uid` cookie; off unless `createLluiAgentServer` receives `identityCookie: { name, signingKey }`.

## 11. Bridge (`llui-agent` — unscoped user-facing CLI)

Generic MCP server. Users install it into their LLM client once; every LLui app becomes reachable through it via `/llui-connect`.

### 11.1 CLI

```bash
# User's Claude Desktop config:
{
  "mcpServers": {
    "llui": { "command": "npx", "args": ["-y", "llui-agent"] }
  }
}
```

Runs as stdio MCP server by default (that's what Claude Desktop launches). `--http PORT` flag supported for HTTP-MCP clients (unused in v1 but trivial to enable).

### 11.2 Bridge architecture

```
┌──────────────────┐   stdio   ┌──────────────────────────┐
│ Claude Desktop   │◀─ MCP ─▶ │   llui-agent bridge      │
└──────────────────┘           │                          │
                               │  Sessions: Map<sid, Binding> │
                               │  Binding: { lapUrl, token,   │
                               │    appName, schema, schemaHash }│
                               │                          │
                               │  Tool handlers → fetch(lapUrl + path, {headers: {Authorization: ...}, body: ...})│
                               └──────────────────────────┘
                                            │
                                  HTTPS     │     Authorization: Bearer <token>
                                            ▼
                                   {lapUrl}/describe
                                   {lapUrl}/state
                                   …
```

### 11.3 Session lifecycle

- Each MCP client connection (one per Claude chat) has an MCP session id `sid`. Bridge stores `Map<sid, Binding>`.
- `llui_connect_session({url, token})` → bridge pings `POST {url}/describe` to verify; on success caches `{ url, token, appName, schema, schemaHash }` under `sid`.
- `llui_disconnect_session()` → removes the binding.
- MCP session close → bridge clears the binding.
- Bindings are in-memory only; bridge restarts drop them (user re-pastes).

### 11.4 Request forwarding

For each forwarded tool, the bridge:
1. Looks up `Binding` by `sid`. If missing, returns an error-shaped response telling Claude to ask the user to run `/llui-connect`.
2. Maps the tool name to a LAP path (`describe_app → /describe`, `get_state → /state`, …).
3. `fetch(binding.url + path, { method: 'POST', headers: {Authorization: 'Bearer ' + binding.token, 'Content-Type': 'application/json'}, body: JSON.stringify(args) })`.
4. On HTTP error with `{ error: { code: 'revoked' | 'paused' | 'auth-failed' } }` → surface the error code to Claude in a structured form (Claude learns to suggest re-paste on `revoked`/`auth-failed`, retry on `paused`).
5. Otherwise returns the JSON body verbatim as the MCP tool result.

### 11.5 `describe_app` caching

After `llui_connect_session`, the bridge stores the `describe_app` response under the binding. Subsequent `describe_app` calls return the cache unless the app server returns a `schema-changed` hint (bridge clears cache and re-fetches). This saves round-trips and gives Claude a stable schema within a conversation.

### 11.6 MCP prompt registration

The bridge registers an MCP prompt `llui-connect` with parameters `url: string`, `token: string`. Claude Desktop surfaces it as a slash completion. Expansion: a user message that triggers `llui_connect_session({url, token})`.

### 11.7 Installability

Published as unscoped `llui-agent` on npm. First-run UX:

```bash
npx -y llui-agent
# (registered by Claude Desktop via the mcpServers config above)
```

No config file, no server, no state on disk.

## 12. Vite plugin changes (`@llui/vite-plugin`)

### 12.1 Annotation extraction

During the pass that emits `__msgSchema`, parse JSDoc attached to Msg union member types. Extract the four known tags and attach an annotation record:

```ts
__msgSchema = {
  inc:     { payload: {…}, annotations: { intent: 'Increment the counter' } },
  delete:  { payload: {…}, annotations: { intent: 'Delete item', requiresConfirm: true } },
  nav:     { payload: {…}, annotations: { intent: 'Navigate', alwaysAffordable: true } },
  checkout:{ payload: {…}, annotations: { intent: 'Place order', humanOnly: true } },
}
```

### 12.2 Binding descriptor emission

Emit `__bindingDescriptors` alongside `__dirty` / `__update`. Each descriptor maps an event-handler call-site to a serializable trace of the Msg it dispatches. Drives `list_actions` at runtime.

Handlers that don't match the pattern (conditional dispatch, multiple sends, dynamic type) emit `variant: null` and are skipped by `list_actions`. Lint rule in `@llui/lint-idiomatic` warns.

### 12.3 `schemaHash`

Compute a stable hash over `__msgSchema` + `__stateSchema` + annotation record per component. Emit as a constant the runtime can send in the `hello` frame for cache invalidation.

## 13. Package layout

```
packages/
  mcp-core/                           (new)
    src/
      schema/                         (moved: serialize/deserialize msg/state schemas)
      validator.ts                    (moved: validateMessage)
      relay-protocol.ts               (new: shared WS frame types)
      lap-protocol.ts                 (new: LAP endpoint & payload types)
  mcp/                                (existing, trimmed)
    src/
      index.ts                        — dev-time MCP server (stdio + http)
      transports/relay.ts             — WS to local browser via @llui/vite-plugin
      tools/debug-api.ts              — dev-only debug tools stay here
      cli.ts
  agent/                              (new, publishes @llui/agent)
    src/
      server/
        index.ts                      — createLluiAgentServer
        token-store.ts
        identity.ts
        audit.ts
        rate-limit.ts
        lap-handler.ts
        endpoints.ts                  — mint / resume / revoke / sessions
        ws.ts
      client/
        index.ts                      — agentConnect, agentConfirm, agentLog
        agentConnect.ts
        agentConfirm.ts
        agentLog.ts
        ws-client.ts
        effects.ts
      protocol.ts                     — re-exports from mcp-core
    package.json, tsconfig.build.json, vitest.config.ts, README.md
  agent-bridge/                       (new, publishes llui-agent unscoped)
    src/
      cli.ts                          — #!/usr/bin/env node; stdio MCP boot
      bridge.ts                       — MCP server + session map
      forwarder.ts                    — tool → LAP endpoint dispatcher
      prompts.ts                      — registers llui-connect prompt
    package.json (name: "llui-agent"), tsconfig.build.json, README.md
```

### 13.1 Entry points

`@llui/agent`:
```json
"exports": {
  "./server":   "./dist/server/index.js",
  "./client":   "./dist/client/index.js",
  "./protocol": "./dist/protocol.js"
}
```

`llui-agent`:
```json
"bin": { "llui-agent": "./dist/cli.js" }
```

Server and client never import each other. Bridge depends only on `@llui/agent/protocol` and `@llui/mcp-core` for shared types.

### 13.2 Dependency graph

```
@llui/agent/client    →  @llui/dom, @llui/effects, @llui/mcp-core
@llui/agent/server    →  @llui/mcp-core, ws                                   (no MCP SDK)
llui-agent (bridge)   →  @llui/mcp-core, @llui/agent/protocol,                (the only MCP SDK consumer)
                         @modelcontextprotocol/sdk
@llui/mcp             →  @llui/dom, @llui/mcp-core, @llui/lint-idiomatic,
                         @modelcontextprotocol/sdk, ws
@llui/mcp-core        →  — (no runtime deps)
```

### 13.3 npm name availability

Implementation plan will start by verifying `llui-agent` is available on npm. If not, fall back to `@llui/agent-bridge` with the same code layout; the CLI name changes but the architecture doesn't.

## 14. Testing

### 14.1 Server (`packages/agent/test/server/`)
- HTTP integration tests over Node http + a fake WS client: mint, resume-list, resume-claim, revoke, sessions.
- LAP dispatch tests: forwarding, timeout, pending-confirmation long-hold, polling-fallback.
- Audit emission tests: every code path writes the expected `AuditEntry`.
- Rate-limit tests.
- Origin-pinning tests.

### 14.2 Client (`packages/agent/test/client/`)
- `@llui/test` `testComponent` harness for each of `agentConnect` / `agentConfirm` / `agentLog`.
- `propertyTest` the annotation-gating classifier.
- WS-client state-machine tests with mock WS transport.

### 14.3 Bridge (`packages/agent-bridge/test/`)
- Session-map lifecycle: bind, re-bind (new token), disconnect, MCP close.
- Forwarder: happy path + every LAP error shape (auth-failed, revoked, paused, rate-limited, timeout).
- Prompt registration: MCP prompt surface matches spec.
- Describe-cache invalidation on `schemaHash` change.
- Mock LAP server (Node http) used as the target.

### 14.4 End-to-end (`packages/agent/test/e2e/`)
- Spin up agent server + headless browser + bridge (subprocess). Simulate an MCP client that runs `llui_connect_session`, `describe_app`, `send_message`; assert the browser state mutated and `agentLog` recorded the event.

## 15. Documentation

- `packages/agent/README.md` — developer install, server mount, client wire, annotation cheat sheet.
- `packages/agent-bridge/README.md` — user install steps for Claude Desktop; troubleshooting.
- `docs/designs/10 Agent Protocol.md` — LAP wire protocol, bridge architecture, security model, resume semantics.
- Update `docs/designs/09 API Reference.md` with new exports.

## 16. Lint additions (`@llui/lint-idiomatic`)

- Warn when a Msg variant lacks `@intent`.
- Warn when `@humanOnly` is combined with `@requiresConfirm` / `@alwaysAffordable`.
- Warn on event handlers whose dispatch is not introspectable by the binding-descriptor extractor.

## 17. Open questions deferred to implementation planning

- Whether to preserve the raw JSDoc comment on each Msg variant into the emitted schema (for debug tooling). Leaning yes, byte-capped.
- Exact serialization of `agentAffordances(state)` — eager per `list_actions` or cached with a state-hash key. Leaning eager.
- Whether `wait_for_change` should support predicates (small JS expression string) or only path-equality. Leaning path-equality only in v1.
- Whether `agentLog` entries mirror to the server audit sink automatically or opt-in. Leaning automatic.
- Component selection for `get_state` / `send_message` in multi-component apps. V1 assumes a single mounted root; multi-root follow-up.
- When `agentConnect` fires `AgentSessionsList` — on init, on UI mount, or explicit. Leaning on init + a public `RefreshSessions` Msg.
- Binding-descriptor extraction cost on large components. Needs measurement.
- Bridge persistence (remember last-used bindings across bridge restarts) — v1 is in-memory only; follow-up if friction shows up in dogfood.
- Bridge multi-binding per chat (bind a Claude chat to two LLui apps and route by app name). Follow-up.
- Verifying `llui-agent` name availability on npm. Fallback plan is `@llui/agent-bridge`.

## 18. Out of scope (follow-up work)

- Turnkey CLI for app developers (zero-code app server).
- Pluggable persistence adapters for `TokenStore` and `AuditSink` (SQLite, Redis, Postgres).
- `take_screenshot` tool + browser capture integration.
- Streaming state subscriptions over MCP (long-lived resources).
- Direct OpenAI tool-use / raw Anthropic tool-use front-ends.
- A hosted LLui relay service.
- Composite `agentAffordances` above the component tree.
- SSE upgrade on `/lap/v1/events`.
- Bridge-side persistent binding memory.
