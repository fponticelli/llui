# Proposal: A2UI ↔ LLui agent integration

Status: **proposal** (design only — prototype pending buy-in). Depends on
`@llui/a2ui` (Phases 0–2, landed).

## Motivation

`@llui/a2ui` renders A2UI on the LLui runtime. A2UI's whole value is its
ecosystem — A2A, AG-UI, CopilotKit, Vercel's json-renderer, Oracle Agent Spec.
LLui separately has its own agent surface — **LAP** (LLui Agent Protocol, via
`@llui/agent` + `@llui/agent-bridge`'s MCP server, backed by the in-app
`LluiDebugAPI`), which lets an agent `describe_app` / `observe` / `dispatch`
against a running LLui app.

Connecting the two makes an LLui app a first-class A2UI **render target** for
external agents, and makes A2UI-rendered surfaces introspectable/drivable by
LLui's existing Claude-Desktop MCP tooling. Two directions, of differing value:

## Direction A — A2UI-in: transport adapters (recommended first)

Today a consumer wires their own transport to `handle.apply(...)` / `onAction`.
Ship thin, self-contained adapters so `@llui/a2ui` plugs directly into the A2UI
ecosystem:

- `@llui/a2ui/transport/a2a` — map each A2A message Part payload to an envelope;
  route `onAction` into an A2A client-bound message (with `dataModel` metadata
  when `sendDataModel`).
- `@llui/a2ui/transport/ws` — a WebSocket frame ↔ envelope stream.
- `@llui/a2ui/transport/ag-ui` and `/mcp` — AG-UI event stream / MCP tool-output
  and resource-subscription bindings.

Each is ~a few dozen lines: `connect(url) → { handle }` that pumps inbound
envelopes into `apply()` and pushes `onAction` events outbound. **Low risk, high
distribution value** — this is what puts LLui on the A2A/AG-UI/CopilotKit map.
Capability advertisement reuses `handle.capabilities()`; version negotiation
reuses `SUPPORTED_VERSIONS`.

## Direction B — LAP introspection of A2UI surfaces (deeper)

Expose the A2UI renderer's state through `LluiDebugAPI` so the existing
`@llui/agent-bridge` MCP server can observe and drive A2UI surfaces:

- `describe_app` → the surface list, each surface's component tree (from the
  reducer state) and its resolvable actions (the `event.name`s reachable from the
  current UI, à la `getBindingDescriptors`).
- `observe` → the surface data models (already JSON, already reactive via
  `subscribe`).
- `dispatch` → apply an inbound envelope, or synthesize an action, through
  `handle.apply` / the action path.

Because the A2UI renderer is already pure TEA (state + reducer), most of this is
a projection of existing state — no new runtime machinery. This lets Claude
Desktop (via LAP/MCP) inspect and manipulate an agent-driven A2UI UI the same way
it inspects a hand-written LLui app.

## Direction C — A2UI-out (deferred)

Serializing a live hand-written LLui view _as_ an A2UI component tree (so
external A2UI clients render an LLui app) is the inverse and the least clear in
value: it requires walking the live scope tree back into catalog components and
constraining authors to the catalog. Deferred unless a concrete need appears.

## Progress

**Direction A seam + WebSocket adapter landed** (`src/transport.ts`): the shared
`A2uiTransport` interface (`onEnvelope` / `sendAction`), `connectA2ui(container,
transport, opts)` that wires inbound envelopes → `apply()` and `onAction` →
`sendAction` (dispose unsubscribes), and `webSocketTransport(socket)`. A2A /
AG-UI / MCP now drop onto the same proven `A2uiTransport` interface.

## Recommendation

1. **Direction A first** — transport adapters. Concrete, low-risk, and it
   delivers the original strategic goal (LLui on the A2UI distribution rails).
   ✅ Seam + WebSocket done; **A2A next** on the proven seam.
2. **Direction B next** — LAP introspection, once A is proven. Mostly a state
   projection; high leverage for the LLui+Claude tooling story.
3. **Direction C** — defer.

Open question for prototyping: which transport to target first (A2A vs AG-UI vs
WebSocket) depends on where we want the first real agent integration demo.
