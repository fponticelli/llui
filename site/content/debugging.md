---
title: Debugging LLui Apps
description: 'Debug LLui apps interactively from the browser console or an MCP-connected LLM.'
---

# Debugging LLui Apps

LLui ships a unified debug API that gives you the same view of a running
app from three places:

- **The browser console** — `window.__lluiDebug` exposes the full surface.
- **An MCP-connected LLM** — `@llui/mcp` wraps the same API as Model
  Context Protocol tools, so Claude Code or Claude Desktop can drive the
  debugger interactively.
- **Idiomatic-code feedback** — `llui_lint` checks generated source
  against the compiler's 41 idiomatic-LLui rules without needing a build.

This page is for developers writing LLui code. If you're an end user who
wants to drive an LLui app via Claude, see the [Agents
guide](/agents) instead.

## In-page console: `window.__lluiDebug`

When the Vite plugin is active in dev, the runtime publishes the debug
API on `window.__lluiDebug`. Open DevTools and start poking:

```js
__lluiDebug.getState()
__lluiDebug.send({ type: 'inc' })
__lluiDebug.whyDidUpdate(/* binding index */ 7)
__lluiDebug.decodeMask(0b1010)
__lluiDebug.snapshotState('before-edit')
__lluiDebug.restoreState('before-edit')
__lluiDebug.exportTrace()
```

The full catalog covers state inspection, message dispatch, binding and
scope inspection, effect control, time travel, coverage, and arbitrary
in-page evaluation. Everything that follows in this guide is the same
catalog wrapped for an MCP client.

## MCP server: `@llui/mcp`

`@llui/mcp` exposes the debug API as MCP tools so an LLM can call them
directly. The Vite plugin auto-detects the package and spawns the
server alongside the dev server — one `pnpm dev` starts everything.

```bash
pnpm add -D @llui/mcp
```

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'

