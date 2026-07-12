---
title: '@llui/agent-bridge'
description: 'MCP server CLI (llui-agent) that translates Claude Desktop tool calls to LAP — the wire between an MCP client and an LLui app'
---

# @llui/agent-bridge

The MCP bridge that lets Claude Desktop (and other MCP clients) drive an LLui app. Companion to [`@llui/agent`](/api/agent) — the bridge speaks MCP on one side and [LAP](/api/agent) on the other.

```bash
npm install -g llui-agent
```

The package ships a single CLI, `llui-agent`, which runs a stdio MCP server. You don't import this package — you configure Claude Desktop to spawn it.

## Claude Desktop configuration

Add the bridge to your MCP config (on macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "llui": { "command": "llui-agent" }
  }
}
```

Restart Claude Desktop. The LLui tools appear in the tool picker.

## Binding a conversation

Each conversation targets at most one LLui app. Before any LLui tool call, bind the session:

1. In your app, mint a token (your app's agent connect slice produces the mint request).
2. The app displays `/llui-connect <lap-url> <token>` — copy it.
3. Paste it into Claude. Claude calls `connect_session`; the bridge caches the URL + token for this session and validates by pinging `/describe`.

From then on, every MCP tool Claude calls routes through the bound LAP endpoint. `disconnect_session` clears the binding.

## Tools

### Meta tools

| Tool                 | Purpose                                             |
| -------------------- | --------------------------------------------------- |
| `connect_session`    | Bind this conversation to a LAP URL + bearer token. |
| `disconnect_session` | Clear the binding.                                  |

### Recommended path

| Tool           | Purpose                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `observe`      | One call returns `{state, actions, description, context}` — replaces the legacy bootstrap trio.    |
| `send_message` | Dispatch a Msg; by default waits for the message queue to drain (http/delay/debounce round-trips). |

**`send_message` controls:**

- `waitFor: 'drained' | 'idle' | 'none'` — `'drained'` (default) waits for quiescence; `'idle'` flushes the synchronous cycle only; `'none'` is fire-and-forget.
- `drainQuietMs` — no-commit window size. Default 100ms.
- `timeoutMs` — hard cap. Default 5000ms. Partial results return with `drain.timedOut: true`.

The response envelope includes the new `stateAfter`, fresh `actions`, and a `drain` block with `effectsObserved`, `durationMs`, `timedOut`, and any effect-thrown `errors` captured during the window.

### Legacy / specialized

| Tool                       | Purpose                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `describe_app`             | Static app metadata. Cached after the first call.                                                                     |
| `get_state`                | Full state or a JSON-pointer slice. Prefer `observe`; use this for scoped reads.                                      |
| `list_actions`             | Currently-affordable actions. Subsumed by `observe`.                                                                  |
| `get_confirm_result`       | Poll a `pending-confirmation` by `confirmId`.                                                                         |
| `wait_for_change`          | Long-poll for an external state change (e.g. WebSocket push). `send_message` waits already for LLM-initiated changes. |
| `query_dom`                | Read elements tagged with `data-agent="<name>"`.                                                                      |
| `describe_visible_content` | Structured outline of the visible `data-agent`-tagged subtrees.                                                       |
| `describe_context`         | Current `agentContext(state)` output.                                                                                 |

## See also

- [`@llui/agent`](/api/agent) — full adoption guide: annotations, component metadata, DOM tagging, production server setup, security.

<!-- auto-api:start -->

## Functions

### `createBridgeServer()`

Builds the bridge's MCP server using the high-level `McpServer`
registrars. Each tool's Zod schema (declared once in `tools.ts`)
drives both runtime input validation and the JSON Schema published
to `tools/list` — eliminating the hand-written-schema-vs-handler
drift that the low-level `setRequestHandler` pattern is prone to.
Forwarded tools (`kind: 'forward'`) share the `@llui/agent/mcp/executor`
dispatch — the same code the server-side MCP runs — so describe
caching, schemaHash invalidation, and error shaping behave identically
across both surfaces. The two meta tools (`connect_session`,
`disconnect_session`) carry custom handlers that mutate the BindingMap
directly, then delegate to the shared connect prefetch.

```typescript
function createBridgeServer(deps: BridgeDeps): McpServer
```

### `detectSchemaChange()`

Compare a freshly-fetched app description against the cached one and
decide whether the cached schema is now stale. A changed `schemaHash`
means the app's Msg/State schema was recompiled — cached
affordances/examples/payload shapes may no longer be valid, so the
caller is told to re-read before dispatching. Exported so the
invalidation policy is unit-testable in isolation.

```typescript
export declare function detectSchemaChange(
  prev: LapDescribeResponse | null,
  next: Pick<LapDescribeResponse, 'schemaHash'>,
): {
  changed: boolean
  note: string | null
}
```

## Types

### `Binding`

```typescript
export type Binding = {
  url: string // LAP base path, e.g. "https://app/agent/lap/v1"
  token: string
  describe: LapDescribeResponse | null // cached describe_app response; populated on bind
}
```

### `BridgeDeps`

```typescript
export type BridgeDeps = {
  /** Injectable for tests. */
  fetch?: typeof fetch
  /** MCP session ID for this client. In stdio mode there's one session; derive from the Server instance. */
  sessionId: string
  /** Shared binding map (one BindingMap per process). */
  bindings: BindingMap
  /** Package version — set from package.json at boot. */
  version: string
}
```

## Classes

### `BindingMap`

Per-MCP-session map. Keyed by the SDK's session id (one per Claude
conversation). Spec §11.3.

```typescript
class BindingMap {
  map
  set(sessionId: string, url: string, token: string): void
  get(sessionId: string): Binding | null
  setDescribe(sessionId: string, describe: LapDescribeResponse): void
  clear(sessionId: string): void
  has(sessionId: string): boolean
}
```

<!-- auto-api:end -->
