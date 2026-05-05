---
title: Talk to LLui Apps via Claude
description: 'Install the LLui Agent once into Claude. Drive any LLui-built app from the conversation.'
---

# Talk to LLui Apps via Claude

LLui apps can be driven from Claude. Install the `llui-agent` MCP bridge
once, paste a connect snippet from any LLui-built app, and Claude can
read the app's state, list available actions, and dispatch messages —
the same Msgs the human user dispatches with clicks and keys.

This page is for **end users** installing the agent and **app authors**
who want to expose their app to it. If you're debugging code you wrote,
see [Debugging LLui Apps](/debugging) instead.

## Install (Claude Desktop)

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or the equivalent on your OS:

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

Restart Claude Desktop. Eleven LLui tools become available:
`connect_session`, `disconnect_session`, `describe_app`,
`get_state`, `list_actions`, `send_message`, `get_confirm_result`,
`wait_for_change`, `query_dom`, `describe_visible_content`,
`describe_context`.

## Install (Claude Code CLI)

```bash
claude mcp add --transport stdio llui -- npx -y llui-agent
```

Run `/mcp` inside Claude Code to confirm the server connected (or start
a new session). The same eleven tools become available.

> **If you run Claude Code in auto mode** (`permissions.defaultMode: "auto"`
> in `~/.claude/settings.json`), the auto-classifier silently rejects
> unrecognized MCP tools the first time they're called — Claude reports
> "tool was rejected" but no UI prompt is shown. Add the bridge's tools
> to your allowlist once:
>
> ```jsonc
> // ~/.claude/settings.json
> {
>   "permissions": {
>     "allow": ["mcp__llui__*"], // replace `llui` with the name you used in `claude mcp add`
>   },
> }
> ```

## Upgrading an existing install

`npx -y llui-agent` caches the first-resolved version under
`~/.npm/_npx/`, so subsequent invocations don't re-check npm — an
existing user stays pinned to whatever shipped the day they ran the
install command. To pick up a new release:

1. **Pin `@latest` in the MCP config** so the cache key changes. In
   Claude Desktop, edit the `args` to `["-y", "llui-agent@latest"]`. In
   Claude Code, run:
   ```bash
   claude mcp remove llui
   claude mcp add --transport stdio llui -- npx -y llui-agent@latest
   ```
   Alternative: leave the spec alone and clear the cache once with
   `rm -rf ~/.npm/_npx`. Same effect, fewer config edits — but you'll
   need the same poke at the next breaking release.
2. **Restart the MCP client.** The tool list is fixed at session start,
   so quit + reopen Claude Desktop, or start a new Claude Code session.
3. **Start a fresh chat.** A conversation that was bound under old
   tool names won't see the new ones until it restarts. Paste a fresh
   connect snippet from the app — the snippet wording also evolves
   between releases, so the new one is worth grabbing.

Verify with `claude mcp list` (Code) or by checking the tool picker
(Desktop). Tool names from `llui-agent@0.0.5+` are `connect_session` /
`disconnect_session` (no `llui_` prefix); earlier releases used
`llui_connect_session` / `llui_disconnect_session`.

## Use it

Open any app built with `@llui/agent/client`. Click "Connect with
Claude" and copy the generated snippet — a one-line natural-language
instruction containing the LAP URL and the bearer token. Paste it into
Claude. Claude reads the snippet, calls `connect_session`, and the
chat is now bound to that app.

Each Claude chat is bound to **one LLui app at a time**. To switch, ask
Claude to call `disconnect_session` and paste a new snippet.

### Troubleshooting: "tool isn't available in this session"

If Claude reports that `connect_session` "isn't available" or
"doesn't appear in the list of deferred or loaded tools", check that
`claude mcp list` shows the LLui MCP server as Connected. If it is, the
issue is tool-name resolution: Claude Code namespaces MCP tools as
`mcp__<server-name>__<tool-name>` and may defer-load them. Tell Claude
to look for `mcp__<server>__connect_session` and search for it via
the tool-search facility — it will load and become callable. The
snippets shipped by recent `@llui/agent` releases already include this
hint; paste a fresh snippet if you're stuck.

## Slash shortcuts (optional)

The bridge registers an MCP prompt named `llui-connect`. Both clients
expose it as a slash command, but the namespacing differs:

| Client          | Shortcut                                          |
| --------------- | ------------------------------------------------- |
| Claude Desktop  | `/llui-connect <url> <token>`                     |
| Claude Code CLI | `/mcp__<server-name>__llui-connect <url> <token>` |

`<server-name>` is whatever you passed to `claude mcp add` — `llui` if
you used the command above. The natural-language snippet from the app
works the same in either client and doesn't depend on the server-name
choice; the slash form is a power-user shortcut.

## How it works

1. The LLui app mints a per-browser-session token and renders a
   connect snippet — a one-line instruction containing the LAP URL and
   the bearer token.
2. You paste into Claude. Claude reads the snippet, calls
   `connect_session`, and the bridge records `{url, token}` for
   this chat.