export default defineConfig({ plugins: [llui()] })
```

Point your MCP client at the HTTP endpoint:

```json
// .mcp.json (Claude Code)
{
  "mcpServers": {
    "llui": {
      "type": "http",
      "url": "http://127.0.0.1:5200/mcp"
    }
  }
}
```

The MCP protocol runs on `POST /mcp`; the browser-relay WebSocket bridge
shares the port via upgrade on `/bridge`.

### Stdio mode

Older MCP clients that spawn servers over stdio can run the CLI directly:

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

In stdio mode, the server stands up its own bridge on port 5200. Set
`mcpPort: 5200` in the Vite plugin so it wires to the externally-managed
server instead of spawning its own:

```ts
export default defineConfig({ plugins: [llui({ mcpPort: 5200 })] })
```

## Tool catalog

The MCP server exposes the same operations available on
`window.__lluiDebug`. Categories below; each tool name is what you call
from the LLM client.

**State.** `get_state`, `describe_state`, `search_state`, `diff_state`,
`assert`.

**Messaging.** `send_message`, `validate_message`, `get_message_history`,
`search_history`.

**Bindings and DOM.** `get_bindings`, `why_did_update`, `trace_element`,
`inspect_element`, `get_rendered_html`, `dom_diff`, `dispatch_event`,
`get_focus`.

**Bitmask.** `decode_mask`, `mask_legend`, `binding_graph`.

**Scope and bindings (advanced).** `force_rerender`, `each_diff`,
`scope_tree`, `disposer_log`, `list_dead_bindings`.

**Effects.** `pending_effects`, `effect_timeline`, `mock_effect`,
`resolve_effect`.

**Snapshots and time travel.** `snapshot_state`, `restore_state`,
`step_back`, `export_trace`, `replay_trace`.

**Coverage and analysis.** `coverage` (per-Msg variant fire counts +
never-fired list).

**Multi-mount.** `list_components`, `select_component`.

**Eval.** `eval` (arbitrary JS in page context with observability envelope).

For exhaustive parameter shapes, see the [`@llui/mcp` API
reference](/api/mcp).

## `llui_lint`: idiomatic-code checks without a build

When you ask an LLM to write or edit LLui code, call `llui_lint` to
check the result against the compiler's 41 idiomatic-LLui rules:

```jsonc
// LLM tool call
{ "tool": "llui_lint", "args": { "source": "...generated code..." } }
{ "tool": "llui_lint", "args": { "path": "src/Counter.ts" } }
```

Returns violations with rule names, line/column, and suggestions, plus a
0–17 score. The same checks run as a Vite plugin in dev — `llui_lint`
gives the LLM an interactive feedback loop to self-correct between
generations. Pass `exclude: ['rule-name']` to skip a rule.

What it catches: state mutation in `update()`, missing `memo()` for
shared derived values, `each()` closures that read stale state,
`view-bag-import` violations (importing `text`/`each`/`show` instead of
destructuring from the bag), async `update()`, `.map()` over state
arrays, spreading into element children, and more.

## Troubleshooting: `llui-mcp doctor`

If a tool call returns `bridge-unavailable` or Claude can't talk to a
running app:

```bash
npx llui-mcp doctor
```

It checks, in order:

- Is the active-marker file at `node_modules/.cache/llui-mcp/active.json` present?
- Is the marker JSON parseable?
- Has the Vite plugin stamped its `devUrl` into the marker?
- Is the bridge port listening on 127.0.0.1?
- Is the PID recorded in the marker still alive?

Each check prints `✓` or `✗` with a one-line detail. Exit code is `0`
when everything passes, `1` when any check fails.

## Compile-time checks: `@llui/compiler`

The compiler itself enforces 41 idiomatic-LLui rules as **build errors**,
not lint warnings. They cover the same idiomatic-code surface as
`llui_lint`, plus agent-annotation hygiene (`@intent` coverage,
`@should` on optional fields), state-mutation, async `update()`,
`each()` closures, missing `memo()`, and more.

There is nothing to configure: the rules fire automatically through
[`@llui/vite-plugin`](/api/vite-plugin), which surfaces them via
`this.error()` so the build fails until they're fixed. LLM-generated
code routinely ignores lint warnings, so the rules are deliberately
non-bypassable.

See the [`@llui/compiler` API reference](/api/compiler) for the full
rule list.

## Reading compiler diagnostics

The `@llui/vite-plugin` surfaces compiler diagnostics through Rollup's
warning channel (and `this.error()` for severity `error`). In
`vite build` output each line is formatted as:

```
[plugin llui] [<rule-id>] <relfile>:<line>: <message body>
```

The `<relfile>:<line>:` prefix is embedded in the message body
itself, so it survives reporters that drop the structured `loc`
field (Rolldown's build reporter does, most do in non-dev mode).
Click-through in iTerm, jump-to-line in IDE problem panels, and
`grep` are all viable.

### `llui/opaque-accessor-file-wide-mask` (warning, `category: perf`)

The most common perf warning. Fires when an accessor flows state
into an expression the compiler can't trace — typically:

- `host.fn(s, …)` — method call with state as an argument
- `s[expr]` — dynamic element access (non-literal key)
- `{...s}` / `[...s]` — state spread
- `helper(s)` where `helper` is imported and unresolvable

When this fires, the runtime stays correct but the component falls
back to a whole-state sentinel in `__prefixes`: every binding in
the file re-evaluates on every state change, regardless of which
field actually changed. Performance drops smoothly; nothing
crashes.

The message is tagged:

- `[file-local]` — the offending accessor is in this file, at the
  reported line. Inline same-module helpers, or wrap the call with
  [`track({ deps })`](#) as shown in the
  [cookbook's opaque-flow recipe](./cookbook.md#helpers-that-read-state-avoid-the-opaque-flow-trap).
- `[cross-file]` — the file's opacity was detected by the
  cross-file walker following an import. The reported line is the
  focal-file accessor that triggered the cross-file walk into an
  unanalyzable helper. Same fixes apply.

Two warnings for the same file at different lines means two
distinct opaque accessors; fix them one at a time. The
`(code, file, line)` triple is what Rollup uses to dedupe — if
you see N identical messages for the same file/line that's a
framework bug, please report it.

### `llui/opaque-state-flow` (error, `category: correctness`)

Stricter variant. Fires for state-leak shapes the framework
treats as user errors (dynamic key access in particular). Fails
the build. Fix: replace the dynamic key with a literal property,
or declare the read via `track({ deps })`.

### Other rules

41 idiomatic-code rules fire as build errors. The full list lives
in [`@llui/compiler` API reference](/api/compiler). When one fires
the message contains the rule id, the offending location, and a
remediation hint — usually one of: rename a binding, hoist a
declaration, switch to a documented composition primitive, or
extract a same-module function.

## Trace export and replay

Every dispatched message and resulting state is recorded. Export a trace
and replay it inside a test:

```ts
const trace = __lluiDebug.exportTrace()
// or via MCP:
// { "tool": "export_trace" }
```

```ts
// test
import { replayTrace } from '@llui/test'
import { Counter } from '../src/Counter'

await replayTrace(Counter, trace) // asserts every recorded state matches a fresh replay
```

Combined with `snapshotState` / `restoreState` and `stepBack`, this lets
you isolate a regression in a long session and pin it as a deterministic
test case.

## When to use which

| Situation                                    | Tool                              |
| -------------------------------------------- | --------------------------------- |
| Quick poke at a running app                  | `__lluiDebug.*` in DevTools       |
| LLM-assisted debugging session               | `@llui/mcp` over MCP              |
| Verify generated code is idiomatic           | `llui_lint` (MCP) or `vite build` |
| Reproduce a session bug as a regression test | `exportTrace` + `replayTrace`     |
| Catch anti-patterns in CI                    | `@llui/compiler` (build errors)   |
| Integration with the bridge isn't working    | `npx llui-mcp doctor`             |
