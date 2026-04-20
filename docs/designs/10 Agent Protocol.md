# 10 — Agent Protocol

**Status:** Implementation reference (v1)
**Last updated:** 2026-04-20

This document describes the LLui Agent Protocol (LAP) — the wire protocol, frame types, token model, security, and session lifecycle that underpin `@llui/agent` and the `llui-agent` bridge. For rationale and brainstorming, see `docs/superpowers/specs/2026-04-19-llui-agent-design.md`.

---

## 1. Topology

Four tiers communicate in sequence:

```
┌──────────────────┐  MCP (stdio)  ┌──────────────────┐  LAP (HTTPS+JSON)  ┌──────────────────┐  WebSocket   ┌──────────────────┐
│  Claude Desktop  │ ────────────▶ │  llui-agent      │ ─────────────────▶ │  @llui/agent     │ ───────────▶ │  Browser session │
│  (MCP client)    │               │  bridge (user)   │                    │  server (dev)    │  /agent/ws   │  (LLui runtime)  │
│                  │ ◀──────────── │                  │ ◀───────────────── │                  │ ◀─────────── │                  │
└──────────────────┘  tool results └──────────────────┘    responses        └──────────────────┘   frames     └──────────────────┘
```

**Claude Desktop (MCP client):** The LLM chat interface. Speaks MCP over stdio to the bridge.

**llui-agent bridge (user-installed):** A stateless MCP server. Stores a per-chat `{ url, token }` binding; forwards each tool call to the bound app server over LAP. No app logic lives here.

**@llui/agent server library (developer-mounted):** Implements LAP over HTTPS. Authenticates bearer tokens, pairs WebSocket sessions from the browser, forwards RPC requests, and emits audit entries.

**Browser runtime (@llui/agent/client):** Maintains the WebSocket pairing, answers schema/state queries, dispatches Msgs according to annotations, maintains `agentConnect` / `agentConfirm` / `agentLog` state slices.

---

## 2. LAP Endpoint Catalog

All endpoints live under a developer-chosen base path (default `/agent/lap/v1`). All accept `Authorization: Bearer <token>` and return `application/json`.

### 2.1 Session meta-endpoints (browser-facing, cookie-authed)

| Path                    | Method | Purpose                                                     |
| ----------------------- | ------ | ----------------------------------------------------------- |
| `/agent/mint`           | POST   | Mint a new token + pairing record                           |
| `/agent/resume/list`    | POST   | Given `{ tids }`, return still-resumable pairings           |
| `/agent/resume/claim`   | POST   | Claim a pending-resume pairing; returns fresh token + wsUrl |
| `/agent/revoke`         | POST   | Revoke a token by `tid`                                     |
| `/agent/sessions`       | GET    | List sessions for the authenticated identity                |
| `/agent/ws`             | WS     | Browser WebSocket upgrade — bearer-token authenticated      |

### 2.2 LAP endpoints (bridge-facing, bearer-token authenticated)

| Path                       | Method | Request shape                                           | Response shape                                         |
| -------------------------- | ------ | ------------------------------------------------------- | ------------------------------------------------------ |
| `/lap/v1/describe`         | POST   | `{}`                                                    | `LapDescribeResponse`                                  |
| `/lap/v1/state`            | POST   | `LapStateRequest`                                       | `LapStateResponse`                                     |
| `/lap/v1/actions`          | POST   | `{}`                                                    | `LapActionsResponse`                                   |
| `/lap/v1/message`          | POST   | `LapMessageRequest`                                     | `LapMessageResponse`                                   |
| `/lap/v1/confirm-result`   | POST   | `LapConfirmResultRequest`                               | `LapConfirmResultResponse`                             |
| `/lap/v1/wait`             | POST   | `LapWaitRequest`                                        | `LapWaitResponse`                                      |
| `/lap/v1/query-dom`        | POST   | `LapQueryDomRequest`                                    | `LapQueryDomResponse`                                  |
| `/lap/v1/describe-visible` | POST   | `{}`                                                    | `LapDescribeVisibleResponse`                           |
| `/lap/v1/context`          | POST   | `{}`                                                    | `LapContextResponse`                                   |

