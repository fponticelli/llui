# llui-agent

MCP bridge for the [LLui Agent Protocol](../../docs/superpowers/specs/2026-04-19-llui-agent-design.md). Install once into your LLM client; paste a `/llui-connect <url> <token>` into any Claude conversation to bind it to a running LLui app.

## Install (Claude Desktop)

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or equivalent on your OS:

```json
{
  "mcpServers": {
    "llui": {
      "command": "npx",
      "args": ["-y", "llui-agent"]
    }
  }
}
```

Restart Claude Desktop. The 11 LLui tools (`llui_connect_session`, `llui_disconnect_session`, `describe_app`, `get_state`, `list_actions`, `send_message`, `get_confirm_result`, `wait_for_change`, `query_dom`, `describe_visible_content`, `describe_context`) and the `/llui-connect` prompt now appear in Claude.

## Use

Open any LLui app that's built with `@llui/agent/client`. Click "Connect with Claude" in the app. Copy the generated `/llui-connect <url> <token>` string into Claude. Claude will now talk to that specific app instance.

Each Claude chat is bound to ONE LLui app at a time. To switch, run `/llui-disconnect` or start a new chat.

## How it works

1. Your LLui app mints a per-browser-session token and shows a `/llui-connect` string.
2. You paste into Claude — the bridge records `{url, token}` for this chat.
3. The bridge pings `POST {url}/describe` to validate and cache the app's schema.
4. Subsequent Claude tool calls (`get_state`, `send_message`, etc.) forward to `{url}/<path>` with your token as a Bearer.
5. Sensitive actions (`@requiresConfirm` in the app's code) route through a confirmation prompt that only the user can approve.
