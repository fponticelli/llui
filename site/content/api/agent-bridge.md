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
3. Paste it into Claude. Claude calls `llui_connect_session`; the bridge caches the URL + token for this session and validates by pinging `/describe`.

From then on, every MCP tool Claude calls routes through the bound LAP endpoint. `llui_disconnect_session` clears the binding.

## Tools

### Meta tools

| Tool                      | Purpose                                             |
| ------------------------- | --------------------------------------------------- |
| `llui_connect_session`    | Bind this conversation to a LAP URL + bearer token. |
| `llui_disconnect_session` | Clear the binding.                                  |

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

```typescript
function createBridgeServer(deps: BridgeDeps): McpServer
```

## Types

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

## Constants

### `TOOLS`

The MCP tools Claude sees. Two tiers:

- Efficient path (recommended): `observe` + `send_message`.
  `observe` returns state + actions + description + context in one
  call — replacing the old describe_app + get_state + list_actions
  trio. `send_message` defaults to `waitFor: 'drained'`, blocking
  until the message queue goes idle (http/delay/debounce round
  trips complete), then returns the new state + actions + drain
  meta. Together these cut the "check state → act → check state"
  loop from 5 round-trips to 2.
- Legacy / specialized: `describe_app`, `get_state`, `list_actions`,
  `wait_for_change`. Kept for back-compat and niche uses (e.g.
  scoped state reads via JSON pointer, external state pushes). New
  integrations should prefer `observe`.
  Spec §8.

```typescript
const TOOLS: ListToolsResult['tools']
```

<!-- auto-api:end -->