### 2.3 Request / Response type shapes

```ts
// ── describe ──────────────────────────────────────────────────────────────────
type LapDescribeResponse = {
  appName: string
  appVersion: string
  stateSchema: object             // JSON Schema
  messages: Record<string, MessageSchemaEntry>
  docs: AgentDocs | null
  schemaHash: string
}

type MessageSchemaEntry = {
  payloadSchema: object
  intent: string | null
  alwaysAffordable: boolean
  requiresConfirm: boolean
  humanOnly: boolean
}

// ── state ─────────────────────────────────────────────────────────────────────
type LapStateRequest = { path?: string }  // JSON Pointer; default = root
type LapStateResponse = { state: unknown }

// ── actions ───────────────────────────────────────────────────────────────────
type LapActionsResponse = {
  actions: Array<{
    variant: string
    intent: string
    requiresConfirm: boolean
    source: 'binding' | 'always-affordable'
    selectorHint: string | null
    payloadHint: object | null
  }>
}

// ── message ───────────────────────────────────────────────────────────────────
type LapMessageRequest = {
  msg: { type: string; [k: string]: unknown }
  reason?: string               // required when @requiresConfirm
  waitFor?: 'idle' | 'none'     // default 'idle'
  timeoutMs?: number            // default 15000
}

type LapMessageRejectReason =
  | 'humanOnly'
  | 'user-cancelled'
  | 'timeout'
  | 'invalid'
  | 'schema-error'
  | 'revoked'
  | 'paused'

type LapMessageResponse =
  | { status: 'dispatched';           stateAfter: unknown }
  | { status: 'pending-confirmation'; confirmId: string }
  | { status: 'confirmed';            stateAfter: unknown }
  | { status: 'rejected';             reason: LapMessageRejectReason; detail?: string }

// ── confirm-result ────────────────────────────────────────────────────────────
type LapConfirmResultRequest = { confirmId: string; timeoutMs?: number }
type LapConfirmResultResponse =
  | { status: 'confirmed';     stateAfter: unknown }
  | { status: 'rejected';      reason: 'user-cancelled' | 'timeout' }
  | { status: 'still-pending' }

// ── wait ──────────────────────────────────────────────────────────────────────
type LapWaitRequest = { path?: string; timeoutMs?: number }   // default 10000
type LapWaitResponse =
  | { status: 'changed'; stateAfter: unknown }
  | { status: 'timeout'; stateAfter: unknown }

// ── query-dom ─────────────────────────────────────────────────────────────────
type LapQueryDomRequest = { name: string; multiple?: boolean }
type LapQueryDomResponse = {
  elements: Array<{ text: string; attrs: Record<string, string>; path: number[] }>
}

// ── describe-visible ──────────────────────────────────────────────────────────
type OutlineNode =
  | { kind: 'heading';  level: number; text: string }
  | { kind: 'text';     text: string }
  | { kind: 'list';     items: OutlineNode[] }
  | { kind: 'item';     text: string; children?: OutlineNode[] }
  | { kind: 'button';   text: string; disabled: boolean; actionVariant: string | null }
  | { kind: 'input';    label: string | null; value: string | null; type: string }
  | { kind: 'link';     text: string; href: string }

type LapDescribeVisibleResponse = { outline: OutlineNode[] }

// ── context ───────────────────────────────────────────────────────────────────
type LapContextResponse = { context: AgentContext }

// ── shared ────────────────────────────────────────────────────────────────────
type AgentDocs = {
  purpose: string
  overview?: string
  cautions?: string[]
}

type AgentContext = {
  summary: string
  hints?: string[]
  cautions?: string[]
}
```

### 2.4 Error envelope

Non-2xx responses carry a structured body:

```ts
type LapErrorCode =
  | 'auth-failed'   // bad signature, expired token
  | 'revoked'       // token explicitly revoked
  | 'paused'        // valid token but no browser WS paired
  | 'rate-limited'  // burst exceeded
  | 'invalid'       // malformed request body
  | 'schema-error'  // Msg failed schema validation
  | 'timeout'       // long-poll exceeded
  | 'internal'      // server error

type LapError = {
  error: {
    code: LapErrorCode
    detail?: string
    retryAfterMs?: number   // present on rate-limited
  }
}
```

