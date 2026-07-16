# Server-driven UI (@llui/a2ui) + agent surfaces (@llui/agent)

These two packages are how an LLui app renders **server/LLM-driven** UI (`@llui/a2ui`)
and how an LLM client **drives a running app** (`@llui/agent`). Both are less common than
core authoring — reach for the generated api docs and the app's own wiring first.

## @llui/a2ui — render Google's A2UI protocol

`@llui/a2ui` renders A2UI **envelopes** (a server streams UI as data) onto a reactive TEA
surface store, with `{path}` bindings, templates, two-way binding, and actions.

```ts
import { mountA2ui, connectA2ui, webSocketTransport, defineCatalog, basicCatalog } from '@llui/a2ui'

// Transport-agnostic: apply envelopes yourself…
const handle = mountA2ui(container, {
  catalogs: { [myCatalog.id!]: myCatalog },
  onAction: (action) => {
    /* surface user actions back to your server */
  },
  scheduler: 'raf',
})
handle.apply(envelopes) // server → client envelopes

// …or wire a WebSocket transport directly:
connectA2ui(container, webSocketTransport(new WebSocket(url)), { onAction })
```

- **Envelope kinds:** `createSurface`, `updateComponents`, `updateDataModel`. Updates are incremental — a single `updateComponents` reconciles **per component id** (only the changed node rebuilds; focus/scroll in untouched subtrees is preserved). An array frame of envelopes is applied as **one** batched reconcile.
- **Custom catalog** — register your own components over the basic set:

```ts
const myCatalog = defineCatalog({
  id: 'https://example.com/catalog.json',
  extends: basicCatalog,
  components: {
    Gauge: ({ node, ctx, scope }) => [el('my-gauge', { value: ctx })],
  },
})
```

- The Basic catalog reuses `@llui/components` (CheckBox/Tabs/Modal). Bindings resolve `{path}` against the surface data model; `updateDataModel` re-commits only bound values.

### a2ui review points

- **Untrusted envelopes:** the server is a boundary — the renderer already refuses malformed pointer writes (array→object clobbers) and sanitizes URLs/CSS, but treat `onAction` payloads and any app-side handling of them as untrusted input.
- **Feed array frames as arrays** (or one batched `apply`), not one envelope at a time, so the batching holds.
- **Number/typed inputs:** a numeric field writes a `number` to the data model; if you build custom catalog inputs, coerce types on write-back rather than sending raw strings.

## @llui/agent — let an LLM drive the running app (LAP)

`@llui/agent` implements **LAP** (the LLui Agent Protocol): a client runtime that ships in
the app and a server that pairs with it, so an LLM client (via the `llui-agent` MCP bridge)
can observe state, dispatch messages, and request confirmation on a running app.

The **dev path** is the easiest: `@llui/vite-plugin` with `llui({ agent: true })` mounts
the LAP server automatically. For a production/embedded setup:

```ts
// client (ships in the app) — '@llui/agent/client'
import { createAgentClient, agentConnect, agentConfirm, agentLog } from '@llui/agent/client'

const handle = mountApp(container, appDef)
const agentClient = createAgentClient<State, Msg>({
  handle,
  def: appDef,
  rootElement: container,
  slices: {
    getConnect: (s) => s.agent.connect,
    getConfirm: (s) => s.agent.confirm,
    wrapConnectMsg: (m) => ({ type: 'agent', sub: 'connect', msg: m }),
    wrapConfirmMsg: (m) => ({ type: 'agent', sub: 'confirm', msg: m }),
    wrapLogMsg: (m) => ({ type: 'agent', sub: 'log', msg: m }),
  },
})
agentClient.start()
// init: agent: {
//   connect: agentConnect.init({ mintUrl: '/agent/mint' })[0],
//   confirm: agentConfirm.init()[0],
//   log:     agentLog.init()[0],
// }
```

- `agentConnect` / `agentConfirm` / `agentLog` are **state-slice modules** (each has `init`/`update`), not top-level functions. Wire them as slices of your app state, exactly like a `@llui/components` component.
- **Server** (Node): `createLluiAgentServer(opts?)`; runtime-neutral core: `createLluiAgentCore(opts?)`; WHATWG adapter (`@llui/agent/server/web`) for Workers/Deno/Bun. The server name is `createLluiAgentServer` — **not** `createAgentServer`.

### agent review points

- **Version match:** LAP is at **v2** — frames are validated and a version-skewed client is rejected. The app's shipped `@llui/agent` client and its server must be on matching versions; a partial redeploy (new server, old client bundle) breaks pairing. Keep them bumped together.
- **`@requiresConfirm` actions** flow through `agentConfirm`; the app must render the confirm UI and dispatch approve/cancel so the LLM's confirmation resolves (otherwise it polls "still pending" forever).
- **Security:** the agent/dev surfaces are loopback/token-gated by design — don't expose them on `0.0.0.0` or bypass the capability/token checks. The dev task-spawn (`@llui/vite-plugin` attention router) is opt-in and requires a capability token; never combine it with permission-skipping in a shared environment.
- **State snapshots** the agent reads are your app state — the JSON-serializable contract (SKILL.md item 5) is what makes them work.
