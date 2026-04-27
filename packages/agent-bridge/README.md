# llui-agent

MCP bridge for the [LLui Agent Protocol](../../docs/superpowers/specs/2026-04-19-llui-agent-design.md). Install once into your LLM client; paste the connect snippet from any LLui app to bind the conversation to that app.

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

Restart Claude Desktop. The 11 LLui tools (`connect_session`, `disconnect_session`, `describe_app`, `get_state`, `list_actions`, `send_message`, `get_confirm_result`, `wait_for_change`, `query_dom`, `describe_visible_content`, `describe_context`) now appear. Desktop exposes the bundled `llui-connect` MCP prompt as a slash command — see "Slash shortcuts" below.

## Install (Claude Code CLI)

```bash
claude mcp add --transport stdio llui -- npx -y llui-agent
```

For local development against unpublished bridge code, point at the built CLI instead:

```bash
claude mcp add --transport stdio llui -- node /absolute/path/to/llui/packages/agent-bridge/dist/cli.js
```

Run `/mcp` inside CC to confirm the server connected (or start a new session). The same 11 tools become available.

> **If you run CC in auto mode** (`permissions.defaultMode: "auto"` in `~/.claude/settings.json`), the auto-classifier silently rejects unrecognized MCP tools the first time they're called — Claude reports "tool was rejected" but no UI prompt is shown. Add the bridge's tools to your allowlist once so subsequent calls go through:
>
> ```jsonc
> // ~/.claude/settings.json
> {
>   "permissions": {
>     "allow": [
>       "mcp__llui__*", // replace `llui` with the name you used in `claude mcp add`
>     ],
>   },
> }
> ```
>
> Users on `defaultMode: "default"` or `"ask"` instead get a permission prompt on the first call and don't need this allowlist entry.

## Use

Open any LLui app built with `@llui/agent/client`. Click "Connect with Claude" in the app and copy the generated snippet. Paste it into Claude — the snippet is a natural-language instruction containing the URL and token. Claude reads it and calls `connect_session` to bind. The same snippet works in Desktop and CC.

Each Claude chat is bound to ONE LLui app at a time. To switch, ask Claude to call `disconnect_session` and paste a new snippet.

## Slash shortcuts (optional)

The bridge registers an MCP prompt named `llui-connect`. Both clients surface it as a slash command, but the namespacing differs:

| Client          | Shortcut                                          |
| --------------- | ------------------------------------------------- |
| Claude Desktop  | `/llui-connect <url> <token>`                     |
| Claude Code CLI | `/mcp__<server-name>__llui-connect <url> <token>` |

The `<server-name>` in CC is whatever you passed to `claude mcp add` — `llui` if you used the command above. Power-user shortcut only; the natural-language snippet from the app works the same in either client and doesn't depend on the server-name choice.

## How it works

1. Your LLui app mints a per-browser-session token and renders a connect snippet — a one-line instruction containing the LAP URL and the bearer token.
2. You paste into Claude — Claude reads the snippet, calls `connect_session`, and the bridge records `{url, token}` for this chat.
3. The bridge pings `POST {url}/describe` to validate and cache the app's schema.
4. Subsequent Claude tool calls (`get_state`, `send_message`, etc.) forward to `{url}/<path>` with your token as a Bearer.
5. Sensitive actions (`@requiresConfirm` in the app's code) route through a confirmation prompt that only the user can approve.