HTTP status codes: `401` (auth-failed, revoked), `503` (paused), `429` (rate-limited), `400` (invalid, schema-error), `504` (timeout), `500` (internal).

### 2.5 Transport notes

- All calls are request/response. `/lap/v1/wait` and `/lap/v1/message` (when the Msg is `@requiresConfirm`) are **long-poll**: the server holds the HTTP response open until the event fires or `timeoutMs` elapses.
- Keep-alive connections are fine; no SSE/WS between bridge and app server.
- `describe`, `state`, `actions`, `describe-visible`, `context`, `query-dom` are **idempotent reads**. `message` is **not idempotent** — each call dispatches; the bridge must not retry on network failure without Claude's instruction.

---

## 3. WebSocket Frame Types

The browser opens a persistent WebSocket to `/agent/ws` (bearer-token authenticated). All frames are JSON text messages.

### 3.1 Client → Server frames (browser sends)

```ts
type HelloFrame = {
  t: 'hello'
  appName: string
  appVersion: string
  msgSchema: object          // __msgSchema from the compiler
  stateSchema: object        // __stateSchema from the compiler
  affordancesSample: object[]
  docs: AgentDocs | null
  schemaHash: string
}

type RpcReplyFrame = {
  t: 'rpc-reply'
  id: string                 // matches the server's rpc frame id
  result: unknown
}

type RpcErrorFrame = {
  t: 'rpc-error'
  id: string
  code: string
  detail?: string
}

type ConfirmResolvedFrame = {
  t: 'confirm-resolved'
  confirmId: string
  outcome: 'confirmed' | 'user-cancelled'
  stateAfter?: unknown
}

type StateUpdateFrame = {
  t: 'state-update'
  path: string               // JSON Pointer; '/' = root
  stateAfter: unknown
}

type LogAppendFrame = {
  t: 'log-append'
  entry: LogEntry
}

type ClientFrame =
  | HelloFrame
  | RpcReplyFrame
  | RpcErrorFrame
  | ConfirmResolvedFrame
  | StateUpdateFrame
  | LogAppendFrame
```

### 3.2 Server → Client frames (server sends)

```ts
type RpcFrame = {
  t: 'rpc'
  id: string                 // UUID; browser echoes back in rpc-reply / rpc-error
  tool: string               // LAP endpoint short name, e.g. 'get_state'
  args: unknown
}

type RevokedFrame = {
  t: 'revoked'
}

type ServerFrame = RpcFrame | RevokedFrame
```

### 3.3 Pairing handshake

