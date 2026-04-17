---
title: '@llui/mcp'
description: 'MCP server exposing LLM debug tools via Model Context Protocol'
---

# @llui/mcp

[Model Context Protocol](https://spec.modelcontextprotocol.io/) server for [LLui](https://github.com/fponticelli/llui). Exposes debug tools for LLM-assisted development.

```bash
pnpm add -D @llui/mcp
```

## Usage

The MCP server auto-connects to running LLui apps via the vite-plugin's `mcpPort` bridge (default port 5200). No manual setup needed -- just enable the plugin and point your MCP client at the server.

```ts
// vite.config.ts -- MCP is enabled by default
import llui from '@llui/vite-plugin'
export default defineConfig({ plugins: [llui({ mcpPort: 5200 })] })
```

## Tools

### State Inspection

| Tool             | Description                        |
| ---------------- | ---------------------------------- |
| `get_state`      | Get current component state        |
| `describe_state` | Describe state shape and types     |
| `search_state`   | Search state tree by path or value |

### Messaging

| Tool               | Description                              |
| ------------------ | ---------------------------------------- |
| `send_message`     | Dispatch a message to the component      |
| `validate_message` | Check if a message matches the Msg union |

### History and Replay

| Tool                  | Description                            |
| --------------------- | -------------------------------------- |
| `get_message_history` | List all dispatched messages           |
| `export_trace`        | Export message trace for `replayTrace` |
| `replay_trace`        | Replay a trace and compare states      |

### Bindings and DOM

| Tool             | Description                                    |
| ---------------- | ---------------------------------------------- |
| `get_bindings`   | List all active bindings and their masks       |
| `why_did_update` | Explain which state change triggered a binding |
| `trace_element`  | Trace a DOM element back to its binding        |

### Bitmask Debugging

| Tool          | Description                            |
| ------------- | -------------------------------------- |
| `decode_mask` | Decode a bitmask into state path names |
| `mask_legend` | Show the full bit-to-path mapping      |

### Snapshots

| Tool             | Description                         |
| ---------------- | ----------------------------------- |
| `snapshot_state` | Save a named state snapshot         |
| `restore_state`  | Restore a previously saved snapshot |

### Multi-Mount

| Tool               | Description                                |
| ------------------ | ------------------------------------------ |
| `list_components`  | List all mounted component instances       |
| `select_component` | Select a component for subsequent commands |

<!-- auto-api:start -->

## Functions

### `findWorkspaceRoot()`

Walk up from `start` until we find a workspace root marker. Used by
both the MCP server (writing the active marker) and the Vite plugin
(watching it) so they agree on a single shared location regardless of
which subdirectory each process happens to be running in.
Strong markers (workspace root): pnpm-workspace.yaml, .git directory.
If neither is found anywhere up the chain, falls back to the highest
package.json above `start`. For pnpm monorepos this finds the workspace
root from any subpackage; for single-package projects it finds the
package root.

```typescript
function findWorkspaceRoot(start: string = process.cwd()): string
```

### `mcpActiveFilePath()`

Path where the MCP server writes its active port marker. Vite plugins
watch this file to auto-trigger browser-side `__lluiConnect()` whenever
the MCP server starts, regardless of whether Vite or MCP started first.
Resolved relative to the workspace root (not the immediate cwd) so the
MCP server and the Vite plugin always agree on a single location even
when one runs from the repo root and the other from a subpackage.

```typescript
function mcpActiveFilePath(cwd: string = process.cwd()): string
```

## Interfaces

### `JsonRpcRequest`

```typescript
interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: Record<string, unknown>
}
```

### `JsonRpcResponse`

```typescript
interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}
```

## Classes

### `LluiMcpServer`

```typescript
class LluiMcpServer {
  registry: ToolRegistry
  relay: WebSocketRelayTransport
  bridgePort: number
  devUrl: string | null
  constructor(bridgePort = 5200)
  connectDirect(api: LluiDebugAPI): void
  setDevUrl(url: string): void
  startBridge(): void
  stopBridge(): void
  writeActiveFile(): void
  removeActiveFile(): void
  getTools(): ToolDefinition[]
  handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown>
  start(): void
  handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse>
}
```

## Constants

### `mcpToolDefinitions`

Snapshot of all registered tool definitions. Kept as a named export for
backward compatibility with downstream consumers that used to import the
`TOOLS` array re-export under this alias.

```typescript
const mcpToolDefinitions: ToolDefinition[]
```

<!-- auto-api:end -->