3. The bridge calls `POST {url}/describe` to validate and cache the
   app's schema (Msg union, intents, annotations).
4. Subsequent tool calls (`get_state`, `send_message`, etc.) forward to
   `{url}/<path>` with your token as a Bearer.
5. Sensitive actions marked `@requiresConfirm` in the app code route
   through a confirmation prompt — only the human user can approve them.

## Confirmation: keeping humans in the loop

Apps mark sensitive Msg variants with `@requiresConfirm`:

```ts
type Msg =
  | { type: 'inc' }
  /** @intent("Delete item") @requiresConfirm */
  | { type: 'delete'; id: string }
  /** @intent("Place order") @humanOnly */
  | { type: 'checkout' }
```

| Tag                | Effect                                                       |
| ------------------ | ------------------------------------------------------------ |
| `@requiresConfirm` | Claude proposes; the user approves before dispatch.          |
| `@humanOnly`       | Claude can't dispatch; not listed in `list_actions`.         |
| (default)          | Claude can dispatch directly; logged in the agent log panel. |

Sensitive actions never reach the reducer until a human clicks Approve
in the app's confirm card. The bridge's `get_confirm_result` lets Claude
poll the result and continue the conversation.

## For app authors: expose your app

Apps opt in by installing `@llui/agent` and enabling the Vite plugin's
agent-metadata emission:

```bash
pnpm add @llui/agent @llui/effects
```

```ts
// vite.config.ts
import llui from '@llui/vite-plugin'
export default { plugins: [llui({ agent: true })] }
```

### Server

```ts
import { createLluiAgentServer } from '@llui/agent/server'
import express from 'express'

const agent = createLluiAgentServer({
  identityResolver: async (req) => req.cookies.user_id ?? null,
})

const app = express()
app.use('/agent', async (req, res) => {
  const webReq = expressToWebRequest(req)
  const webRes = await agent.router(webReq)
  if (!webRes) {
    res.status(404).end()
    return
  }
  webRes.headers.forEach((v, k) => res.setHeader(k, v))
  res.status(webRes.status).send(await webRes.text())
})

const server = app.listen(8787)
server.on('upgrade', agent.wsUpgrade)
```

### Client

```ts
import { mountApp } from '@llui/dom'
import { createAgentClient, agentConnect, agentConfirm } from '@llui/agent/client'
import { handleEffects } from '@llui/effects'
import { App } from './App'

const root = document.getElementById('app')!
const handle = mountApp(root, App)

const client = createAgentClient({
  handle,
  def: App,
  rootElement: root,
  slices: {
    getConnect: (s) => s.agent.connect,
    getConfirm: (s) => s.agent.confirm,
    wrapConnectMsg: (m) => ({ type: 'agent', sub: 'connect', msg: m }),
    wrapConfirmMsg: (m) => ({ type: 'agent', sub: 'confirm', msg: m }),
  },
})
client.start()
```

Render `agentConnect` (the "Connect with Claude" button + token copy box)
and `agentConfirm` (pending confirmation cards) anywhere in your view tree.

### Annotate the Msg union

LLM-driven actions are discovered through JSDoc tags on the Msg variants:

```ts
type Msg =
  /** @intent("Increment the counter") */
  | { type: 'inc' }
  /** @intent("Delete item") @requiresConfirm */
  | { type: 'delete'; id: string }
  /** @intent("Place order") @humanOnly */
  | { type: 'checkout' }
  /** @intent("Navigate") @alwaysAffordable */
  | { type: 'nav'; to: 'reports' | 'settings' | 'home' }
```

| Tag                 | Semantics                                                     |
| ------------------- | ------------------------------------------------------------- |
| `@intent("...")`    | Human-readable label for Claude, the confirm UI, and logs.    |
| `@alwaysAffordable` | Surfaces to Claude even when no binding is currently visible. |
| `@requiresConfirm`  | Claude proposes; user approves before dispatch.               |
| `@humanOnly`        | Claude cannot dispatch; not in `list_actions`.                |

App-level annotations (`agentDocs.purpose`, `agentDocs.overview`,
`agentDocs.cautions`, `agentAffordances`, `agentContext`) attach to the
component itself and shape what Claude sees in `describe_app` and
`describe_context`. Per-field `@should("...")` hints document expected
shapes for payload fields.

For the full grammar, compiler passes, tool surface, and ESLint rule
list, see [Design Doc 11 — Agent Annotations and
Tools](https://github.com/fponticelli/llui/blob/main/docs/designs/11%20Agent%20Annotations%20and%20Tools.md).
For the wire protocol, token format, and threat model, see [Design
Doc 10 — Agent
Protocol](https://github.com/fponticelli/llui/blob/main/docs/designs/10%20Agent%20Protocol.md).

## Tokens

LLui agent tokens are opaque random bearer tokens — `agt_` plus
43 base64url characters. They carry 32 bytes of CSPRNG entropy and are
stored server-side as SHA-256 hashes only, so the wire form never
matches what's in the token store. Tokens are scoped to a single
browser session and can be revoked from the connect panel at any time.