1. Browser opens `ws://{server}/agent/ws` with `Authorization: Bearer <token>` (via `?token=` query param or a sub-protocol extension depending on the adapter).
2. Server validates the token, sets pairing status to `awaiting-claude`.
3. Browser sends `hello` immediately.
4. Server caches schema from `hello`, flips pairing to `active` (or `awaiting-claude` if Claude hasn't called yet).
5. Subsequent `rpc` frames from the server travel the reverse path.
6. On disconnect, server sets pairing to `pending-resume`; starts the grace window.

---

## 4. Token Format and Security Model

### 4.1 Token wire format

```
llui-agent_<base64url(payload)>.<base64url(hmac-sha256(payload, signingKey))>
```

`payload` is a compact JSON object:

```ts
type TokenPayload = {
  tid: string   // UUID token ID — primary key in the store
  iat: number   // issued-at (Unix seconds)
  exp: number   // hard expiry (iat + 24 h ceiling, non-sliding)
  scope: 'agent'
}
```

Sliding TTL (default 1 h) is tracked server-side in the `TokenStore`, not in the token. A token that is valid by signature and `exp` but whose store record has gone stale is rejected with `auth-failed`.

### 4.2 Verification steps (every LAP request)

1. Split token at the last `.`.
2. Recompute `HMAC-SHA256(payload, signingKey)`. Reject with `401 auth-failed` if mismatch.
3. Decode `payload`; check `exp > now`. Reject with `401 auth-failed` if expired.
4. Load `TokenRecord` by `tid`. Reject with `401 auth-failed` if not found.
5. Check `record.status !== 'revoked'`. Reject with `401 revoked` if revoked.
6. Check sliding TTL: `now - record.lastSeenAt < slidingTtlMs`. Reject with `401 auth-failed` if stale.
7. Touch: `store.touch(tid, now)`.

### 4.3 Key management

`createLluiAgentServer({ signingKey })` requires a key of ≥ 32 bytes. Rotation invalidates all existing tokens — store the key in a secret manager and rotate on compromise. There is no per-token rotation in v1.

### 4.4 Origin pinning

The server records the HTTP `Origin` header at mint time in `TokenRecord.origin`. Resume-claim calls from a different origin are rejected. LAP calls from the bridge carry no `Origin` (Node environment), so pinning is enforced only at mint/resume, which is sufficient to prevent cross-origin token theft.

### 4.5 Bearer-only on LAP endpoints

`/agent/lap/*` and `/agent/ws` accept only `Authorization: Bearer <token>` — no cookies. CORS may be open on these endpoints. Cookies are carried only by the session meta-endpoints (`/agent/mint`, `/agent/resume/*`, `/agent/sessions`, `/agent/revoke`) for `identityResolver`.

### 4.6 Rate limiting

Default: 30 requests / minute per `tid` (token bucket). Configurable via `rateLimit: { perToken: string; perIdentity: string }`. On burst:
- HTTP response: `429` with `{ error: { code: 'rate-limited', retryAfterMs: N } }`.
- Bridge surfaces `retryAfterMs` to Claude; Claude should wait before retrying.
- `RateLimiter` is pluggable — replace `defaultRateLimiter` with a Redis-backed implementation for multi-instance deployments.

---

## 5. Session Lifecycle / Resume Flow

### 5.1 Status states

```
awaiting-ws ──(WS open)──▶ awaiting-claude ──(describe called)──▶ active
                                                                      │
                                                               ┌──────┘
                                                               │  WS disconnects
                                                               ▼
                                                          pending-resume ──(grace expires)──▶ revoked
                                                               │
                                                         (resume/claim)
                                                               │
                                                               ▼
                                                             active
```

`revoked` is also reached via explicit `POST /agent/revoke`.

### 5.2 Mint flow

1. User clicks "Connect with Claude" → `agentConnect.mintTrigger` fires an `AgentMintRequest` effect.
2. Browser `POST {origin}/agent/mint`. Developer's auth cookies ride along; `identityResolver` derives `uid`.
3. Server generates `tid`, creates `TokenRecord { status: 'awaiting-ws' }`, signs the token:
   ```ts
   type MintResponse = { token: string; tid: string; wsUrl: string; lapUrl: string; expiresAt: number }
   ```
4. Browser stores `tid` in `localStorage['llui-agent.tids']`, opens WS to `wsUrl` with `Authorization: Bearer <token>`.
5. Server flips status to `awaiting-claude`. `agentConnect.pendingToken` populates with the connect snippet:
   ```
   /llui-connect https://myapp.com/agent/lap/v1 llui-agent_…
   ```
6. User pastes into Claude Desktop. Bridge calls `llui_connect_session({ url, token })`, pings `/lap/v1/describe`, caches schema, marks pairing `active`.

### 5.3 Resume flow

1. Tab closes or WS disconnects ungracefully → server marks pairing `pending-resume`, starts 15-min grace window.
2. Next app load: `agentConnect` init dispatches `AgentResumeCheck` effect with stored `tids`.
3. Browser `POST {origin}/agent/resume/list { tids: string[] }`:
   ```ts
   type ResumeListResponse = { sessions: Array<{ tid: string; label: string; lastSeenAt: number }> }
   ```
4. `agentConnect.resumable` populates. App renders a resume banner.
5. User clicks Resume → browser `POST {origin}/agent/resume/claim { tid }`:
   ```ts
   type ResumeClaimResponse = { token: string; wsUrl: string }
   ```
6. Browser opens new WS. Server rebinds; pairing returns to `active`.
7. Token `tid` is preserved; only the signed payload (new `iat`/`exp`) changes. Bridge entries keyed on `tid` remain valid. If the bridge's cached token string is stale, the bridge's next tool call returns `401`; bridge tells Claude to ask the user to re-paste `/llui-connect`.

### 5.4 Revocation

`agentConnect.sessions` shows sessions from `GET {origin}/agent/sessions`. `revokeButton(tid)` fires `POST {origin}/agent/revoke { tid }`. Server response:
```ts
type RevokeResponse = { status: 'revoked' }
```
Effect: token moves to `revoked` in the store; any in-flight LAP request returns `401 revoked`; paired WS is closed with `revoked` frame. Bridge's next forwarded call returns `401`; bridge surfaces `revoked` to Claude.

### 5.5 Token record shape

```ts
type TokenStatus = 'awaiting-ws' | 'awaiting-claude' | 'active' | 'pending-resume' | 'revoked'

type TokenRecord = {
  tid: string
  uid: string | null
  status: TokenStatus
  createdAt: number
  lastSeenAt: number
  pendingResumeUntil: number | null
  origin: string
  label: string | null
}

type AgentSession = {
  tid: string
  label: string
  status: 'active' | 'pending-resume' | 'revoked'
  createdAt: number
  lastSeenAt: number
}
```

---

## 6. Audit Log

Every significant event writes an `AuditEntry`:

```ts
type AuditEvent =
  | 'mint' | 'claim' | 'resume' | 'revoke'
  | 'lap-call' | 'msg-dispatched' | 'msg-blocked'
  | 'confirm-proposed' | 'confirm-approved' | 'confirm-rejected'
  | 'rate-limited' | 'auth-failed'

type AuditEntry = {
  at: number            // Unix ms
  tid: string | null
  uid: string | null
  event: AuditEvent
  detail: object
}
```

`consoleAuditSink` writes JSON lines to stdout. Replace with a structured log sink or database writer for production.

Client-side `log-append` frames mirror client-observed actions (tool dispatches, rpc replies) into the server audit sink via `onLogAppend`. Both server-side and client-side events are captured in one timeline.

```ts
type LogKind = 'proposed' | 'dispatched' | 'confirmed' | 'rejected' | 'blocked' | 'read' | 'error'

type LogEntry = {
  id: string
  at: number
  kind: LogKind
  variant?: string      // Msg type discriminant
  intent?: string       // resolved @intent value
  detail?: string
}
```

---

## 7. Rate Limiting

```ts
interface RateLimiter {
  check(key: string, bucket: 'token' | 'identity'): Promise<{ allowed: boolean; retryAfterMs?: number }>
}
```

Default implementation: in-memory token bucket, 30/minute per token and 300/minute per identity. Applied at the start of every LAP handler before forwarding the RPC.

Pluggable: implement `RateLimiter` and pass it to `createLluiAgentServer({ rateLimiter })`. For multi-instance deployments, use a Redis-backed implementation so the limit is shared across instances.

---

## 8. Threat Model

### 8.1 What a malicious Claude can do

- **Read all state** via `get_state` and `describe_visible_content`. There is no state-level ACL in v1 — if you mint a token, Claude can read everything.
- **Dispatch any Msg without `@humanOnly`** and without `@requiresConfirm`, immediately. Claude can trigger side effects that are not confirmation-gated.
- **See the full schema** (Msg variants, payload shapes, `agentDocs`). Do not put secrets in `agentDocs` or state.

### 8.2 What a malicious Claude cannot do

- **Dispatch `@humanOnly` Msgs.** The browser runtime rejects them at the annotation check; they never reach `send()`.
- **Bypass `@requiresConfirm`.** The browser proposes to `agentConfirm` and holds the LAP response open. The user must explicitly approve.
- **Forge a token.** The HMAC signing key lives only on the server. Claude only ever sees the opaque token string.
- **Impersonate a different user.** The token is bound to the user's `uid`; the server verifies identity at every request.
- **Replay a revoked session.** Revocation is immediate — the token store entry moves to `revoked`; the next verification step rejects it.

### 8.3 What a malicious developer can do

- **Log the raw token** at mint time or intercept it. The token is a bearer credential: treat it like a session cookie.
- **Replay the token** within its TTL from any machine (no IP pinning in v1).
- **Forge Msgs** by omitting annotations from the schema (shipping `@llui/vite-plugin` with `agent: false` bypasses annotation injection). This affects only their own app — it is not a protocol-level bypass.

### 8.4 What a malicious developer cannot do (with the correct server setup)

- **Forge a token** for a different signing key — HMAC is one-way.
- **Claim another user's sessions** — `resume/claim` and `sessions` are identity-scoped.
- **Forge the browser's state** — state travels browser → server → Claude, not server → Claude directly.

### 8.5 Recommendations

- Keep `signingKey` ≥ 32 bytes, stored in a secret manager (env var, KMS, etc.).
- Scope `identityResolver` to your app's authentication — never return `null` for authenticated apps.
- Set `corsOrigins` to your app's exact origin on the meta-endpoints.
- Enable rate limiting in production — the default in-memory limiter is fine for single-instance apps.
- Require HTTPS in production; the token is a bearer credential and must not travel over plaintext.
- Review `agentDocs`, `agentContext`, and `agentAffordances` content — all is visible to Claude.

---

## 9. Schema Handoff

On WS open, the browser sends a `hello` frame carrying the compiler-emitted schemas. The server caches per `tid`:

```
cache[tid] = { appName, appVersion, msgSchema, stateSchema, affordancesSample, docs, schemaHash }
```

`/lap/v1/describe` serves from this cache (no round-trip to browser). When `schemaHash` changes (hot-reload, new deploy), the browser sends a fresh `hello` and the server updates the cache.

`schemaHash` is a stable hash over `__msgSchema + __stateSchema + annotation record`. The bridge may use it to invalidate its own `describe_app` cache across turns.

`/lap/v1/context` is **not** served from cache — it forwards an RPC frame to the browser on every call, invoking `agentContext(state)` fresh.

---

## 10. Bridge Architecture Reference

The `llui-agent` bridge is an npm-installed MCP server (unscoped package) that Claude Desktop users install once. It is stateless about app logic.

```
Map<sid, Binding>
Binding = { lapUrl: string; token: string; appName: string; schema: LapDescribeResponse; schemaHash: string }
```

Each MCP session `sid` (one per Claude chat) has at most one binding. `llui_connect_session({url, token})` sets it; `llui_disconnect_session()` clears it. MCP session close clears it.

Tool → LAP path mapping:

| MCP tool                   | LAP path              |
| -------------------------- | --------------------- |
| `describe_app`             | `/describe`           |
| `get_state`                | `/state`              |
| `list_actions`             | `/actions`            |
| `send_message`             | `/message`            |
| `get_confirm_result`       | `/confirm-result`     |
| `wait_for_change`          | `/wait`               |
| `query_dom`                | `/query-dom`          |
| `describe_visible_content` | `/describe-visible`   |
| `describe_context`         | `/context`            |

`describe_app` responses are cached per binding (keyed by `schemaHash`). All other reads are always forwarded live.

On LAP error responses (`revoked`, `auth-failed`, `paused`): bridge surfaces the `code` to Claude in a structured form so Claude can suggest the user re-paste `/llui-connect` when appropriate.

---

## 11. Public Types Index (`@llui/agent/protocol`)

| Type                          | Description                                                    |
| ----------------------------- | -------------------------------------------------------------- |
| `LapErrorCode`                | Union of error code strings                                    |
| `LapError`                    | HTTP error envelope with `code`, `detail`, `retryAfterMs`      |
| `MessageAnnotations`          | Per-variant annotation record (`intent`, flags)                |
| `MessageSchemaEntry`          | Schema + annotations for one Msg variant                       |
| `LapDescribeResponse`         | `/describe` response                                           |
| `LapStateRequest`             | `/state` request — `{ path? }`                                 |
| `LapStateResponse`            | `/state` response — `{ state }`                                |
| `LapActionsResponse`          | `/actions` response — `{ actions[] }`                          |
| `LapMessageRequest`           | `/message` request                                             |
| `LapMessageRejectReason`      | Union of rejection reason strings                              |
| `LapMessageResponse`          | `/message` discriminated response                              |
| `LapConfirmResultRequest`     | `/confirm-result` request                                      |
| `LapConfirmResultResponse`    | `/confirm-result` discriminated response                       |
| `LapWaitRequest`              | `/wait` request                                                |
| `LapWaitResponse`             | `/wait` discriminated response                                 |
| `LapQueryDomRequest`          | `/query-dom` request                                           |
| `LapQueryDomResponse`         | `/query-dom` response                                          |
| `OutlineNode`                 | One node in the visible-content outline                        |
| `LapDescribeVisibleResponse`  | `/describe-visible` response                                   |
| `LapContextResponse`          | `/context` response                                            |
| `AgentDocs`                   | Static app documentation (`purpose`, `overview`, `cautions`)   |
| `AgentContext`                | Dynamic per-state context (`summary`, `hints`, `cautions`)     |
| `LapEndpointMap`              | Map of short endpoint names to LAP paths                       |
| `LapPath`                     | Union of valid LAP path strings                                |
| `LapRequest<P>`               | Generic LAP request envelope                                   |
| `LapResponse<P>`              | Generic LAP response envelope                                  |
| `LogKind`                     | Log entry kind union                                           |
| `LogEntry`                    | One audit/log entry                                            |
| `HelloFrame`                  | Browser → server WS opening frame                             |
| `RpcReplyFrame`               | Browser → server RPC reply                                     |
| `RpcErrorFrame`               | Browser → server RPC error                                     |
| `ConfirmResolvedFrame`        | Browser → server confirmation outcome                          |
| `StateUpdateFrame`            | Browser → server state push (for `/wait`)                      |
| `LogAppendFrame`              | Browser → server log mirror                                    |
| `ClientFrame`                 | Union of all browser-sends-server frames                       |
| `RpcFrame`                    | Server → browser RPC dispatch                                  |
| `RevokedFrame`                | Server → browser revocation notice                             |
| `ServerFrame`                 | Union of all server-sends-browser frames                       |
| `AgentToken`                  | Opaque signed token string type alias                          |
| `TokenPayload`                | Decoded token payload (`tid`, `iat`, `exp`, `scope`)           |
| `TokenStatus`                 | Token lifecycle status union                                   |
| `TokenRecord`                 | Full token store record                                        |
| `AgentSession`                | Session record as seen by the browser client                   |
| `MintRequest`                 | `/agent/mint` request body                                     |
| `MintResponse`                | `/agent/mint` response                                         |
| `ResumeListRequest`           | `/agent/resume/list` request                                   |
| `ResumeListResponse`          | `/agent/resume/list` response                                  |
| `ResumeClaimRequest`          | `/agent/resume/claim` request                                  |
| `ResumeClaimResponse`         | `/agent/resume/claim` response                                 |
| `RevokeRequest`               | `/agent/revoke` request                                        |
| `RevokeResponse`              | `/agent/revoke` response                                       |
| `SessionsResponse`            | `/agent/sessions` response                                     |
| `AuditEvent`                  | Union of audit event name strings                              |
| `AuditEntry`                  | One structured audit log entry                                 |

---

## 12. Known Deferred Items (v1)

- **Playwright E2E tests:** Real browser + real MCP client + agent server end-to-end. Significant infra; tracked as follow-up.
- **`examples/agent-demo/`:** Scaffolded host-app example. The README snippet covers v1.
- **Bridge `--http` transport:** HTTP-MCP clients. Trivial to add; not needed for Claude Desktop.
- **`--doctor` CLI flag:** Connectivity diagnostics for bridge → server → browser. Follow-up.
- **Persistent `TokenStore` adapters:** SQLite, Redis, Postgres. In-memory only in v1.
- **Stateful bindings / predicate `wait_for_change`:** Path-equality only in v1.
- **Multi-root component selection:** V1 assumes a single mounted root.
- **Bridge persistent binding memory:** Bindings are in-memory; restart drops them.
- **SSE upgrade for `/lap/v1/events`:** Long-poll covers v1; SSE is a future optimization.
