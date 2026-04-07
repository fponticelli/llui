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

## License

MIT
