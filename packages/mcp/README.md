# @llui/mcp

[Model Context Protocol](https://spec.modelcontextprotocol.io/) server for [LLui](https://github.com/fponticelli/llui). Exposes debug tools for LLM-assisted development.

```bash
pnpm add -D @llui/mcp
```

## Usage

The MCP server has two transports and two usage patterns.

### Plugin-launched (recommended): one-terminal dev

Install `@llui/mcp` as a dev dependency. The Vite plugin auto-detects the package and spawns `llui-mcp --http` as a child of the dev server. One `pnpm dev` starts everything; no second terminal, no stdio fuss.

```ts
// vite.config.ts
import llui from '@llui/vite-plugin'
export default defineConfig({ plugins: [llui()] })
```

Point your MCP client (e.g. Claude Code) at the HTTP endpoint. In `.mcp.json`:

```json
{
  "mcpServers": {
    "llui": {
      "type": "http",
      "url": "http://127.0.0.1:5200/mcp"
    }
  }
}
```

The MCP protocol runs on `POST /mcp`; the browser-relay WebSocket bridge shares the same port via upgrade on `/bridge`.

### Stdio (manual spawn): traditional MCP client

If your MCP client spawns servers over stdio (the older pattern), run the CLI without `--http`:

```json
{
  "mcpServers": {
    "llui": {
      "command": "npx",
      "args": ["llui-mcp"]
    }
  }
}
```

The server talks stdio to the client and stands up its own WebSocket bridge on port 5200 for the browser relay. With this pattern, set `mcpPort: 5200` explicitly in the Vite plugin so it wires to the externally-managed server instead of spawning its own:

```ts
export default defineConfig({ plugins: [llui({ mcpPort: 5200 })] })
```

### Troubleshooting: `llui-mcp doctor`

If a tool call returns a `bridge-unavailable` error or Claude simply can't talk to a running app, run the doctor to see what's wrong:

```bash
npx llui-mcp doctor
```

It checks, in order:

- Is the active-marker file at `node_modules/.cache/llui-mcp/active.json` present?
- Is the marker JSON parseable?
- Has the Vite plugin stamped its `devUrl` into the marker?
- Is the bridge port listening on 127.0.0.1?
- Is the PID recorded in the marker still alive?

Each check prints `✓` or `✗` with a one-line detail. Exit code is 0 when everything passes, 1 when any check fails.

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

> **Runtime surface.** The signal runtime's debug API (`installSignalDebug`)
> implements the state / message / schema / snapshot methods above. The legacy
> per-binding introspection tools (get_bindings, why_did_update, decode_mask,
> mask_legend, scope_tree, force_rerender, each_diff, inspect_element,
> get_rendered_html, dispatch_event, dom_diff, get_focus, mock_effect,
> step_back, coverage, …) and the two-word-bitmask model they described belong
> to the deleted legacy runtime and are **not** registered — no runtime can
> serve them. Reactivity is a chunked mask with no per-binding legend. For
> compile-time rule checks use `llui_lint` (single file) or
> `llui_compiler_diagnostics` (a directory).

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

### Utilities

| Tool             | Description                                                    |
| ---------------- | -------------------------------------------------------------- |
| `diff_state`     | Structured JSON diff between two state values                  |
| `assert`         | Evaluate eq/neq/exists/gt/lt/in against a state path           |
| `search_history` | Filter history by type, statePath change, effectType, or range |

### Eval

| Tool   | Description                                                           |
| ------ | --------------------------------------------------------------------- |
| `eval` | Arbitrary JS in page context; returns result + observability envelope |
