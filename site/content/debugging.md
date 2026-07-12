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
  against the compiler's signal lint rules without needing a build.

This page is for developers writing LLui code. If you're an end user who
wants to drive an LLui app via Claude, see the [Agents
guide](/agents) instead.

## In-page console: `window.__lluiDebug`

When the Vite plugin is active in dev, the runtime publishes the debug
API on `window.__lluiDebug`. Open DevTools and start poking:

```js
__lluiDebug.getState()
__lluiDebug.send({ type: 'inc' })
__lluiDebug.evalUpdate({ type: 'inc' }) // dry-run → { state, effects }
__lluiDebug.searchState('cart.total')
const snap = __lluiDebug.snapshotState() // hold the returned clone
__lluiDebug.restoreState(snap)
__lluiDebug.exportTrace()
```

The console surface is exactly what the runtime's `installSignalDebug`
registers: `getState`, `send`, `evalUpdate`, `getMessageHistory`,
`searchState`, `validateMessage`, `getMessageSchema` / `getStateSchema` /
`getEffectSchema`, `getComponentInfo`, `snapshotState`, `restoreState`,
`exportTrace`, and `clearLog` (plus `flush`, a no-op — signal `send` is
synchronous). `window.__lluiComponents` holds every mount;
`window.__lluiDebug` points at the active one.

> Binding/mask/scope introspection (`getBindings`, `whyDidUpdate`,
> `decodeMask`, effect timelines, time-travel) are legacy-runtime concepts
> the signal runtime does not implement — they are **not** on
> `__lluiDebug`.

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

Every `@llui/mcp` tool is named `llui_*`. Categories below; each name is
what you call from the LLM client.

**State.** `llui_get_state`, `llui_describe_state`, `llui_search_state`,
`llui_diff_state`, `llui_assert`.

**Messaging.** `llui_send_message`, `llui_eval_update`,
`llui_validate_message`, `llui_list_messages`, `llui_list_effects`,
`llui_get_message_history`, `llui_search_history`, `llui_clear_log`.

**Components.** `llui_component_info`, `llui_list_components`,
`llui_select_component`.

**Snapshots and traces.** `llui_snapshot_state`, `llui_restore_state`,
`llui_export_trace`, `llui_replay_trace`.

**Source, tests and lint** (no running app required). `llui_find_msg_producers`,
`llui_find_msg_handlers`, `llui_run_test`, `llui_lint`,
`llui_compiler_diagnostics`, `llui_static_show_compiled`,
`llui_static_collect_paths`.

**Browser** (CDP transport only). `llui_screenshot`, `llui_a11y_tree`,
`llui_console_tail`, `llui_network_tail`, `llui_uncaught_errors`,
`llui_browser_close`.

**SSR** (requires `@llui/vike`). `llui_ssr_render`, `llui_hydration_report`.

**Notebook** (devmode-annotate). `llui_list_notes`, `llui_read_note`,
`llui_capture`, `llui_list_sessions`, `llui_current_session`,
`llui_rotate_session`, `llui_queue`, `llui_claim_note`,
`llui_reply_to_note`.

**Eval.** `llui_eval` (arbitrary JS in page context with observability envelope).

For exhaustive parameter shapes, see the [`@llui/mcp` API
reference](/api/mcp).

## `llui_lint`: idiomatic-code checks without a build

When you ask an LLM to write or edit LLui code, call `llui_lint` to
check the result against the compiler's signal lint rules. The tool
takes a single `path` argument (an absolute `.ts`/`.tsx` file on the dev
machine) — there is no `source` or `exclude` parameter:

```jsonc
// LLM tool call
{ "tool": "llui_lint", "args": { "path": "/abs/path/to/src/Counter.tsx" } }
```

Returns `{ file, score, violations, summary }`. Each violation is
`{ rule, message, line, column, fix? }`, and `score` is
`max(0, 20 - violations.length)` (20 = clean). The same checks run
through the Vite plugin in dev — `llui_lint` gives the LLM an interactive
feedback loop to self-correct between generations. For a whole-directory
scan use `llui_compiler_diagnostics`.

What it catches: the signal lint rules — `peek-in-slot`,
`operator-on-signal`, `pure-derive-body`, `no-node-construction-in-body`,
`controlled-input`, `at-after-map` / `prefer-at-over-map`,
`exhaustive-update`, `async-update`, `event-handler-casing`, `attr-name`,
and the shared `convention` checks.

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

The compiler itself enforces the signal lint rules as **build errors**,
not lint warnings — the same set `llui_lint` runs, plus the shared
cross-file / agent / convention checks. They cover reactivity misuse
(`peek-in-slot`, `operator-on-signal`, `pure-derive-body`,
`no-node-construction-in-body`), controlled inputs, exhaustive `update()`,
async `update()`, event-handler casing, attribute naming, and more.

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

Under the chunked-mask reactivity model there is no path ceiling and
no whole-state fallback: when the compiler can't statically trace an
accessor into a narrower dependency set, the binding simply stays
maximally reactive (it reads the relevant chunk-set), and correctness
is always preserved. When a rule does fire, the message carries the
rule id, the offending location, and a remediation hint — usually one
of: rename a binding, hoist a declaration, switch to a documented
composition primitive, or extract a same-module function. The full
list of active rules lives in the
[`@llui/compiler` API reference](/api/compiler).

## Trace export and replay

Every dispatched message and resulting state is recorded. Export a trace
and replay it inside a test:

```ts
const trace = __lluiDebug.exportTrace()
// or via MCP:
// { "tool": "llui_export_trace" }
```

```ts
// test
import { replayTrace } from '@llui/test'
import { Counter } from '../src/Counter'

await replayTrace(Counter, trace) // asserts every recorded state matches a fresh replay
```

Combined with `snapshotState` / `restoreState`, this lets you isolate a
regression in a long session and pin it as a deterministic test case.

## When to use which

| Situation                                    | Tool                              |
| -------------------------------------------- | --------------------------------- |
| Quick poke at a running app                  | `__lluiDebug.*` in DevTools       |
| LLM-assisted debugging session               | `@llui/mcp` over MCP              |
| Verify generated code is idiomatic           | `llui_lint` (MCP) or `vite build` |
| Reproduce a session bug as a regression test | `exportTrace` + `replayTrace`     |
| Catch anti-patterns in CI                    | `@llui/compiler` (build errors)   |
| Integration with the bridge isn't working    | `npx llui-mcp doctor`             |
