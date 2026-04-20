# @llui/agent

Server and browser-client libraries for the [LLui Agent Protocol (LAP)](../../docs/superpowers/specs/2026-04-19-llui-agent-design.md).

Under construction. Install is not yet recommended.

## Entry points

- `@llui/agent/protocol` — shared types for LAP, relay WS frames, tokens, audit.
- `@llui/agent/server` — LAP server + mint/resume/revoke/sessions endpoints (in development).
- `@llui/agent/client` — browser runtime: `agentConnect`, `agentConfirm`, `agentLog` (in development).

See the [design spec](../../docs/superpowers/specs/2026-04-19-llui-agent-design.md) for the full picture.
