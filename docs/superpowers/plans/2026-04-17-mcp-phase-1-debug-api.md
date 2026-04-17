# Phase 1 — Debug-API Expansion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 21 new MCP tools that debug LLui apps at state-machine and DOM level via the existing in-page debug-API relay. No new transports; extends `LluiDebugAPI` on `@llui/dom` and adds 4 dev-time runtime trackers across `@llui/dom` and `@llui/effects`. Prerequisite for Phases 2–5.

**Architecture:** Every new tool is tagged `debug-api` and dispatched by a new tool-registry through the existing WebSocket relay to `globalThis.__lluiDebug`. The 730-line `packages/mcp/src/index.ts` is decomposed into `tool-registry.ts` + `tools/debug-api.ts` + `transports/relay.ts` before new handlers are added. `@llui/dom` gets 21 new `LluiDebugAPI` methods plus four ring-buffer trackers (each-diff, disposer log, effect timeline, Msg coverage). `@llui/effects` exposes a dev-only `_setEffectInterceptor` hook with a null-check zero-cost production path. The MCP-active marker file gains a `devUrl` field (used in Phase 2).

**Tech Stack:** TypeScript, vitest, jsdom, MagicString, TypeScript Compiler API.

**Spec reference:** `docs/superpowers/specs/2026-04-17-mcp-tools-and-cdp-design.md` §3.1, §4.1–§4.3, §5.2.

---

## File Structure

### Files created

| Path | Responsibility |
|---|---|
| `packages/mcp/src/tool-registry.ts` | Tool definitions with layer-tag; central dispatch map |
| `packages/mcp/src/tools/debug-api.ts` | All debug-API-backed tool handlers (Phase 1 + 5) |
| `packages/mcp/src/tools/index.ts` | Re-exports `registerDebugApiTools` |
| `packages/mcp/src/transports/relay.ts` | Relay transport (extracted from current index.ts) |
| `packages/mcp/src/transports/index.ts` | Transport re-exports |
| `packages/mcp/src/util/diff.ts` | Pure `diffState` and `domDiff` helpers (MCP-side) |
| `packages/dom/src/tracking/each-diff.ts` | Each reconciliation diff ring buffer |
| `packages/dom/src/tracking/disposer-log.ts` | Disposer event ring buffer |
| `packages/dom/src/tracking/effect-timeline.ts` | Effect phase event ring buffer |
| `packages/dom/src/tracking/coverage.ts` | Per-variant message counters |
| `packages/dom/src/tracking/index.ts` | Re-exports all trackers |
| `packages/mcp/test/tools-view.test.ts` | Unit tests for view/DOM tools |
| `packages/mcp/test/tools-interaction.test.ts` | Unit tests for interaction tools |
| `packages/mcp/test/tools-bindings.test.ts` | Unit tests for binding/scope tools |
| `packages/mcp/test/tools-effects.test.ts` | Unit tests for effect tools |
| `packages/mcp/test/tools-time-travel.test.ts` | Unit tests for time-travel + utility tools |
| `packages/mcp/test/tools-eval.test.ts` | Unit tests for eval tool |
| `packages/mcp/test/jsdom-view.test.ts` | jsdom e2e for DOM-touching view tools |
| `packages/mcp/test/jsdom-interaction.test.ts` | jsdom e2e for dispatch_event + focus |
| `packages/mcp/test/jsdom-bindings.test.ts` | jsdom e2e for force_rerender + scope tree |
| `packages/mcp/test/jsdom-effects.test.ts` | jsdom e2e for effect tools |
| `packages/dom/test/tracking.test.ts` | Unit tests for all 4 trackers |

### Files modified

| Path | Change |
|---|---|
| `packages/mcp/src/index.ts` | Reduced to `LluiMcpServer` + bridge lifecycle; tool dispatch moves to `tool-registry.ts`; add `devUrl` to marker file |
| `packages/dom/src/devtools.ts` | Add 21 new methods + wire trackers; export `LluiDebugAPI` type additions |
| `packages/dom/src/types.ts` | Extend `ComponentInstance` with tracker fields |
| `packages/dom/src/structural/each.ts` | Emit each-diff events on reconciliation (dev-gated) |
| `packages/dom/src/scope.ts` | Emit disposer events on disposal (dev-gated) |
| `packages/dom/src/update-loop.ts` | Add `_forceFullRerender(inst)` internal; emit effect timeline events |
| `packages/dom/src/index.ts` | Export new types (`ElementReport`, `ScopeNode`, `EachDiff`, `DisposerEvent`, `PendingEffect`, `EffectTimelineEntry`, `EffectMatch`, `StateDiff`) |
| `packages/effects/src/resolve.ts` | Add `_setEffectInterceptor` export; null-check hook in dispatch path |
| `packages/effects/src/index.ts` | Re-export `_setEffectInterceptor` |
| `packages/vite-plugin/src/index.ts` | Write `devUrl` into marker read/broadcast |
| `packages/mcp/README.md` | New tool table rows |
| `docs/designs/07 LLM Friendliness.md` | Update MCP tool catalog |
| `docs/designs/09 API Reference.md` | Document new `LluiDebugAPI` methods |
| `CLAUDE.md` | Add `@llui/mcp` row to package table |

---

## Task List

### Section A — Infrastructure (3 tasks)

#### Task 1: Extend marker file with `devUrl`

**Why:** Phase 2's CDP fallback needs to navigate Playwright to the dev URL. The marker file already carries `{port, pid}`; we add `devUrl`. Writing it is part of `@llui/vite-plugin` (it knows the URL); reading it is part of `@llui/mcp` (uses it for validation and Phase 2).

**Files:**
- Modify: `packages/mcp/src/index.ts` (marker writer — extend shape)
- Modify: `packages/vite-plugin/src/index.ts` (marker reader — extend shape, include devUrl when broadcasting)
- Test: `packages/mcp/test/mcp.test.ts`

- [ ] **Step 1: Write failing test for marker-file shape**

Add to `packages/mcp/test/mcp.test.ts`:

```ts
import { readFileSync, existsSync } from 'node:fs'
import { mcpActiveFilePath } from '../src/index'

it('writes devUrl to the marker file when provided', () => {
  const server = new LluiMcpServer(5299)
  server.setDevUrl('http://localhost:5173')
  server.startBridge()
  const path = mcpActiveFilePath()
  expect(existsSync(path)).toBe(true)
  const marker = JSON.parse(readFileSync(path, 'utf8')) as { port: number; pid: number; devUrl?: string }
  expect(marker.port).toBe(5299)
  expect(marker.devUrl).toBe('http://localhost:5173')
  server.stopBridge()
})

it('omits devUrl from the marker file when not set', () => {
  const server = new LluiMcpServer(5298)
  server.startBridge()
  const marker = JSON.parse(readFileSync(mcpActiveFilePath(), 'utf8')) as { port: number; devUrl?: string }
  expect(marker.devUrl).toBeUndefined()
  server.stopBridge()
})
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @llui/mcp test -- mcp.test.ts
```

Expected: both tests fail — `server.setDevUrl is not a function`.

- [ ] **Step 3: Implement `setDevUrl` and extend marker write**

In `packages/mcp/src/index.ts`, add a field and setter to `LluiMcpServer`:

```ts
export class LluiMcpServer {
  private bridgePort: number
  private devUrl: string | null = null
  // ... existing fields ...

  setDevUrl(url: string): void {
    this.devUrl = url
    // If bridge already running, rewrite the marker so consumers see the update
    if (this.wsServer) this.writeActiveFile()
  }

  // ... existing methods ...

  private writeActiveFile(): void {
    try {
      const path = mcpActiveFilePath()
      mkdirSync(dirname(path), { recursive: true })
      const payload: { port: number; pid: number; devUrl?: string } = {
        port: this.bridgePort,
        pid: process.pid,
      }
      if (this.devUrl !== null) payload.devUrl = this.devUrl
      writeFileSync(path, JSON.stringify(payload))
    } catch {
      // Best-effort
    }
  }
}
```

- [ ] **Step 4: Run and verify pass**

```bash
pnpm --filter @llui/mcp test -- mcp.test.ts
```

Expected: both new tests pass; existing tests continue passing.

- [ ] **Step 5: Update vite-plugin to surface devUrl to the browser**

Modify `packages/vite-plugin/src/index.ts`. In `readMcpPort`, extend to read `devUrl` too, and adjust `notifyMcpReady` to include it:

```ts
function readMcpMarker(): { port: number; devUrl?: string } | null {
  try {
    if (!existsSync(activeFilePath)) return null
    const data = JSON.parse(readFileSync(activeFilePath, 'utf8')) as { port?: number; devUrl?: string }
    if (typeof data.port !== 'number') return null
    return { port: data.port, ...(data.devUrl ? { devUrl: data.devUrl } : {}) }
  } catch {
    return null
  }
}

function notifyMcpReady(server: ViteDevServer): void {
  const marker = readMcpMarker()
  if (marker === null) return
  server.ws.send({ type: 'custom', event: 'llui:mcp-ready', data: marker })
}
```

Also update `configureServer` so it calls `mcpServer.setDevUrl(…)` automatically when the Vite dev server URL is known. Find the point that currently notifies MCP ready and add, in the server-listening hook:

```ts
server.httpServer?.once('listening', () => {
  const address = server.httpServer?.address()
  if (address && typeof address === 'object') {
    const host = address.address === '::' || address.address === '0.0.0.0' ? 'localhost' : address.address
    const url = `http://${host}:${address.port}`
    // Write into the MCP marker if it exists; the MCP server picks it up via marker refresh
    try {
      const markerPath = activeFilePath
      if (existsSync(markerPath)) {
        const m = JSON.parse(readFileSync(markerPath, 'utf8')) as Record<string, unknown>
        m.devUrl = url
        writeFileSync(markerPath, JSON.stringify(m))
      }
    } catch {
      // Best-effort
    }
  }
})
```

Run:

```bash
pnpm turbo check
```

Expected: no type errors.

- [ ] **Step 6: Defer commit**

Leave staged (or unstaged — a git-add will happen at the category commit point). No commit in this task.

---

#### Task 2: Create `tool-registry.ts` scaffold

**Why:** Phase 1 adds 21 tools and later phases add 15 more. The current switch statement in `index.ts::handleToolCall` (lines 481–613) is already unwieldy at 23 cases; going to 58 would be unmanageable. We introduce a registry with layer-tag routing.

**Files:**
- Create: `packages/mcp/src/tool-registry.ts`
- Modify: `packages/mcp/src/index.ts` (delegate to registry)
- Test: `packages/mcp/test/tool-registry.test.ts`

- [ ] **Step 1: Write failing test for registry**

Create `packages/mcp/test/tool-registry.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { ToolRegistry, type ToolHandler } from '../src/tool-registry'

describe('ToolRegistry', () => {
  it('registers and dispatches a tool by name', async () => {
    const registry = new ToolRegistry()
    const handler: ToolHandler = vi.fn(async (_args) => ({ ok: true }))
    registry.register(
      { name: 'x_test', description: 'test', inputSchema: { type: 'object', properties: {} } },
      'debug-api',
      handler,
    )
    const result = await registry.dispatch('x_test', { foo: 'bar' }, { relay: null, cdp: null })
    expect(handler).toHaveBeenCalledWith({ foo: 'bar' }, { relay: null, cdp: null })
    expect(result).toEqual({ ok: true })
  })

  it('throws on unknown tool', async () => {
    const registry = new ToolRegistry()
    await expect(registry.dispatch('no_such_tool', {}, { relay: null, cdp: null })).rejects.toThrow(
      /Unknown tool: no_such_tool/,
    )
  })

  it('lists all registered tool definitions', () => {
    const registry = new ToolRegistry()
    registry.register(
      { name: 'a', description: 'a', inputSchema: { type: 'object', properties: {} } },
      'debug-api',
      async () => null,
    )
    registry.register(
      { name: 'b', description: 'b', inputSchema: { type: 'object', properties: {} } },
      'cdp',
      async () => null,
    )
    const tools = registry.listDefinitions()
    expect(tools.map((t) => t.name).sort()).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @llui/mcp test -- tool-registry.test.ts
```

Expected: fails — module `../src/tool-registry` not found.

- [ ] **Step 3: Implement `tool-registry.ts`**

Create `packages/mcp/src/tool-registry.ts`:

```ts
export interface ToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export type ToolLayer = 'debug-api' | 'cdp' | 'source' | 'compiler'

export interface ToolContext {
  relay: RelayTransport | null
  cdp: CdpTransport | null
}

export interface RelayTransport {
  call(method: string, args: unknown[]): Promise<unknown>
  isAvailable(): boolean
}

export interface CdpTransport {
  call(domain: string, method: string, params?: Record<string, unknown>): Promise<unknown>
  isAvailable(): boolean
}

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<unknown>

interface Entry {
  definition: ToolDefinition
  layer: ToolLayer
  handler: ToolHandler
}

export class ToolRegistry {
  private entries = new Map<string, Entry>()

  register(definition: ToolDefinition, layer: ToolLayer, handler: ToolHandler): void {
    if (this.entries.has(definition.name)) {
      throw new Error(`Duplicate tool registration: ${definition.name}`)
    }
    this.entries.set(definition.name, { definition, layer, handler })
  }

  async dispatch(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<unknown> {
    const entry = this.entries.get(name)
    if (!entry) throw new Error(`Unknown tool: ${name}`)
    return entry.handler(args, ctx)
  }

  listDefinitions(): ToolDefinition[] {
    return Array.from(this.entries.values()).map((e) => e.definition)
  }

  getLayer(name: string): ToolLayer | null {
    return this.entries.get(name)?.layer ?? null
  }
}
```

- [ ] **Step 4: Run and verify pass**

```bash
pnpm --filter @llui/mcp test -- tool-registry.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: No commit yet — batched later**

---

#### Task 3: Decompose `index.ts` into `tools/debug-api.ts` + `transports/relay.ts`

**Why:** Before adding 21 new handlers we move the existing 23 into the registry. This keeps `index.ts` focused on server lifecycle and pushes all tool logic into category-specific files.

**Files:**
- Create: `packages/mcp/src/tools/debug-api.ts`
- Create: `packages/mcp/src/tools/index.ts`
- Create: `packages/mcp/src/transports/relay.ts`
- Create: `packages/mcp/src/transports/index.ts`
- Modify: `packages/mcp/src/index.ts` (use registry + extracted relay)

- [ ] **Step 1: Write refactor test (all existing tests must keep passing)**

Before touching code, run the existing suite as a baseline:

```bash
pnpm --filter @llui/mcp test
```

Record the current pass count. This whole task is a refactor — the same tests that pass before must pass after. If any existing test starts failing, stop and fix.

- [ ] **Step 2: Extract relay transport**

Create `packages/mcp/src/transports/relay.ts`:

```ts
import { WebSocketServer, type WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'
import type { LluiDebugAPI } from '@llui/dom'
import type { RelayTransport } from '../tool-registry.js'

export interface RelayTransportOptions {
  port: number
  onBrowserConnect?: () => void
  onBrowserDisconnect?: () => void
}

interface PendingRequest {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

export class WebSocketRelayTransport implements RelayTransport {
  private wsServer: WebSocketServer | null = null
  private browserWs: WebSocket | null = null
  private pending = new Map<string, PendingRequest>()
  private directApi: LluiDebugAPI | null = null
  private readonly port: number
  private readonly onConnect?: () => void
  private readonly onDisconnect?: () => void

  constructor(opts: RelayTransportOptions) {
    this.port = opts.port
    this.onConnect = opts.onBrowserConnect
    this.onDisconnect = opts.onBrowserDisconnect
  }

  connectDirect(api: LluiDebugAPI): void {
    this.directApi = api
  }

  start(): void {
    if (this.wsServer) return
    this.wsServer = new WebSocketServer({ port: this.port, host: '127.0.0.1' })
    this.wsServer.on('connection', (ws) => {
      this.browserWs = ws
      this.onConnect?.()
      ws.on('message', (raw) => {
        let msg: { id: string; result?: unknown; error?: string }
        try {
          msg = JSON.parse(String(raw))
        } catch {
          return
        }
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error))
        else p.resolve(msg.result)
      })
      ws.on('close', () => {
        if (this.browserWs === ws) {
          this.browserWs = null
          this.onDisconnect?.()
        }
      })
    })
  }

  stop(): void {
    this.wsServer?.close()
    this.wsServer = null
    this.browserWs = null
    for (const p of this.pending.values()) p.reject(new Error('relay closed'))
    this.pending.clear()
  }

  isAvailable(): boolean {
    return this.directApi !== null || this.browserWs !== null
  }

  async call(method: string, args: unknown[]): Promise<unknown> {
    if (this.directApi) {
      const fn = (this.directApi as unknown as Record<string, unknown>)[method]
      if (typeof fn !== 'function') throw new Error(`unknown method: ${method}`)
      return (fn as (...a: unknown[]) => unknown).apply(this.directApi, args)
    }
    if (!this.browserWs) {
      throw new Error('No browser connected to the MCP bridge. Start your dev server.')
    }
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.browserWs!.send(JSON.stringify({ id, method, args }))
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`timeout: ${method}`))
      }, 5000)
    })
  }
}
```

Create `packages/mcp/src/transports/index.ts`:

```ts
export { WebSocketRelayTransport } from './relay.js'
export type { RelayTransportOptions } from './relay.js'
```

- [ ] **Step 3: Extract existing tool handlers to `tools/debug-api.ts`**

Create `packages/mcp/src/tools/debug-api.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { lintIdiomatic } from '@llui/lint-idiomatic'
import type { ToolRegistry } from '../tool-registry.js'
import { generateReplayTest } from './replay-test-generator.js'

export function registerDebugApiTools(registry: ToolRegistry): void {
  // Existing 23 tools — handlers lifted from packages/mcp/src/index.ts handleToolCall().
  // Each tool's definition stays byte-identical to the current TOOLS array.

  registry.register(
    {
      name: 'llui_get_state',
      description:
        'Get the current state of the LLui component. Returns a JSON-serializable state object.',
      inputSchema: { type: 'object', properties: {} },
    },
    'debug-api',
    async (_args, ctx) => {
      if (!ctx.relay) throw new Error('Relay transport unavailable')
      return ctx.relay.call('getState', [])
    },
  )

  registry.register(
    {
      name: 'llui_send_message',
      description:
        'Send a message to the component and return the new state and effects. Validates the message first. Calls flush() automatically.',
      inputSchema: {
        type: 'object',
        properties: {
          msg: { type: 'object', description: 'The message to send (must be a valid Msg variant)' },
        },
        required: ['msg'],
      },
    },
    'debug-api',
    async (args, ctx) => {
      if (!ctx.relay) throw new Error('Relay transport unavailable')
      const errors = (await ctx.relay.call('validateMessage', [args.msg])) as unknown[] | null
      if (errors) return { errors, sent: false }
      await ctx.relay.call('send', [args.msg])
      await ctx.relay.call('flush', [])
      return { state: await ctx.relay.call('getState', []), sent: true }
    },
  )

  // ... CONTINUE: migrate all 21 remaining existing tool handlers from
  // the current packages/mcp/src/index.ts handleToolCall switch into
  // registry.register() calls following the same shape. Tools to migrate:
  //   llui_eval_update, llui_validate_message, llui_get_message_history,
  //   llui_export_trace, llui_get_bindings, llui_why_did_update,
  //   llui_search_state, llui_clear_log, llui_list_messages,
  //   llui_decode_mask, llui_mask_legend, llui_component_info,
  //   llui_describe_state, llui_list_effects, llui_trace_element,
  //   llui_snapshot_state, llui_restore_state, llui_list_components,
  //   llui_select_component, llui_replay_trace, llui_lint
  //
  // For each: copy the `TOOLS[i]` definition object into the first arg,
  // and copy the `case 'llui_xxx':` body into the async handler, swapping
  // `this.call(...)` for `ctx.relay!.call(...)`.
}
```

Extract `generateReplayTest` (currently a private function in `index.ts` at line 698) to `packages/mcp/src/tools/replay-test-generator.ts`:

```ts
export function generateReplayTest(
  trace: {
    component: string
    entries: Array<{ msg: unknown; expectedState: unknown; expectedEffects: unknown[] }>
  },
  importPath: string,
  exportName: string,
): string {
  const traceJson = JSON.stringify(
    {
      lluiTrace: 1,
      component: trace.component,
      generatedBy: 'llui-mcp',
      timestamp: new Date().toISOString(),
      entries: trace.entries,
    },
    null,
    2,
  )
  return `import { it, expect } from 'vitest'
import { replayTrace } from '@llui/test'
import { ${exportName} } from '${importPath}'

// Auto-generated from a debugging session via llui_replay_trace MCP tool.
// Edit the trace below to trim, reorder, or adjust expected state/effects.
const trace = ${traceJson} as const

it('${trace.component}: replays ${trace.entries.length} recorded message${trace.entries.length === 1 ? '' : 's'}', () => {
  expect(() => replayTrace(${exportName}, trace as Parameters<typeof replayTrace>[1])).not.toThrow()
})
`
}
```

Create `packages/mcp/src/tools/index.ts`:

```ts
export { registerDebugApiTools } from './debug-api.js'
```

- [ ] **Step 4: Rewire `index.ts` around registry**

Modify `packages/mcp/src/index.ts`:

```ts
import { ToolRegistry, type ToolContext } from './tool-registry.js'
import { registerDebugApiTools } from './tools/index.js'
import { WebSocketRelayTransport } from './transports/index.js'

// (Keep findWorkspaceRoot, mcpActiveFilePath, JSON-RPC types as before.)

export class LluiMcpServer {
  private readonly registry: ToolRegistry
  private readonly relay: WebSocketRelayTransport
  private devUrl: string | null = null
  private bridgePort: number

  constructor(bridgePort = 5200) {
    this.bridgePort = bridgePort
    this.registry = new ToolRegistry()
    this.relay = new WebSocketRelayTransport({ port: bridgePort })
    registerDebugApiTools(this.registry)
  }

  connectDirect(api: import('@llui/dom').LluiDebugAPI): void {
    this.relay.connectDirect(api)
  }

  setDevUrl(url: string): void {
    this.devUrl = url
    if (this.relay.isAvailable()) this.writeActiveFile()
  }

  startBridge(): void {
    this.relay.start()
    this.writeActiveFile()
  }

  stopBridge(): void {
    this.relay.stop()
    this.removeActiveFile()
  }

  getTools(): import('./tool-registry.js').ToolDefinition[] {
    return this.registry.listDefinitions()
  }

  async handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
    const ctx: ToolContext = { relay: this.relay, cdp: null }
    return this.registry.dispatch(name, args, ctx)
  }

  private writeActiveFile(): void {
    /* as in Task 1 */
  }
  private removeActiveFile(): void {
    /* as before */
  }

  // start() and handleRequest() stay as before, just with handleToolCall delegating to registry.
}
```

- [ ] **Step 5: Run full suite**

```bash
pnpm --filter @llui/mcp test
pnpm --filter @llui/mcp run check
```

Expected: same pass count as baseline in Step 1; no type errors.

- [ ] **Step 6: No commit yet — batched at end of Section A**

---

### Section A commit

- [ ] **Task A-commit: Commit infrastructure**

Present for approval:

```bash
git add packages/mcp/src/tool-registry.ts packages/mcp/src/tools/ \
        packages/mcp/src/transports/ packages/mcp/src/index.ts \
        packages/mcp/test/tool-registry.test.ts packages/mcp/test/mcp.test.ts \
        packages/vite-plugin/src/index.ts

git commit -m "$(cat <<'EOF'
refactor(mcp): decompose index.ts into tool-registry + transports; extend marker with devUrl

Introduces ToolRegistry with layer-tag routing (debug-api/cdp/source/compiler), extracts
the WebSocket relay into transports/relay.ts, and moves the existing 23 tool handlers
into tools/debug-api.ts. Marker file gains optional devUrl field (used by Phase 2 CDP
fallback). No behavior change — all existing tests pass against the new structure.

Prerequisite for Phase 1 debug-API expansion (21 new tools).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Confirm with user before running.

---

### Section B — Runtime trackers (4 tasks)

#### Task 4: Each-diff tracker

**Why:** `llui_each_diff` and `llui_scope_tree` need per-update diff data. Added as a ring buffer on `ComponentInstance`, populated by `each` reconciliation. Dev-gated.

**Files:**
- Create: `packages/dom/src/tracking/each-diff.ts`
- Modify: `packages/dom/src/structural/each.ts` (emit events)
- Modify: `packages/dom/src/update-loop.ts` (attach ring to instance, init cleanly)
- Modify: `packages/dom/src/types.ts` (type addition on `ComponentInstance`)
- Test: `packages/dom/test/tracking.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/dom/test/tracking.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createRingBuffer } from '../src/tracking/each-diff'
import type { EachDiff } from '../src/tracking/each-diff'

describe('each-diff ring buffer', () => {
  it('records entries and caps at maxSize', () => {
    const buf = createRingBuffer<EachDiff>(3)
    buf.push({
      updateIndex: 0,
      eachSiteId: 's1',
      added: ['a'],
      removed: [],
      moved: [],
      reused: [],
    })
    buf.push({
      updateIndex: 1,
      eachSiteId: 's1',
      added: ['b'],
      removed: [],
      moved: [],
      reused: ['a'],
    })
    buf.push({
      updateIndex: 2,
      eachSiteId: 's1',
      added: [],
      removed: ['a'],
      moved: [],
      reused: ['b'],
    })
    buf.push({
      updateIndex: 3,
      eachSiteId: 's1',
      added: ['c'],
      removed: [],
      moved: [],
      reused: ['b'],
    })

    const all = buf.toArray()
    expect(all).toHaveLength(3)
    expect(all[0]!.updateIndex).toBe(1) // oldest was dropped
    expect(all[2]!.updateIndex).toBe(3)
  })

  it('returns entries since a given updateIndex', () => {
    const buf = createRingBuffer<EachDiff>(10)
    for (let i = 0; i < 5; i++) {
      buf.push({
        updateIndex: i,
        eachSiteId: 's1',
        added: [],
        removed: [],
        moved: [],
        reused: [],
      })
    }
    const since = buf.toArray().filter((e) => e.updateIndex >= 3)
    expect(since.map((e) => e.updateIndex)).toEqual([3, 4])
  })
})
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @llui/dom test -- tracking.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement ring buffer + type**

Create `packages/dom/src/tracking/each-diff.ts`:

```ts
export interface EachDiff {
  updateIndex: number
  eachSiteId: string
  added: string[]
  removed: string[]
  moved: Array<{ key: string; from: number; to: number }>
  reused: string[]
}

export interface RingBuffer<T> {
  push(entry: T): void
  toArray(): T[]
  clear(): void
  size(): number
}

export function createRingBuffer<T>(maxSize: number): RingBuffer<T> {
  const buf: T[] = []
  return {
    push(entry) {
      if (buf.length >= maxSize) buf.shift()
      buf.push(entry)
    },
    toArray() {
      return buf.slice()
    },
    clear() {
      buf.length = 0
    },
    size() {
      return buf.length
    },
  }
}
```

- [ ] **Step 4: Run and verify pass**

```bash
pnpm --filter @llui/dom test -- tracking.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 5: Wire into `ComponentInstance` and `each.ts`**

In `packages/dom/src/types.ts`, add (preserving existing shape) to `ComponentInstance`:

```ts
import type { RingBuffer, EachDiff } from './tracking/each-diff.js'

export interface ComponentInstance<S = unknown, M = unknown, E = unknown> {
  // ... existing fields ...
  /** @internal dev-only — populated when installDevTools ran */
  _eachDiffLog?: RingBuffer<EachDiff>
}
```

In `packages/dom/src/structural/each.ts`, at the end of the reconciliation function (where old/new keys are known), emit a diff. Find the function that reconciles an `each` block — add near the end, before returning:

```ts
// Dev-only diff emission
if (inst._eachDiffLog !== undefined) {
  const added: string[] = []
  const removed: string[] = []
  const moved: Array<{ key: string; from: number; to: number }> = []
  const reused: string[] = []
  // Compute sets from oldKeys vs newKeys (implementation-specific to each.ts layout)
  // Placeholder computation — real code uses the existing keyedMap/newMap the function already maintains:
  const oldKeySet = new Set(oldKeys)
  const newKeySet = new Set(newKeys)
  for (const k of newKeys) if (!oldKeySet.has(k)) added.push(k)
  for (const k of oldKeys) if (!newKeySet.has(k)) removed.push(k)
  for (let i = 0; i < newKeys.length; i++) {
    const k = newKeys[i]!
    if (!oldKeySet.has(k)) continue
    const from = oldKeys.indexOf(k)
    if (from !== i) moved.push({ key: k, from, to: i })
    else reused.push(k)
  }
  inst._eachDiffLog.push({
    updateIndex: inst.lastDirtyMask === 0 ? 0 : Date.now(), // use dirty-mask counter in real impl
    eachSiteId: block.siteId,
    added,
    removed,
    moved,
    reused,
  })
}
```

Note to executor: the `updateIndex` source must be the message-history counter that `devtools.ts` maintains in `idx`. Either pass it in or bump a shared counter on `ComponentInstance` — see Task 6 for the coverage tracker pattern. Use that same counter here.

- [ ] **Step 6: Init log in `installDevTools`**

In `packages/dom/src/devtools.ts`, inside `installDevTools(inst)` add near the top:

```ts
import { createRingBuffer } from './tracking/each-diff.js'

export function installDevTools(inst: object): void {
  const ci = inst as ComponentInstance
  ci._eachDiffLog = createRingBuffer(100)
  // ... existing history setup ...
}
```

- [ ] **Step 7: Run tests**

```bash
pnpm --filter @llui/dom test
pnpm --filter @llui/dom run check
```

Expected: all tests pass; no type errors.

- [ ] **Step 8: No commit yet — batched at end of Section B**

---

#### Task 5: Disposer log tracker

**Files:**
- Create: `packages/dom/src/tracking/disposer-log.ts`
- Modify: `packages/dom/src/scope.ts` (emit on disposal)
- Modify: `packages/dom/src/types.ts` (instance field)
- Modify: `packages/dom/src/devtools.ts` (init in installDevTools)
- Test: extend `packages/dom/test/tracking.test.ts`

- [ ] **Step 1: Write failing test**

Append to `packages/dom/test/tracking.test.ts`:

```ts
import type { DisposerEvent } from '../src/tracking/disposer-log'
import { createRingBuffer as createRB2 } from '../src/tracking/disposer-log'

describe('disposer log', () => {
  it('caps at 500 and records events with scope id + cause', () => {
    const buf = createRB2<DisposerEvent>(500)
    buf.push({ scopeId: 'root/each/0', cause: 'each-remove', timestamp: Date.now() })
    buf.push({ scopeId: 'root/show', cause: 'show-hide', timestamp: Date.now() })
    expect(buf.toArray()).toHaveLength(2)
    expect(buf.toArray()[0]!.cause).toBe('each-remove')
  })
})
```

- [ ] **Step 2: Verify fail, then implement**

Run; fails on missing module. Create `packages/dom/src/tracking/disposer-log.ts`:

```ts
import { createRingBuffer, type RingBuffer } from './each-diff.js'

export interface DisposerEvent {
  scopeId: string
  cause:
    | 'branch-swap'
    | 'each-remove'
    | 'show-hide'
    | 'child-unmount'
    | 'app-unmount'
    | 'component-unmount'
  timestamp: number
}

export { createRingBuffer, type RingBuffer }
```

(The disposer log reuses the same ring-buffer implementation; one re-export keeps `tracking.test.ts` clean.)

- [ ] **Step 3: Run test**

```bash
pnpm --filter @llui/dom test -- tracking.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Emit events in `scope.ts`**

In `packages/dom/src/scope.ts`, within `disposeScope(scope, skipParentRemoval)`, after existing disposer execution:

```ts
// Dev-only: emit disposer events
// Walk up to the component instance (stored on root scope when installDevTools runs).
const inst = findInstance(scope)
if (inst?._disposerLog !== undefined) {
  inst._disposerLog.push({
    scopeId: String(scope.id),
    cause: scope.disposalCause ?? 'component-unmount',
    timestamp: Date.now(),
  })
}
```

To find the instance, add a helper near the top of `scope.ts`:

```ts
function findInstance(scope: Scope): ComponentInstance | null {
  let s: Scope | null = scope
  while (s) {
    if (s.instance) return s.instance
    s = s.parent
  }
  return null
}
```

This requires `Scope` to have an optional `instance` back-reference. In `packages/dom/src/types.ts`:

```ts
export interface Scope {
  id: number
  parent: Scope | null
  children: Scope[]
  disposers: Array<() => void>
  bindings: Binding[]
  itemUpdaters: Array<() => void>
  /** @internal populated on root scope when installDevTools ran */
  instance?: ComponentInstance
  /** @internal cause recorded just before dispose (set by structural primitives) */
  disposalCause?: DisposerEvent['cause']
}
```

And the structural primitives (`each.ts`, `show.ts`, `branch.ts`, `child.ts`) set `scope.disposalCause = 'each-remove' | 'show-hide' | ...` on the scope about to be disposed, before calling `disposeScope`. This is a small touch in each file.

- [ ] **Step 5: Init in `installDevTools`**

In `packages/dom/src/devtools.ts`:

```ts
import { createRingBuffer as createDisposerBuffer } from './tracking/disposer-log.js'

export function installDevTools(inst: object): void {
  const ci = inst as ComponentInstance
  ci._eachDiffLog = createRingBuffer(100)
  ci._disposerLog = createDisposerBuffer(500)
  ci.rootScope.instance = ci
  // ... rest of existing setup ...
}
```

- [ ] **Step 6: Run full dom test suite**

```bash
pnpm --filter @llui/dom test
```

Expected: all tests pass (including existing scope tests).

- [ ] **Step 7: No commit — batched**

---

#### Task 6: Msg coverage tracker

**Files:**
- Create: `packages/dom/src/tracking/coverage.ts`
- Modify: `packages/dom/src/devtools.ts` (count in history recorder)
- Modify: `packages/dom/src/types.ts` (`ComponentInstance._coverage`)
- Test: extend `packages/dom/test/tracking.test.ts`

- [ ] **Step 1: Write failing test**

Append:

```ts
import { createCoverageTracker } from '../src/tracking/coverage'

describe('coverage tracker', () => {
  it('counts fired variants and tracks lastIndex', () => {
    const cov = createCoverageTracker()
    cov.record('Increment', 0)
    cov.record('Increment', 1)
    cov.record('Reset', 2)
    const snap = cov.snapshot()
    expect(snap.fired.Increment).toEqual({ count: 2, lastIndex: 1 })
    expect(snap.fired.Reset).toEqual({ count: 1, lastIndex: 2 })
  })

  it('computes neverFired from a known variants list', () => {
    const cov = createCoverageTracker()
    cov.record('A', 0)
    const snap = cov.snapshot(['A', 'B', 'C'])
    expect(snap.neverFired).toEqual(['B', 'C'])
  })
})
```

- [ ] **Step 2: Run and verify fail, then implement**

Create `packages/dom/src/tracking/coverage.ts`:

```ts
export interface CoverageSnapshot {
  fired: Record<string, { count: number; lastIndex: number }>
  neverFired: string[]
}

export interface CoverageTracker {
  record(variant: string, messageIndex: number): void
  snapshot(knownVariants?: string[]): CoverageSnapshot
  clear(): void
}

export function createCoverageTracker(): CoverageTracker {
  const fired = new Map<string, { count: number; lastIndex: number }>()
  return {
    record(variant, messageIndex) {
      const existing = fired.get(variant)
      if (existing) {
        existing.count++
        existing.lastIndex = messageIndex
      } else {
        fired.set(variant, { count: 1, lastIndex: messageIndex })
      }
    },
    snapshot(knownVariants) {
      const firedObj: Record<string, { count: number; lastIndex: number }> = {}
      for (const [k, v] of fired) firedObj[k] = { ...v }
      const neverFired = knownVariants ? knownVariants.filter((v) => !fired.has(v)) : []
      return { fired: firedObj, neverFired }
    },
    clear() {
      fired.clear()
    },
  }
}
```

- [ ] **Step 3: Verify pass**

```bash
pnpm --filter @llui/dom test -- tracking.test.ts
```

Expected: 2 new tests pass.

- [ ] **Step 4: Wire into `installDevTools` history recorder**

In `packages/dom/src/devtools.ts`, inside the intercepted `update`:

```ts
import { createCoverageTracker } from './tracking/coverage.js'

export function installDevTools(inst: object): void {
  const ci = inst as ComponentInstance
  // ... existing setup ...
  ci._coverage = createCoverageTracker()

  const originalUpdate = ci.def.update
  ci.def.update = ((state: unknown, msg: unknown) => {
    const [newState, effects] = (
      originalUpdate as (s: unknown, m: unknown) => [unknown, unknown[]]
    )(state, msg)
    // ... existing dirty-mask + history push ...

    // NEW: record coverage
    const variant =
      msg && typeof msg === 'object' && 'type' in (msg as Record<string, unknown>)
        ? String((msg as Record<string, unknown>).type)
        : '<non-discriminant>'
    ci._coverage!.record(variant, idx - 1)

    return [newState, effects]
  }) as typeof ci.def.update
}
```

And in `types.ts`:

```ts
export interface ComponentInstance<S = unknown, M = unknown, E = unknown> {
  // ...
  _coverage?: CoverageTracker
}
```

- [ ] **Step 5: Run full dom suite**

```bash
pnpm --filter @llui/dom test
pnpm --filter @llui/dom run check
```

Expected: pass.

- [ ] **Step 6: No commit**

---

#### Task 7: Effect timeline tracker + `@llui/effects` interceptor hook

**Why:** `llui_pending_effects`, `llui_effect_timeline`, `llui_mock_effect`, `llui_resolve_effect` all hinge on the effects runtime exposing pending/resolved events plus an interception point. `@llui/effects` gets a dev-only `_setEffectInterceptor`; the runtime in `@llui/dom` emits timeline events on dispatch/resolve.

**Files:**
- Create: `packages/dom/src/tracking/effect-timeline.ts`
- Modify: `packages/effects/src/resolve.ts` (null-check hook)
- Modify: `packages/effects/src/index.ts` (export hook setter)
- Modify: `packages/dom/src/update-loop.ts` (emit dispatch + in-flight + resolve events)
- Modify: `packages/dom/src/devtools.ts` (init timeline + effect-mock registry)
- Test: `packages/dom/test/tracking.test.ts` + `packages/effects/test/interceptor.test.ts`

- [ ] **Step 1: Write failing test for interceptor hook**

Create `packages/effects/test/interceptor.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { _setEffectInterceptor, resolveEffect } from '../src/resolve'

describe('effect interceptor hook', () => {
  it('returns mocked response when hook matches', async () => {
    _setEffectInterceptor((effect, id) => {
      if ((effect as { type: string }).type === 'http') {
        return { mocked: true, response: { data: 'fake' } }
      }
      return { mocked: false }
    })

    const effect = { type: 'http', url: '/api/x' }
    const result = await resolveEffect(effect, 'id-1')
    expect(result).toEqual({ mocked: true, response: { data: 'fake' } })

    _setEffectInterceptor(null)
  })

  it('passes through to real handler when hook returns { mocked: false }', async () => {
    _setEffectInterceptor((_e, _id) => ({ mocked: false }))
    const effect = { type: 'log', message: 'hi' }
    const result = await resolveEffect(effect, 'id-2')
    expect(result).toEqual({ mocked: false })
    _setEffectInterceptor(null)
  })

  it('is a no-op when hook is null (production)', async () => {
    _setEffectInterceptor(null)
    const effect = { type: 'x' }
    const result = await resolveEffect(effect, 'id-3')
    expect(result).toEqual({ mocked: false })
  })
})
```

- [ ] **Step 2: Verify fail**

```bash
pnpm --filter @llui/effects test -- interceptor.test.ts
```

Expected: failure — `_setEffectInterceptor` not exported.

- [ ] **Step 3: Implement interceptor in `@llui/effects`**

Edit `packages/effects/src/resolve.ts`. At the top:

```ts
type EffectInterceptor =
  | ((effect: unknown, id: string) => { mocked: true; response: unknown } | { mocked: false })
  | null

let interceptor: EffectInterceptor = null

/**
 * Dev-only hook used by @llui/mcp to implement effect mocking. No-op in
 * production — setting this is a developer-opt-in. One null-check per
 * effect dispatch; zero allocation when interceptor is null.
 */
export function _setEffectInterceptor(hook: EffectInterceptor): void {
  interceptor = hook
}

export function resolveEffect(
  effect: unknown,
  id: string,
): Promise<{ mocked: true; response: unknown } | { mocked: false }> {
  if (interceptor !== null) {
    const result = interceptor(effect, id)
    if (result.mocked) return Promise.resolve(result)
  }
  return Promise.resolve({ mocked: false })
}
```

Export from `packages/effects/src/index.ts`:

```ts
export { _setEffectInterceptor, resolveEffect } from './resolve.js'
```

- [ ] **Step 4: Verify interceptor tests pass**

```bash
pnpm --filter @llui/effects test -- interceptor.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Add timeline type + tests**

Append to `packages/dom/test/tracking.test.ts`:

```ts
import type { EffectTimelineEntry } from '../src/tracking/effect-timeline'
import { createRingBuffer as createRB3 } from '../src/tracking/effect-timeline'

describe('effect timeline', () => {
  it('records phases in order', () => {
    const buf = createRB3<EffectTimelineEntry>(500)
    buf.push({ effectId: 'e1', type: 'http', phase: 'dispatched', timestamp: 1 })
    buf.push({ effectId: 'e1', type: 'http', phase: 'in-flight', timestamp: 2 })
    buf.push({ effectId: 'e1', type: 'http', phase: 'resolved', timestamp: 5, durationMs: 4 })
    const entries = buf.toArray()
    expect(entries.map((e) => e.phase)).toEqual(['dispatched', 'in-flight', 'resolved'])
    expect(entries[2]!.durationMs).toBe(4)
  })
})
```

- [ ] **Step 6: Implement timeline**

Create `packages/dom/src/tracking/effect-timeline.ts`:

```ts
import { createRingBuffer, type RingBuffer } from './each-diff.js'

export interface EffectTimelineEntry {
  effectId: string
  type: string
  phase: 'dispatched' | 'in-flight' | 'resolved' | 'resolved-mocked' | 'cancelled'
  timestamp: number
  durationMs?: number
}

export interface PendingEffect {
  id: string
  type: string
  dispatchedAt: number
  status: 'queued' | 'in-flight'
  payload: unknown
}

export { createRingBuffer, type RingBuffer }
```

Run the tracking tests:

```bash
pnpm --filter @llui/dom test -- tracking.test.ts
```

Expected: pass.

- [ ] **Step 7: Emit timeline events from `update-loop.ts`**

In `packages/dom/src/update-loop.ts`, find where effects are dispatched (in `flushInstance` or equivalent). Wrap dispatch:

```ts
import { randomUUID } from './util/uuid.js'
// (or use crypto.randomUUID() if available in target envs)

function dispatchEffect(inst: ComponentInstance, effect: unknown): void {
  if (inst._effectTimeline !== undefined) {
    const id = crypto.randomUUID()
    const type =
      effect && typeof effect === 'object' && 'type' in (effect as Record<string, unknown>)
        ? String((effect as Record<string, unknown>).type)
        : '<unknown>'
    const dispatchedAt = Date.now()

    // Check mock registry first
    const mock = inst._effectMocks?.match(effect)
    if (mock) {
      inst._effectTimeline.push({ effectId: id, type, phase: 'dispatched', timestamp: dispatchedAt })
      inst._effectTimeline.push({
        effectId: id,
        type,
        phase: 'resolved-mocked',
        timestamp: Date.now(),
        durationMs: 0,
      })
      // Feed mocked response back as the next message (effect-specific; pattern established
      // in @llui/effects handleEffects — mocks resolve by dispatching the onSuccess msg).
      applyMockResponse(inst, effect, mock.response)
      return
    }

    inst._effectTimeline.push({ effectId: id, type, phase: 'dispatched', timestamp: dispatchedAt })
    inst._pendingEffects?.push({ id, type, dispatchedAt, status: 'queued', payload: effect })

    // Real dispatch through the existing pathway.
    realDispatch(inst, effect, {
      onStart: () => {
        inst._effectTimeline?.push({ effectId: id, type, phase: 'in-flight', timestamp: Date.now() })
        const pending = inst._pendingEffects?.findById(id)
        if (pending) pending.status = 'in-flight'
      },
      onResolve: () => {
        inst._effectTimeline?.push({
          effectId: id,
          type,
          phase: 'resolved',
          timestamp: Date.now(),
          durationMs: Date.now() - dispatchedAt,
        })
        inst._pendingEffects?.remove(id)
      },
      onCancel: () => {
        inst._effectTimeline?.push({
          effectId: id,
          type,
          phase: 'cancelled',
          timestamp: Date.now(),
          durationMs: Date.now() - dispatchedAt,
        })
        inst._pendingEffects?.remove(id)
      },
    })
    return
  }

  // Production path: unchanged
  realDispatch(inst, effect)
}
```

**Note to executor:** the existing code in `update-loop.ts` doesn't expose hooks like this; the implementation will require a thin wrapper around whatever effect-dispatch function the runtime uses. Look for calls to `handleEffects` / user-provided `onEffect` handlers and route them through this new `dispatchEffect`. If that refactor is nontrivial, split into two sub-tasks (7a and 7b) — do not merge a half-refactored update loop.

- [ ] **Step 8: Add mock registry + pending-effects list**

In `packages/dom/src/tracking/effect-timeline.ts`, extend:

```ts
export interface EffectMatch {
  type?: string
  payloadPath?: string
  payloadEquals?: unknown
}

export interface EffectMock {
  mockId: string
  match: EffectMatch
  response: unknown
  persist: boolean
}

export interface MockRegistry {
  add(match: EffectMatch, response: unknown, persist: boolean): string
  match(effect: unknown): { response: unknown } | null
  clear(): void
  list(): EffectMock[]
}

export function createMockRegistry(): MockRegistry {
  const mocks: EffectMock[] = []
  let nextId = 1
  function matches(m: EffectMock, effect: unknown): boolean {
    if (effect == null || typeof effect !== 'object') return false
    const eff = effect as Record<string, unknown>
    if (m.match.type !== undefined && eff.type !== m.match.type) return false
    if (m.match.payloadPath !== undefined) {
      const parts = m.match.payloadPath.split('.')
      let v: unknown = eff
      for (const p of parts) {
        if (v == null || typeof v !== 'object') return false
        v = (v as Record<string, unknown>)[p]
      }
      if (m.match.payloadEquals !== undefined && v !== m.match.payloadEquals) return false
    }
    return true
  }
  return {
    add(match, response, persist) {
      const mockId = `mock-${nextId++}`
      mocks.push({ mockId, match, response, persist })
      return mockId
    },
    match(effect) {
      for (let i = 0; i < mocks.length; i++) {
        const m = mocks[i]!
        if (matches(m, effect)) {
          const response = m.response
          if (!m.persist) mocks.splice(i, 1)
          return { response }
        }
      }
      return null
    },
    clear() {
      mocks.length = 0
    },
    list() {
      return mocks.slice()
    },
  }
}

export interface PendingEffectsList {
  push(p: PendingEffect): void
  findById(id: string): PendingEffect | undefined
  remove(id: string): void
  list(): PendingEffect[]
}

export function createPendingEffectsList(): PendingEffectsList {
  const items: PendingEffect[] = []
  return {
    push: (p) => {
      items.push(p)
    },
    findById: (id) => items.find((p) => p.id === id),
    remove(id) {
      const i = items.findIndex((p) => p.id === id)
      if (i >= 0) items.splice(i, 1)
    },
    list: () => items.slice(),
  }
}
```

- [ ] **Step 9: Init in `installDevTools` and connect interceptor**

In `packages/dom/src/devtools.ts`:

```ts
import {
  createRingBuffer as createTimelineBuffer,
  createMockRegistry,
  createPendingEffectsList,
} from './tracking/effect-timeline.js'
import { _setEffectInterceptor } from '@llui/effects'

export function installDevTools(inst: object): void {
  const ci = inst as ComponentInstance
  // ... existing setup including each-diff, disposer log, coverage ...
  ci._effectTimeline = createTimelineBuffer(500)
  ci._effectMocks = createMockRegistry()
  ci._pendingEffects = createPendingEffectsList()

  // Wire @llui/effects interceptor once per process. Multiple component
  // installs share the hook; the hook checks each instance's mocks.
  _setEffectInterceptor((effect, _id) => {
    // Find the active instance — for multi-component apps we check the
    // current globally-selected one. For single-component apps this is ci.
    const g = globalThis as unknown as { __lluiDebug?: { __componentKey?: string } }
    const activeKey = g.__lluiDebug?.__componentKey
    // Simple heuristic: if any installed instance has a matching mock, use it.
    // Real impl walks __lluiComponents and checks each in registration order.
    const mock = ci._effectMocks!.match(effect)
    if (mock) return { mocked: true, response: mock.response }
    return { mocked: false }
  })
}
```

Add to `types.ts`:

```ts
import type {
  RingBuffer as EffectTimelineRing,
  EffectTimelineEntry,
  MockRegistry,
  PendingEffectsList,
} from './tracking/effect-timeline.js'

export interface ComponentInstance<S = unknown, M = unknown, E = unknown> {
  // ...
  _effectTimeline?: EffectTimelineRing<EffectTimelineEntry>
  _effectMocks?: MockRegistry
  _pendingEffects?: PendingEffectsList
}
```

- [ ] **Step 10: Run full suite**

```bash
pnpm turbo test
pnpm turbo check
```

Expected: all pass.

- [ ] **Step 11: No commit — batched at end of Section B**

---

### Section B commit

- [ ] **Task B-commit: Commit runtime trackers + effect interceptor**

```bash
git add packages/dom/src/tracking/ packages/dom/src/devtools.ts \
        packages/dom/src/scope.ts packages/dom/src/structural/each.ts \
        packages/dom/src/update-loop.ts packages/dom/src/types.ts \
        packages/dom/test/tracking.test.ts \
        packages/effects/src/resolve.ts packages/effects/src/index.ts \
        packages/effects/test/interceptor.test.ts

git commit -m "$(cat <<'EOF'
feat(dom,effects): add dev-mode runtime trackers + effect-interceptor hook

Four new ring-buffer trackers in @llui/dom, all populated only when
installDevTools ran (zero cost in production):
  - each-diff log (reconciliation add/remove/move/reuse per update)
  - disposer log (scope disposal events with cause)
  - effect timeline (dispatch → in-flight → resolved/cancelled)
  - msg coverage (per-Msg-variant counts + never-fired set)

New _setEffectInterceptor export in @llui/effects. One null-check per
dispatch in production. Dev-mode installs a hook that short-circuits
effects via the MockRegistry attached to each component instance.

Prerequisite for Phase 1 MCP tool handlers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Confirm with user first.

---

### Section C — View/DOM tools (5 tasks: #1–5 from §3.1)

Each tool in this section follows the same TDD shape:

1. Add unit test (mocked API) → red.
2. Add debug-API method in `packages/dom/src/devtools.ts`.
3. Add tool definition + handler in `packages/mcp/src/tools/debug-api.ts`.
4. Verify unit test → green.
5. If DOM-touching, add jsdom test → red.
6. Verify jsdom test → green.

#### Task 8: `llui_inspect_element`

**Files:**
- Modify: `packages/dom/src/devtools.ts` (add `inspectElement`)
- Modify: `packages/dom/src/index.ts` (export `ElementReport`)
- Modify: `packages/mcp/src/tools/debug-api.ts` (register tool)
- Test: `packages/mcp/test/tools-view.test.ts`
- Test: `packages/mcp/test/jsdom-view.test.ts`

- [ ] **Step 1: Unit test — red**

Create `packages/mcp/test/tools-view.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { LluiMcpServer } from '../src/index'
import type { LluiDebugAPI } from '@llui/dom'

function mkApi(overrides: Partial<LluiDebugAPI> = {}): LluiDebugAPI {
  const base = {
    getState: () => ({}),
    send: vi.fn(),
    flush: vi.fn(),
    getMessageHistory: () => [],
    evalUpdate: () => ({ state: {}, effects: [] }),
    exportTrace: () => ({
      lluiTrace: 1 as const,
      component: 'T',
      generatedBy: 't',
      timestamp: '',
      entries: [],
    }),
    clearLog: vi.fn(),
    validateMessage: () => null,
    getBindings: () => [],
    whyDidUpdate: () => ({
      bindingIndex: 0,
      bindingMask: 0,
      lastDirtyMask: 0,
      matched: false,
      accessorResult: undefined,
      lastValue: undefined,
      changed: false,
    }),
    searchState: () => undefined,
    getMessageSchema: () => null,
    getMaskLegend: () => null,
    decodeMask: () => [],
    getComponentInfo: () => ({ name: 'T', file: null, line: null }),
    getStateSchema: () => null,
    getEffectSchema: () => null,
    snapshotState: () => ({}),
    restoreState: vi.fn(),
    getBindingsFor: () => [],
    // Phase 1 additions:
    inspectElement: vi.fn(() => null),
    getRenderedHtml: vi.fn(() => ''),
    getFocus: vi.fn(() => ({
      selector: null,
      tagName: null,
      selectionStart: null,
      selectionEnd: null,
    })),
    dispatchDomEvent: vi.fn(() => ({
      dispatched: false,
      messagesProducedIndices: [],
      resultingState: null,
    })),
    getBindingGraph: vi.fn(() => []),
    forceRerender: vi.fn(() => ({ changedBindings: [] })),
    getScopeTree: vi.fn(() => ({ scopeId: '0', kind: 'root' as const, active: true, children: [] })),
    getEachDiff: vi.fn(() => []),
    getDisposerLog: vi.fn(() => []),
    getPendingEffects: vi.fn(() => []),
    getEffectTimeline: vi.fn(() => []),
    mockEffect: vi.fn(() => ({ mockId: 'm1' })),
    resolveEffect: vi.fn(() => ({ resolved: true })),
    stepBack: vi.fn(() => ({ state: {}, rewindDepth: 0 })),
    getCoverage: vi.fn(() => ({ fired: {}, neverFired: [] })),
    evalInPage: vi.fn(() => ({
      result: null,
      sideEffects: {
        stateChanged: null,
        newHistoryEntries: 0,
        newPendingEffects: [],
        dirtyBindingIndices: [],
      },
    })),
  } as unknown as LluiDebugAPI
  return Object.assign(base, overrides)
}

describe('llui_inspect_element', () => {
  it('forwards selector to inspectElement and returns the report', async () => {
    const report = {
      selector: '#app',
      tagName: 'div',
      attributes: {},
      classes: [],
      dataset: {},
      text: 'hi',
      computed: { display: 'block', visibility: 'visible', position: 'static', width: 100, height: 20 },
      boundingBox: { x: 0, y: 0, width: 100, height: 20 },
      bindings: [],
    }
    const api = mkApi({ inspectElement: vi.fn(() => report) })
    const server = new LluiMcpServer()
    server.connectDirect(api)

    const result = await server.handleToolCall('llui_inspect_element', { selector: '#app' })
    expect(api.inspectElement).toHaveBeenCalledWith('#app')
    expect(result).toEqual(report)
  })

  it('returns null when selector does not match', async () => {
    const api = mkApi({ inspectElement: vi.fn(() => null) })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_inspect_element', { selector: '#missing' })
    expect(result).toBeNull()
  })
})
```

Run:

```bash
pnpm --filter @llui/mcp test -- tools-view.test.ts
```

Expected: fail — `Unknown tool: llui_inspect_element`.

- [ ] **Step 2: Implement `inspectElement` in `@llui/dom`**

In `packages/dom/src/devtools.ts`, extend the `LluiDebugAPI` interface and implementation:

```ts
export interface ElementReport {
  selector: string
  tagName: string
  attributes: Record<string, string>
  classes: string[]
  dataset: Record<string, string>
  text: string
  computed: {
    display: string
    visibility: string
    position: string
    width: number
    height: number
  }
  boundingBox: { x: number; y: number; width: number; height: number }
  bindings: Array<{
    bindingIndex: number
    kind: string
    mask: number
    lastValue: unknown
    relation: 'self' | 'text-child' | 'comment-child'
  }>
}

export interface LluiDebugAPI {
  // ... existing methods ...
  inspectElement(selector: string): ElementReport | null
}
```

Implementation inside `installDevTools`:

```ts
inspectElement(selector: string): ElementReport | null {
  if (typeof document === 'undefined') return null
  const el = document.querySelector(selector)
  if (!(el instanceof Element)) return null

  const attributes: Record<string, string> = {}
  for (const a of Array.from(el.attributes)) attributes[a.name] = a.value
  const classes = Array.from(el.classList)
  const dataset: Record<string, string> = {}
  if (el instanceof HTMLElement) {
    for (const [k, v] of Object.entries(el.dataset)) {
      if (typeof v === 'string') dataset[k] = v
    }
  }
  const text = (el.textContent ?? '').slice(0, 1000)
  const rect = el.getBoundingClientRect()
  const computed =
    typeof window !== 'undefined' && window.getComputedStyle
      ? window.getComputedStyle(el)
      : null
  const computedOut = {
    display: computed?.display ?? 'unknown',
    visibility: computed?.visibility ?? 'unknown',
    position: computed?.position ?? 'unknown',
    width: rect.width,
    height: rect.height,
  }
  const bindingLocations = this.getBindingsFor(selector).filter((b) => {
    // Only report bindings whose node is this exact element, not descendants
    return b.relation === 'self' || b.relation === 'text-child' || b.relation === 'comment-child'
  })

  return {
    selector,
    tagName: el.tagName.toLowerCase(),
    attributes,
    classes,
    dataset,
    text,
    computed: computedOut,
    boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    bindings: bindingLocations.map((b) => ({
      bindingIndex: b.bindingIndex,
      kind: b.kind,
      mask: b.mask,
      lastValue: b.lastValue,
      relation: b.relation,
    })),
  },
```

- [ ] **Step 3: Register tool handler**

In `packages/mcp/src/tools/debug-api.ts`, append inside `registerDebugApiTools`:

```ts
registry.register(
  {
    name: 'llui_inspect_element',
    description:
      'Get a rich report for a DOM element: tag, attributes, classes, data-*, text, bounding box, a computed-style subset (display/visibility/position/dimensions), and the bindings targeting this node. Pass a CSS selector. Returns null if no element matches.',
    inputSchema: {
      type: 'object',
      properties: { selector: { type: 'string', description: 'CSS selector' } },
      required: ['selector'],
    },
  },
  'debug-api',
  async (args, ctx) => {
    if (!ctx.relay) throw new Error('Relay transport unavailable')
    return ctx.relay.call('inspectElement', [args.selector])
  },
)
```

- [ ] **Step 4: Run unit test — green**

```bash
pnpm --filter @llui/mcp test -- tools-view.test.ts
```

Expected: both new tests pass.

- [ ] **Step 5: jsdom e2e test — red**

Create `packages/mcp/test/jsdom-view.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { component, mountApp } from '@llui/dom'
import { installDevTools } from '@llui/dom/dist/devtools.js'
import { LluiMcpServer } from '../src/index'

describe('jsdom: llui_inspect_element', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>'
  })

  it('returns the element report including bindings', async () => {
    const Counter = component<{ n: number }, { type: 'inc' }, never>({
      name: 'Counter',
      init: () => [{ n: 0 }, []],
      update: (s, m) => (m.type === 'inc' ? [{ n: s.n + 1 }, []] : [s, []]),
      view: ({ text }) => ({
        kind: 'el',
        tag: 'div',
        attrs: { id: 'c' },
        children: [text((s: { n: number }) => String(s.n))],
      }) as never,
    })

    const app = mountApp(Counter, document.getElementById('root')!)
    installDevTools(app.instance)
    const server = new LluiMcpServer()
    server.connectDirect((globalThis as unknown as { __lluiDebug: import('@llui/dom').LluiDebugAPI }).__lluiDebug)

    const result = (await server.handleToolCall('llui_inspect_element', { selector: '#c' })) as {
      tagName: string
      text: string
      bindings: Array<{ kind: string }>
    } | null
    expect(result).not.toBeNull()
    expect(result!.tagName).toBe('div')
    expect(result!.bindings.length).toBeGreaterThan(0)
  })
})
```

Run:

```bash
pnpm --filter @llui/mcp test -- jsdom-view.test.ts
```

Expected: pass (since implementation is in place).

- [ ] **Step 6: No commit — batched at end of Section C**

---

#### Task 9: `llui_get_rendered_html`

**Files:**
- Modify: `packages/dom/src/devtools.ts` (add `getRenderedHtml`)
- Modify: `packages/mcp/src/tools/debug-api.ts`
- Test: `packages/mcp/test/tools-view.test.ts` (append)
- Test: `packages/mcp/test/jsdom-view.test.ts` (append)

- [ ] **Step 1: Unit test — red**

Append to `packages/mcp/test/tools-view.test.ts`:

```ts
describe('llui_get_rendered_html', () => {
  it('returns html from getRenderedHtml', async () => {
    const api = mkApi({ getRenderedHtml: vi.fn(() => '<div>hi</div>') })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_get_rendered_html', {})
    expect(api.getRenderedHtml).toHaveBeenCalledWith(undefined, undefined)
    expect(result).toBe('<div>hi</div>')
  })

  it('forwards selector and maxLength', async () => {
    const api = mkApi({ getRenderedHtml: vi.fn(() => '<span>x</span>') })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    await server.handleToolCall('llui_get_rendered_html', { selector: '#x', maxLength: 100 })
    expect(api.getRenderedHtml).toHaveBeenCalledWith('#x', 100)
  })
})
```

Run — fail (`Unknown tool`).

- [ ] **Step 2: Implement in devtools**

Add to `LluiDebugAPI` interface:

```ts
getRenderedHtml(selector?: string, maxLength?: number): string
```

Implementation:

```ts
getRenderedHtml(selector?: string, maxLength?: number): string {
  if (typeof document === 'undefined') return ''
  const el = selector ? document.querySelector(selector) : document.body
  if (!(el instanceof Element)) return ''
  const html = el.outerHTML
  if (typeof maxLength === 'number' && html.length > maxLength) {
    return html.slice(0, maxLength) + `<!-- truncated; total ${html.length} chars -->`
  }
  return html
},
```

- [ ] **Step 3: Register tool**

```ts
registry.register(
  {
    name: 'llui_get_rendered_html',
    description:
      "Get the outerHTML of the mounted component or a specific element. Pass 'selector' for a specific node (defaults to the mount root). Pass 'maxLength' to truncate output.",
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        maxLength: { type: 'number' },
      },
    },
  },
  'debug-api',
  async (args, ctx) => {
    if (!ctx.relay) throw new Error('Relay transport unavailable')
    return ctx.relay.call('getRenderedHtml', [args.selector, args.maxLength])
  },
)
```

- [ ] **Step 4: Verify unit tests pass**

```bash
pnpm --filter @llui/mcp test -- tools-view.test.ts
```

- [ ] **Step 5: jsdom test**

Append to `packages/mcp/test/jsdom-view.test.ts`:

```ts
it('get_rendered_html returns outerHTML of a mounted element', async () => {
  document.body.innerHTML = '<div id="root"></div>'
  const App = component<{}, never, never>({
    name: 'App',
    init: () => [{}, []],
    update: (s) => [s, []],
    view: () => ({
      kind: 'el',
      tag: 'section',
      attrs: { id: 's' },
      children: [],
    }) as never,
  })
  const app = mountApp(App, document.getElementById('root')!)
  installDevTools(app.instance)
  const server = new LluiMcpServer()
  server.connectDirect((globalThis as unknown as { __lluiDebug: import('@llui/dom').LluiDebugAPI }).__lluiDebug)
  const html = (await server.handleToolCall('llui_get_rendered_html', { selector: '#s' })) as string
  expect(html.startsWith('<section')).toBe(true)
})
```

- [ ] **Step 6: No commit — batched**

---

#### Task 10: `llui_dom_diff`

**Why:** Pure MCP-side function; no new debug-API method. Composes `getRenderedHtml` with a diff algorithm in `packages/mcp/src/util/diff.ts`.

**Files:**
- Create: `packages/mcp/src/util/diff.ts`
- Modify: `packages/mcp/src/tools/debug-api.ts`
- Test: `packages/mcp/test/tools-view.test.ts` (append)

- [ ] **Step 1: Unit test — red**

Append to `tools-view.test.ts`:

```ts
describe('llui_dom_diff', () => {
  it('returns no differences when html matches', async () => {
    const api = mkApi({ getRenderedHtml: vi.fn(() => '<div>hi</div>') })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_dom_diff', {
      expected: '<div>hi</div>',
    })
    expect(result).toEqual({ match: true, differences: [] })
  })

  it('reports mismatched text', async () => {
    const api = mkApi({ getRenderedHtml: vi.fn(() => '<div>actual</div>') })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = (await server.handleToolCall('llui_dom_diff', {
      expected: '<div>expected</div>',
    })) as { match: boolean; differences: unknown[] }
    expect(result.match).toBe(false)
    expect(result.differences.length).toBeGreaterThan(0)
  })

  it('ignores whitespace when flag set', async () => {
    const api = mkApi({ getRenderedHtml: vi.fn(() => '<div>  hi  </div>') })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = (await server.handleToolCall('llui_dom_diff', {
      expected: '<div>hi</div>',
      ignoreWhitespace: true,
    })) as { match: boolean }
    expect(result.match).toBe(true)
  })
})
```

- [ ] **Step 2: Implement helper**

Create `packages/mcp/src/util/diff.ts`:

```ts
export interface HtmlDiffResult {
  match: boolean
  differences: Array<{ path: string; expected: string; actual: string }>
}

export function domDiff(
  expected: string,
  actual: string,
  opts: { ignoreWhitespace?: boolean } = {},
): HtmlDiffResult {
  const norm = (s: string): string => (opts.ignoreWhitespace ? s.replace(/\s+/g, ' ').trim() : s)
  const e = norm(expected)
  const a = norm(actual)
  if (e === a) return { match: true, differences: [] }
  // Minimal diff: compare as whole strings; the LLM can read both.
  return {
    match: false,
    differences: [{ path: 'root', expected: e, actual: a }],
  }
}

export interface StateDiff {
  added: Record<string, unknown>
  removed: Record<string, unknown>
  changed: Record<string, { from: unknown; to: unknown }>
}

export function diffState(a: unknown, b: unknown): StateDiff {
  const out: StateDiff = { added: {}, removed: {}, changed: {} }
  if (
    a == null ||
    b == null ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  ) {
    if (a !== b) out.changed['<root>'] = { from: a, to: b }
    return out
  }
  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)])
  for (const k of keys) {
    if (!(k in aObj)) out.added[k] = bObj[k]
    else if (!(k in bObj)) out.removed[k] = aObj[k]
    else if (!Object.is(aObj[k], bObj[k])) out.changed[k] = { from: aObj[k], to: bObj[k] }
  }
  return out
}
```

- [ ] **Step 3: Register tool**

```ts
import { domDiff } from '../util/diff.js'

registry.register(
  {
    name: 'llui_dom_diff',
    description:
      'Compare expected HTML against the currently rendered HTML (from selector, or the mount root). Returns { match, differences }. Pass ignoreWhitespace=true to normalize whitespace.',
    inputSchema: {
      type: 'object',
      properties: {
        expected: { type: 'string' },
        selector: { type: 'string' },
        ignoreWhitespace: { type: 'boolean' },
      },
      required: ['expected'],
    },
  },
  'debug-api',
  async (args, ctx) => {
    if (!ctx.relay) throw new Error('Relay transport unavailable')
    const actual = (await ctx.relay.call('getRenderedHtml', [args.selector])) as string
    return domDiff(String(args.expected), actual, {
      ignoreWhitespace: Boolean(args.ignoreWhitespace),
    })
  },
)
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @llui/mcp test -- tools-view.test.ts
```

Expected: 3 new tests pass.

- [ ] **Step 5: No commit — batched**

---

#### Task 11: `llui_dispatch_event`

**Files:**
- Modify: `packages/dom/src/devtools.ts` (add `dispatchDomEvent`)
- Modify: `packages/mcp/src/tools/debug-api.ts`
- Test: `packages/mcp/test/tools-interaction.test.ts` (new file)
- Test: `packages/mcp/test/jsdom-interaction.test.ts` (new file)

- [ ] **Step 1: Unit test — red**

Create `packages/mcp/test/tools-interaction.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { LluiMcpServer } from '../src/index'
import type { LluiDebugAPI } from '@llui/dom'

// Reuse mkApi from tools-view.test.ts by re-exporting or copy the helper inline.
// For brevity, copy it here; DRY will be addressed once more tests exist.
function mkApi(overrides: Partial<LluiDebugAPI> = {}): LluiDebugAPI {
  // ... (same helper as in tools-view.test.ts) ...
  return {
    /* same full shape */
  } as unknown as LluiDebugAPI
}

describe('llui_dispatch_event', () => {
  it('dispatches the event through the debug API', async () => {
    const api = mkApi({
      dispatchDomEvent: vi.fn(() => ({
        dispatched: true,
        messagesProducedIndices: [3],
        resultingState: { count: 1 },
      })),
    })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_dispatch_event', {
      selector: '#btn',
      type: 'click',
    })
    expect(api.dispatchDomEvent).toHaveBeenCalledWith('#btn', 'click', undefined)
    expect(result).toEqual({
      dispatched: true,
      messagesProducedIndices: [3],
      resultingState: { count: 1 },
    })
  })

  it('forwards the event init object', async () => {
    const api = mkApi({ dispatchDomEvent: vi.fn(() => ({ dispatched: true, messagesProducedIndices: [], resultingState: null })) })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    await server.handleToolCall('llui_dispatch_event', {
      selector: '#input',
      type: 'keydown',
      init: { key: 'Enter' },
    })
    expect(api.dispatchDomEvent).toHaveBeenCalledWith('#input', 'keydown', { key: 'Enter' })
  })
})
```

Run — fail.

- [ ] **Step 2: Implement `dispatchDomEvent`**

In `packages/dom/src/devtools.ts`, add to interface and impl:

```ts
dispatchDomEvent(
  selector: string,
  type: string,
  init?: EventInit,
): {
  dispatched: boolean
  messagesProducedIndices: number[]
  resultingState: unknown | null
}
```

Impl:

```ts
dispatchDomEvent(selector, type, init) {
  if (typeof document === 'undefined') {
    return { dispatched: false, messagesProducedIndices: [], resultingState: null }
  }
  const el = document.querySelector(selector)
  if (!(el instanceof Element)) {
    return { dispatched: false, messagesProducedIndices: [], resultingState: null }
  }

  const preIndex = history.length > 0 ? history[history.length - 1]!.index : -1

  let event: Event
  if (type === 'click' || type === 'mousedown' || type === 'mouseup') {
    event = new MouseEvent(type, { bubbles: true, cancelable: true, ...(init as MouseEventInit) })
  } else if (type === 'keydown' || type === 'keyup' || type === 'keypress') {
    event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...(init as KeyboardEventInit) })
  } else if (type === 'input' || type === 'change') {
    event = new Event(type, { bubbles: true, cancelable: true, ...init })
  } else {
    event = new Event(type, { bubbles: true, cancelable: true, ...init })
  }

  el.dispatchEvent(event)
  flushInstance(ci)

  const newEntries = history.filter((h) => h.index > preIndex)
  return {
    dispatched: true,
    messagesProducedIndices: newEntries.map((h) => h.index),
    resultingState: ci.state,
  }
},
```

- [ ] **Step 3: Register tool**

```ts
registry.register(
  {
    name: 'llui_dispatch_event',
    description:
      "Synthesize and dispatch a browser event at a DOM element. Returns the history indices of any Msgs the handler produced plus the resulting state. 'type' is the event name (e.g. 'click', 'input', 'keydown'). 'init' is an EventInit object (e.g. { key: 'Enter' } for keydown).",
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string' },
        type: { type: 'string' },
        init: { type: 'object' },
      },
      required: ['selector', 'type'],
    },
  },
  'debug-api',
  async (args, ctx) => {
    if (!ctx.relay) throw new Error('Relay transport unavailable')
    return ctx.relay.call('dispatchDomEvent', [args.selector, args.type, args.init])
  },
)
```

- [ ] **Step 4: Run unit tests**

```bash
pnpm --filter @llui/mcp test -- tools-interaction.test.ts
```

- [ ] **Step 5: jsdom test**

Create `packages/mcp/test/jsdom-interaction.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { component, mountApp } from '@llui/dom'
import { installDevTools } from '@llui/dom/dist/devtools.js'
import { LluiMcpServer } from '../src/index'

describe('jsdom: llui_dispatch_event', () => {
  it('click produces the expected Msg and updates state', async () => {
    document.body.innerHTML = '<div id="root"></div>'
    const Counter = component<{ n: number }, { type: 'inc' }, never>({
      name: 'Counter',
      init: () => [{ n: 0 }, []],
      update: (s, m) => (m.type === 'inc' ? [{ n: s.n + 1 }, []] : [s, []]),
      view: ({ send, text }) =>
        ({
          kind: 'el',
          tag: 'button',
          attrs: { id: 'b', onClick: () => send({ type: 'inc' }) },
          children: [text((s: { n: number }) => String(s.n))],
        }) as never,
    })
    const app = mountApp(Counter, document.getElementById('root')!)
    installDevTools(app.instance)
    const server = new LluiMcpServer()
    server.connectDirect(
      (globalThis as unknown as { __lluiDebug: import('@llui/dom').LluiDebugAPI }).__lluiDebug,
    )
    const result = (await server.handleToolCall('llui_dispatch_event', {
      selector: '#b',
      type: 'click',
    })) as { dispatched: boolean; messagesProducedIndices: number[]; resultingState: { n: number } }
    expect(result.dispatched).toBe(true)
    expect(result.messagesProducedIndices.length).toBe(1)
    expect(result.resultingState.n).toBe(1)
  })
})
```

Run:

```bash
pnpm --filter @llui/mcp test -- jsdom-interaction.test.ts
```

Expected: pass.

- [ ] **Step 6: No commit — batched**

---

#### Task 12: `llui_get_focus`

**Files:**
- Modify: `packages/dom/src/devtools.ts` (add `getFocus`)
- Modify: `packages/mcp/src/tools/debug-api.ts`
- Test: `packages/mcp/test/tools-interaction.test.ts` (append)

- [ ] **Step 1: Unit test — red**

Append:

```ts
describe('llui_get_focus', () => {
  it('returns focus info from getFocus', async () => {
    const api = mkApi({
      getFocus: vi.fn(() => ({
        selector: '#input',
        tagName: 'input',
        selectionStart: 2,
        selectionEnd: 2,
      })),
    })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_get_focus', {})
    expect(result).toEqual({
      selector: '#input',
      tagName: 'input',
      selectionStart: 2,
      selectionEnd: 2,
    })
  })
})
```

- [ ] **Step 2: Implement**

Add to `LluiDebugAPI`:

```ts
getFocus(): {
  selector: string | null
  tagName: string | null
  selectionStart: number | null
  selectionEnd: number | null
}
```

Impl:

```ts
getFocus() {
  if (typeof document === 'undefined') {
    return { selector: null, tagName: null, selectionStart: null, selectionEnd: null }
  }
  const el = document.activeElement
  if (!el || el === document.body) {
    return { selector: null, tagName: null, selectionStart: null, selectionEnd: null }
  }
  const id = el.id ? `#${el.id}` : null
  const tagName = el.tagName.toLowerCase()
  let selectionStart: number | null = null
  let selectionEnd: number | null = null
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    selectionStart = el.selectionStart ?? null
    selectionEnd = el.selectionEnd ?? null
  }
  return { selector: id, tagName, selectionStart, selectionEnd }
},
```

- [ ] **Step 3: Register tool**

```ts
registry.register(
  {
    name: 'llui_get_focus',
    description:
      'Return info about the currently focused element: { selector (if it has an id), tagName, selectionStart, selectionEnd }. Useful for catching "focus lost on re-render" bugs.',
    inputSchema: { type: 'object', properties: {} },
  },
  'debug-api',
  async (_args, ctx) => {
    if (!ctx.relay) throw new Error('Relay transport unavailable')
    return ctx.relay.call('getFocus', [])
  },
)
```

- [ ] **Step 4: Run and verify pass**

```bash
pnpm --filter @llui/mcp test -- tools-interaction.test.ts
```

- [ ] **Step 5: No commit — batched**

---

### Section C commit

- [ ] **Task C-commit: Commit view/DOM + interaction tools**

```bash
git add packages/dom/src/devtools.ts packages/dom/src/index.ts \
        packages/mcp/src/tools/debug-api.ts packages/mcp/src/util/diff.ts \
        packages/mcp/test/tools-view.test.ts packages/mcp/test/tools-interaction.test.ts \
        packages/mcp/test/jsdom-view.test.ts packages/mcp/test/jsdom-interaction.test.ts

git commit -m "$(cat <<'EOF'
feat(mcp,dom): add view/DOM + interaction tools (inspect_element, get_rendered_html, dom_diff, dispatch_event, get_focus)

Five new LluiDebugAPI methods with in-page DOM introspection and event synthesis.
MCP tools route through the existing WebSocket relay; dom_diff is a pure MCP-side
helper composing getRenderedHtml with a normalizing string comparison.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Confirm with user.

---

### Section D — Binding/scope tools (6 tasks: #6–11)

Tasks 13–18 follow the same pattern as Section C. Each task's structure is:

1. Unit test against mocked API → red
2. Add `LluiDebugAPI` method in `devtools.ts`
3. Register MCP tool in `debug-api.ts`
4. Verify unit test green
5. (optional) jsdom test
6. No commit — batched at end of section

Below: the tool-specific details. The TDD steps are identical in shape to Tasks 8–12.

#### Task 13: `llui_force_rerender`

**Debug-API method:**

```ts
// Interface addition
forceRerender(): { changedBindings: number[] }

// Implementation (in devtools.ts installDevTools)
forceRerender(): { changedBindings: number[] } {
  const changed: number[] = []
  const { allBindings } = ci
  for (let i = 0; i < allBindings.length; i++) {
    const b = allBindings[i]!
    if (b.dead) continue
    const next = b.accessor(ci.state)
    if (!Object.is(next, b.lastValue)) {
      changed.push(i)
      b.lastValue = next
      applyBinding(b)  // from '@llui/dom/binding.js'
    }
  }
  return { changedBindings: changed }
},
```

**MCP tool:**

```ts
registry.register(
  {
    name: 'llui_force_rerender',
    description:
      "Re-evaluate every binding's accessor against the current state, apply changed values to the DOM, and return the indices of bindings that changed. If a binding's DOM value corrects itself after this call but not after a real message, the mask for that binding is wrong.",
    inputSchema: { type: 'object', properties: {} },
  },
  'debug-api',
  async (_args, ctx) => {
    if (!ctx.relay) throw new Error('Relay transport unavailable')
    return ctx.relay.call('forceRerender', [])
  },
)
```

**Unit test** (append to `packages/mcp/test/tools-bindings.test.ts`, create file if needed — use the same `mkApi` helper shape):

```ts
describe('llui_force_rerender', () => {
  it('calls forceRerender and returns changed bindings', async () => {
    const api = mkApi({ forceRerender: vi.fn(() => ({ changedBindings: [0, 3] })) })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_force_rerender', {})
    expect(result).toEqual({ changedBindings: [0, 3] })
  })
})
```

#### Task 14: `llui_each_diff`

**Debug-API method:**

```ts
getEachDiff(sinceIndex?: number): EachDiff[]

// Implementation
getEachDiff(sinceIndex?: number): EachDiff[] {
  const all = ci._eachDiffLog?.toArray() ?? []
  if (sinceIndex === undefined) return all
  return all.filter((e) => e.updateIndex >= sinceIndex)
},
```

**MCP tool:**

```ts
registry.register(
  {
    name: 'llui_each_diff',
    description:
      "Per-each-site reconciliation diffs (added/removed/moved/reused keys) from the dev-time diff log. Pass 'sinceIndex' to filter to entries after a specific message history index.",
    inputSchema: {
      type: 'object',
      properties: { sinceIndex: { type: 'number' } },
    },
  },
  'debug-api',
  async (args, ctx) => {
    if (!ctx.relay) throw new Error('Relay transport unavailable')
    return ctx.relay.call('getEachDiff', [args.sinceIndex])
  },
)
```

**Unit test:**

```ts
describe('llui_each_diff', () => {
  it('forwards sinceIndex', async () => {
    const diffs = [
      { updateIndex: 0, eachSiteId: 's1', added: [], removed: [], moved: [], reused: [] },
      { updateIndex: 1, eachSiteId: 's1', added: ['a'], removed: [], moved: [], reused: [] },
    ]
    const api = mkApi({ getEachDiff: vi.fn(() => diffs) })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    await server.handleToolCall('llui_each_diff', { sinceIndex: 1 })
    expect(api.getEachDiff).toHaveBeenCalledWith(1)
  })
})
```

#### Task 15: `llui_scope_tree`

**Debug-API method:**

```ts
getScopeTree(opts?: { depth?: number; scopeId?: string }): ScopeNode

// Implementation
getScopeTree(opts?: { depth?: number; scopeId?: string }): ScopeNode {
  const maxDepth = opts?.depth ?? Infinity
  const startScope = opts?.scopeId
    ? findScopeById(ci.rootScope, opts.scopeId)
    : ci.rootScope
  if (!startScope) {
    return { scopeId: '0', kind: 'root', active: false, children: [] }
  }
  return walkScope(startScope, 0, maxDepth)
},

// Helpers near the top of devtools.ts
function findScopeById(root: Scope, id: string): Scope | null {
  const n = Number(id)
  if (root.id === n) return root
  for (const c of root.children) {
    const found = findScopeById(c, id)
    if (found) return found
  }
  return null
}

function walkScope(s: Scope, depth: number, maxDepth: number): ScopeNode {
  const kind = classifyScope(s)
  const node: ScopeNode = {
    scopeId: String(s.id),
    kind,
    active: true,
    children: [],
  }
  if (depth < maxDepth) {
    for (const c of s.children) node.children.push(walkScope(c, depth + 1, maxDepth))
  }
  return node
}

function classifyScope(s: Scope): ScopeNode['kind'] {
  // Scope kind is derived from the structural block that owns this scope.
  // In practice each structural primitive tags the scope with a meta field
  // when it creates it; inspect that. Fallback to 'root'.
  const tagged = (s as unknown as { _kind?: ScopeNode['kind'] })._kind
  return tagged ?? 'root'
}
```

**Note to executor:** the structural primitives (`each.ts`, `show.ts`, `branch.ts`, `child.ts`, `portal.ts`) currently create scopes via `createScope(parent)` without kind metadata. Each needs a one-line edit to tag its scopes: `s._kind = 'each'` etc. This is a small but touchy cross-file change; list it as a sub-task if preferred.

**MCP tool:**

```ts
registry.register(
  {
    name: 'llui_scope_tree',
    description:
      "Walk the scope tree starting at the component root (or a specific scopeId). Returns a ScopeNode tree with kind (root/show/each/branch/child/portal) and children. Pass 'depth' to limit traversal, 'scopeId' to start elsewhere.",
    inputSchema: {
      type: 'object',
      properties: {
        depth: { type: 'number' },
        scopeId: { type: 'string' },
      },
    },
  },
  'debug-api',
  async (args, ctx) => {
    if (!ctx.relay) throw new Error('Relay transport unavailable')
    return ctx.relay.call('getScopeTree', [{ depth: args.depth, scopeId: args.scopeId }])
  },
)
```

**Unit test:**

```ts
describe('llui_scope_tree', () => {
  it('returns the tree from getScopeTree', async () => {
    const tree = {
      scopeId: '1',
      kind: 'root' as const,
      active: true,
      children: [
        { scopeId: '2', kind: 'each' as const, active: true, children: [] },
      ],
    }
    const api = mkApi({ getScopeTree: vi.fn(() => tree) })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_scope_tree', { depth: 2 })
    expect(result).toEqual(tree)
  })
})
```

#### Task 16: `llui_disposer_log`

**Debug-API method:**

```ts
getDisposerLog(limit?: number): DisposerEvent[]

// Implementation
getDisposerLog(limit?: number): DisposerEvent[] {
  const all = ci._disposerLog?.toArray() ?? []
  if (limit === undefined) return all
  return all.slice(-Math.max(0, limit))
},
```

**MCP tool:**

```ts
registry.register(
  {
    name: 'llui_disposer_log',
    description:
      "Recent onDispose firings with scope id and cause. Pass 'limit' to cap results to the N most recent entries. Catches 'leak on branch swap' class bugs.",
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number' } },
    },
  },
  'debug-api',
  async (args, ctx) => {
    if (!ctx.relay) throw new Error('Relay transport unavailable')
    return ctx.relay.call('getDisposerLog', [args.limit])
  },
)
```

**Unit test:** analogous to `llui_each_diff`.

#### Task 17: `llui_list_dead_bindings`

**No new debug-API method — MCP-side filter over existing `getBindings`.**

**MCP tool:**

```ts
registry.register(
  {
    name: 'llui_list_dead_bindings',
    description:
      "Bindings that are inactive (scope disposed) OR never matched a dirty mask OR never changed value. Useful for finding wasted work and 'this never updates' bugs. Returns the subset of get_bindings with an annotation on why it's flagged.",
    inputSchema: { type: 'object', properties: {} },
  },
  'debug-api',
  async (_args, ctx) => {
    if (!ctx.relay) throw new Error('Relay transport unavailable')
    const bindings = (await ctx.relay.call('getBindings', [])) as Array<{
      index: number
      mask: number
      lastValue: unknown
      kind: string
      key: string | undefined
      dead: boolean
      perItem: boolean
    }>
    return bindings
      .filter((b) => b.dead || b.lastValue === undefined)
      .map((b) => ({
        ...b,
        reason: b.dead ? 'scope_disposed' : 'never_changed',
      }))
  },
)
```

**Unit test:**

```ts
describe('llui_list_dead_bindings', () => {
  it('returns dead and never-changed bindings with a reason', async () => {
    const api = mkApi({
      getBindings: vi.fn(() => [
        { index: 0, mask: 1, lastValue: 'x', kind: 'text', key: undefined, dead: false, perItem: false },
        { index: 1, mask: 2, lastValue: undefined, kind: 'text', key: undefined, dead: false, perItem: false },
        { index: 2, mask: 4, lastValue: 'y', kind: 'text', key: undefined, dead: true, perItem: false },
      ]),
    })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = (await server.handleToolCall('llui_list_dead_bindings', {})) as Array<{
      index: number
      reason: string
    }>
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.reason).sort()).toEqual(['never_changed', 'scope_disposed'])
  })
})
```

#### Task 18: `llui_binding_graph`

**Debug-API method:**

```ts
getBindingGraph(): Array<{ statePath: string; bindingIndices: number[] }>

// Implementation: invert the compiler-emitted mask legend + per-binding mask
getBindingGraph(): Array<{ statePath: string; bindingIndices: number[] }> {
  const legend = ci.def.__maskLegend
  if (!legend) return []
  const bindingsByPath = new Map<string, number[]>()
  for (const [path, bit] of Object.entries(legend)) {
    const indices: number[] = []
    for (let i = 0; i < ci.allBindings.length; i++) {
      const b = ci.allBindings[i]!
      if ((b.mask & bit) !== 0) indices.push(i)
    }
    bindingsByPath.set(path, indices)
  }
  return Array.from(bindingsByPath, ([statePath, bindingIndices]) => ({ statePath, bindingIndices }))
},
```

**MCP tool:**

```ts
registry.register(
  {
    name: 'llui_binding_graph',
    description:
      'Edge list: state path → binding indices that depend on it. Inverts the compiler-emitted mask legend to show, for each top-level state field, which bindings will re-evaluate when it changes.',
    inputSchema: { type: 'object', properties: {} },
  },
  'debug-api',
  async (_args, ctx) => {
    if (!ctx.relay) throw new Error('Relay transport unavailable')
    return ctx.relay.call('getBindingGraph', [])
  },
)
```

**Unit test:** analogous, mock `getBindingGraph`.

### Section D commit

- [ ] **Task D-commit: Commit binding/scope tools**

```bash
git add packages/dom/src/devtools.ts packages/mcp/src/tools/debug-api.ts \
        packages/mcp/test/tools-bindings.test.ts

git commit -m "$(cat <<'EOF'
feat(mcp,dom): add binding/scope tools (force_rerender, each_diff, scope_tree, disposer_log, list_dead_bindings, binding_graph)

Six new tools covering binding re-evaluation, scope tree walk, each-diff inspection,
disposal log, dead-binding detection, and state-path→binding inversion. Four new
LluiDebugAPI methods (forceRerender, getEachDiff, getScopeTree, getDisposerLog,
getBindingGraph); list_dead_bindings is a pure MCP-side filter.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Confirm with user.

---

### Section E — Effect tools (4 tasks: #12–15)

#### Task 19: `llui_pending_effects`

**Debug-API method:**

```ts
getPendingEffects(): PendingEffect[]

// Implementation
getPendingEffects(): PendingEffect[] {
  return ci._pendingEffects?.list() ?? []
},
```

**MCP tool:**

```ts
registry.register(
  {
    name: 'llui_pending_effects',
    description:
      "Current queued and in-flight effects. Each entry has { id, type, dispatchedAt, status, payload }. Use 'id' with llui_resolve_effect to manually resolve one.",
    inputSchema: { type: 'object', properties: {} },
  },
  'debug-api',
  async (_args, ctx) => {
    if (!ctx.relay) throw new Error('Relay transport unavailable')
    return ctx.relay.call('getPendingEffects', [])
  },
)
```

**Unit test:**

```ts
describe('llui_pending_effects', () => {
  it('returns the pending effects list', async () => {
    const effects = [
      { id: 'e1', type: 'http', dispatchedAt: 1, status: 'queued' as const, payload: {} },
    ]
    const api = mkApi({ getPendingEffects: vi.fn(() => effects) })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    expect(await server.handleToolCall('llui_pending_effects', {})).toEqual(effects)
  })
})
```

#### Task 20: `llui_effect_timeline`

**Debug-API method:**

```ts
getEffectTimeline(limit?: number): EffectTimelineEntry[]

// Implementation
getEffectTimeline(limit?: number): EffectTimelineEntry[] {
  const all = ci._effectTimeline?.toArray() ?? []
  if (limit === undefined) return all
  return all.slice(-Math.max(0, limit))
},
```

**MCP tool:**

```ts
registry.register(
  {
    name: 'llui_effect_timeline',
    description:
      "Phased log of effect events: dispatched → in-flight → resolved/cancelled/resolved-mocked. Each entry has { effectId, type, phase, timestamp, durationMs? }. Pass 'limit' to cap the tail.",
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number' } },
    },
  },
  'debug-api',
  async (args, ctx) => {
    if (!ctx.relay) throw new Error('Relay transport unavailable')
    return ctx.relay.call('getEffectTimeline', [args.limit])
  },
)
```

**Unit test:** analogous.

#### Task 21: `llui_mock_effect`

**Debug-API method:**

```ts
mockEffect(
  match: EffectMatch,
  response: unknown,
  opts?: { persist?: boolean },
): { mockId: string }

// Implementation
mockEffect(match, response, opts) {
  if (!ci._effectMocks) return { mockId: '' }
  return {
    mockId: ci._effectMocks.add(match, response, Boolean(opts?.persist)),
  }
},
```

**MCP tool:**

```ts
registry.register(
  {
    name: 'llui_mock_effect',
    description:
      "Register a mock for an effect matching 'match' ({ type?, payloadPath?, payloadEquals? }). The next matching effect resolves with 'response' instead of running. Mocks are one-shot; pass { persist: true } to keep across matches. Returns { mockId } for later reference.",
    inputSchema: {
      type: 'object',
      properties: {
        match: { type: 'object' },
        response: {},
        opts: { type: 'object' },
      },
      required: ['match', 'response'],
    },
  },
  'debug-api',
  async (args, ctx) => {
    if (!ctx.relay) throw new Error('Relay transport unavailable')
    return ctx.relay.call('mockEffect', [args.match, args.response, args.opts])
  },
)
```

**Unit test:**

```ts
describe('llui_mock_effect', () => {
  it('registers a mock via mockEffect', async () => {
    const api = mkApi({ mockEffect: vi.fn(() => ({ mockId: 'm1' })) })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = await server.handleToolCall('llui_mock_effect', {
      match: { type: 'http' },
      response: { data: 'fake' },
    })
    expect(api.mockEffect).toHaveBeenCalledWith({ type: 'http' }, { data: 'fake' }, undefined)
    expect(result).toEqual({ mockId: 'm1' })
  })
})
```

**jsdom test** (verifies interceptor path):

Append to `packages/mcp/test/jsdom-effects.test.ts` (new file):

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { component, mountApp } from '@llui/dom'
import { installDevTools } from '@llui/dom/dist/devtools.js'
import { LluiMcpServer } from '../src/index'

describe('jsdom: llui_mock_effect', () => {
  it('short-circuits a matching http effect with mocked response', async () => {
    document.body.innerHTML = '<div id="root"></div>'

    type S = { data: string | null }
    type M = { type: 'fetch' } | { type: 'loaded'; data: string }
    type E = { type: 'http'; url: string; onSuccess: (d: unknown) => M; onError: () => M }

    const App = component<S, M, E>({
      name: 'App',
      init: () => [{ data: null }, []],
      update: (s, m) => {
        if (m.type === 'fetch')
          return [s, [{ type: 'http', url: '/api/x', onSuccess: (d) => ({ type: 'loaded', data: String(d) }), onError: () => ({ type: 'loaded', data: 'err' }) }]]
        if (m.type === 'loaded') return [{ data: m.data }, []]
        return [s, []]
      },
      view: () => ({ kind: 'el', tag: 'div', attrs: {}, children: [] }) as never,
    })

    const app = mountApp(App, document.getElementById('root')!)
    installDevTools(app.instance)
    const server = new LluiMcpServer()
    server.connectDirect(
      (globalThis as unknown as { __lluiDebug: import('@llui/dom').LluiDebugAPI }).__lluiDebug,
    )
    await server.handleToolCall('llui_mock_effect', {
      match: { type: 'http' },
      response: 'mocked-payload',
    })
    await server.handleToolCall('llui_send_message', { msg: { type: 'fetch' } })
    // Wait a microtask for effects to flush
    await new Promise((r) => setTimeout(r, 10))
    const state = (await server.handleToolCall('llui_get_state', {})) as S
    expect(state.data).toBe('mocked-payload')
  })
})
```

#### Task 22: `llui_resolve_effect`

**Debug-API method:**

```ts
resolveEffect(effectId: string, response: unknown): { resolved: boolean }

// Implementation — manually resolve a specific pending effect with a given response.
resolveEffect(effectId, response) {
  const pending = ci._pendingEffects?.findById(effectId)
  if (!pending) return { resolved: false }
  // The real implementation needs to synthesize the success message as if the
  // real effect resolved. This requires knowing the effect's onSuccess callback;
  // for http effects, payload.onSuccess(response) produces the message. Dispatch
  // that message through ci.send and remove from pending.
  const payload = pending.payload as { onSuccess?: (d: unknown) => unknown } | undefined
  if (payload?.onSuccess) {
    ci.send(payload.onSuccess(response) as never)
  }
  ci._pendingEffects?.remove(effectId)
  ci._effectTimeline?.push({
    effectId,
    type: pending.type,
    phase: 'resolved',
    timestamp: Date.now(),
    durationMs: Date.now() - pending.dispatchedAt,
  })
  return { resolved: true }
},
```

**MCP tool:**

```ts
registry.register(
  {
    name: 'llui_resolve_effect',
    description:
      "Manually resolve a pending effect with a given response. The effect's onSuccess callback (if any) runs as if it had actually resolved. Pass effectId from llui_pending_effects.",
    inputSchema: {
      type: 'object',
      properties: {
        effectId: { type: 'string' },
        response: {},
      },
      required: ['effectId', 'response'],
    },
  },
  'debug-api',
  async (args, ctx) => {
    if (!ctx.relay) throw new Error('Relay transport unavailable')
    return ctx.relay.call('resolveEffect', [args.effectId, args.response])
  },
)
```

**Unit test:** analogous to `llui_mock_effect`.

### Section E commit

- [ ] **Task E-commit: Commit effect tools**

```bash
git add packages/dom/src/devtools.ts packages/mcp/src/tools/debug-api.ts \
        packages/mcp/test/tools-effects.test.ts packages/mcp/test/jsdom-effects.test.ts

git commit -m "$(cat <<'EOF'
feat(mcp,dom): add effect tools (pending_effects, effect_timeline, mock_effect, resolve_effect)

Four new LluiDebugAPI methods built on the ring-buffer trackers and mock registry
introduced in the trackers commit. mock_effect registers predicate→response mocks
that short-circuit via the @llui/effects interceptor; resolve_effect manually
resolves a pending effect.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Section F — Time-travel + utility tools (5 tasks: #16–20)

#### Task 23: `llui_step_back`

**Debug-API method:**

```ts
stepBack(n: number, mode: 'pure' | 'live'): { state: unknown; rewindDepth: number }

// Implementation — replay from init with history minus last n
stepBack(n, mode) {
  const hist = history.slice(0, Math.max(0, history.length - n))
  // Re-initialize state from init()
  const [initialState] = ci.def.init(ci.state)  // pass undefined for init data
  let state = initialState
  const effects: unknown[] = []
  for (const record of hist) {
    const [newState, newEffects] = (
      ci.def.update as unknown as (s: unknown, m: unknown) => [unknown, unknown[]]
    )(state, record.msg)
    state = newState
    if (mode === 'live') effects.push(...newEffects)
  }
  _forceState(ci, state)
  if (mode === 'live') {
    for (const eff of effects) ci.send(eff as never)  // re-dispatch if user asked
  }
  history.length = Math.max(0, history.length - n)
  return { state, rewindDepth: n }
},
```

**Note to executor:** `init()` may take a `data` argument for initial state (persistent layouts use it). If the current `ci` has that data captured somewhere, pass it. Otherwise `undefined` is the conservative default.

**MCP tool:**

```ts
registry.register(
  {
    name: 'llui_step_back',
    description:
      "Rewind state by replaying from init() with the last N messages excluded. 'mode' is 'pure' (default; suppresses effects) or 'live' (re-fires effects from replay). Returns the new state and rewindDepth.",
    inputSchema: {
      type: 'object',
      properties: {
        n: { type: 'number' },
        mode: { type: 'string', enum: ['pure', 'live'] },
      },
    },
  },
  'debug-api',
  async (args, ctx) => {
    if (!ctx.relay) throw new Error('Relay transport unavailable')
    const n = typeof args.n === 'number' ? args.n : 1
    const mode = args.mode === 'live' ? 'live' : 'pure'
    return ctx.relay.call('stepBack', [n, mode])
  },
)
```

**Unit test:** analogous.

#### Task 24: `llui_coverage`

**Debug-API method:**

```ts
getCoverage(): CoverageSnapshot

// Implementation
getCoverage(): CoverageSnapshot {
  if (!ci._coverage) return { fired: {}, neverFired: [] }
  const schema = ci.def.__msgSchema
  const known = schema ? Object.keys(schema.variants) : undefined
  return ci._coverage.snapshot(known)
},
```

**MCP tool:**

```ts
registry.register(
  {
    name: 'llui_coverage',
    description:
      'Per-Msg-variant coverage for the current session: { fired: { variant: { count, lastIndex } }, neverFired: [variants] }. Shows which message types have run and which haven\'t — useful for finding untested paths.',
    inputSchema: { type: 'object', properties: {} },
  },
  'debug-api',
  async (_args, ctx) => {
    if (!ctx.relay) throw new Error('Relay transport unavailable')
    return ctx.relay.call('getCoverage', [])
  },
)
```

#### Task 25: `llui_diff_state`

**No new debug-API method — pure MCP-side `diffState` from `util/diff.ts` (already created in Task 10).**

**MCP tool:**

```ts
import { diffState } from '../util/diff.js'

registry.register(
  {
    name: 'llui_diff_state',
    description:
      "Structured JSON diff between two state values or snapshot ids. Pass 'a' and 'b' — either state objects directly, or strings referring to previously-snapshotted states (not implemented in Phase 1 — plain objects only).",
    inputSchema: {
      type: 'object',
      properties: {
        a: {},
        b: {},
      },
      required: ['a', 'b'],
    },
  },
  'debug-api',
  async (args) => {
    return diffState(args.a, args.b)
  },
)
```

**Unit test:**

```ts
describe('llui_diff_state', () => {
  it('returns added/removed/changed', async () => {
    const server = new LluiMcpServer()
    server.connectDirect(mkApi())  // no debug-api calls made
    const result = await server.handleToolCall('llui_diff_state', {
      a: { x: 1, y: 2 },
      b: { x: 1, y: 3, z: 4 },
    })
    expect(result).toEqual({
      added: { z: 4 },
      removed: {},
      changed: { y: { from: 2, to: 3 } },
    })
  })
})
```

#### Task 26: `llui_assert`

**No new debug-API method — composes existing `searchState`.**

**MCP tool:**

```ts
registry.register(
  {
    name: 'llui_assert',
    description:
      "Evaluate a predicate against current state. Pass 'path' (dot-separated), 'op' (eq/neq/exists/gt/lt/in), and 'value'. Returns { pass, actual, expected, op }.",
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        op: { type: 'string', enum: ['eq', 'neq', 'exists', 'gt', 'lt', 'in'] },
        value: {},
      },
      required: ['path', 'op'],
    },
  },
  'debug-api',
  async (args, ctx) => {
    if (!ctx.relay) throw new Error('Relay transport unavailable')
    const actual = await ctx.relay.call('searchState', [args.path])
    const op = args.op as string
    const expected = args.value
    let pass = false
    switch (op) {
      case 'eq':
        pass = Object.is(actual, expected)
        break
      case 'neq':
        pass = !Object.is(actual, expected)
        break
      case 'exists':
        pass = actual !== undefined
        break
      case 'gt':
        pass = typeof actual === 'number' && typeof expected === 'number' && actual > expected
        break
      case 'lt':
        pass = typeof actual === 'number' && typeof expected === 'number' && actual < expected
        break
      case 'in':
        pass = Array.isArray(expected) && expected.includes(actual)
        break
    }
    return { pass, actual, expected, op }
  },
)
```

**Unit test:**

```ts
describe('llui_assert', () => {
  it('eq passes when matching', async () => {
    const api = mkApi({ searchState: vi.fn(() => 42) })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = (await server.handleToolCall('llui_assert', {
      path: 'n',
      op: 'eq',
      value: 42,
    })) as { pass: boolean }
    expect(result.pass).toBe(true)
  })

  it('gt fails on smaller actual', async () => {
    const api = mkApi({ searchState: vi.fn(() => 1) })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = (await server.handleToolCall('llui_assert', {
      path: 'n',
      op: 'gt',
      value: 5,
    })) as { pass: boolean; actual: unknown }
    expect(result.pass).toBe(false)
    expect(result.actual).toBe(1)
  })
})
```

#### Task 27: `llui_search_history`

**No new debug-API method — MCP-side filter over `getMessageHistory`.**

**MCP tool:**

```ts
registry.register(
  {
    name: 'llui_search_history',
    description:
      "Filtered message history. Pass 'filter' with { type?, statePath?, effectType?, fromIndex?, toIndex? }. Entries match if all present fields match — type is the Msg discriminant, statePath is a dot path whose value differs pre→post, effectType is a type present in the effects array.",
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            statePath: { type: 'string' },
            effectType: { type: 'string' },
            fromIndex: { type: 'number' },
            toIndex: { type: 'number' },
          },
        },
      },
      required: ['filter'],
    },
  },
  'debug-api',
  async (args, ctx) => {
    if (!ctx.relay) throw new Error('Relay transport unavailable')
    type Record = {
      index: number
      timestamp: number
      msg: unknown
      stateBefore: unknown
      stateAfter: unknown
      effects: unknown[]
      dirtyMask: number
    }
    const history = (await ctx.relay.call('getMessageHistory', [{}])) as Record[]
    const f = (args.filter ?? {}) as {
      type?: string
      statePath?: string
      effectType?: string
      fromIndex?: number
      toIndex?: number
    }
    function pathValue(obj: unknown, path: string): unknown {
      const parts = path.split('.')
      let v: unknown = obj
      for (const p of parts) {
        if (v == null || typeof v !== 'object') return undefined
        v = (v as globalThis.Record<string, unknown>)[p]
      }
      return v
    }
    return history.filter((r) => {
      if (f.fromIndex !== undefined && r.index < f.fromIndex) return false
      if (f.toIndex !== undefined && r.index > f.toIndex) return false
      if (f.type !== undefined) {
        const t = (r.msg as { type?: string })?.type
        if (t !== f.type) return false
      }
      if (f.statePath !== undefined) {
        const before = pathValue(r.stateBefore, f.statePath)
        const after = pathValue(r.stateAfter, f.statePath)
        if (Object.is(before, after)) return false
      }
      if (f.effectType !== undefined) {
        if (!r.effects.some((e) => (e as { type?: string })?.type === f.effectType)) return false
      }
      return true
    })
  },
)
```

**Unit test:**

```ts
describe('llui_search_history', () => {
  it('filters by msg.type', async () => {
    const hist = [
      { index: 0, timestamp: 1, msg: { type: 'A' }, stateBefore: {}, stateAfter: {}, effects: [], dirtyMask: 0 },
      { index: 1, timestamp: 2, msg: { type: 'B' }, stateBefore: {}, stateAfter: {}, effects: [], dirtyMask: 0 },
      { index: 2, timestamp: 3, msg: { type: 'A' }, stateBefore: {}, stateAfter: {}, effects: [], dirtyMask: 0 },
    ]
    const api = mkApi({ getMessageHistory: vi.fn(() => hist) })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = (await server.handleToolCall('llui_search_history', {
      filter: { type: 'A' },
    })) as Array<{ index: number }>
    expect(result.map((r) => r.index)).toEqual([0, 2])
  })
})
```

### Section F commit

- [ ] **Task F-commit: Commit time-travel + utility tools**

```bash
git add packages/dom/src/devtools.ts packages/mcp/src/tools/debug-api.ts \
        packages/mcp/src/util/diff.ts packages/mcp/test/tools-time-travel.test.ts

git commit -m "$(cat <<'EOF'
feat(mcp,dom): add time-travel + utility tools (step_back, coverage, diff_state, assert, search_history)

Two new LluiDebugAPI methods (stepBack, getCoverage); three pure MCP-side tools
(diff_state, assert, search_history) compose existing debug-API capabilities.
step_back defaults to 'pure' mode to avoid double-firing effects.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Section G — Eval tool (1 task)

#### Task 28: `llui_eval`

**Why:** Arbitrary JS in page context via the relay, wrapped in an observability envelope that surfaces side effects (state diff, new history entries, new pending effects, dirty bindings). Uses `new Function(code)()` inside the page, not `eval`, to respect strict mode.

**Debug-API method:**

```ts
evalInPage(code: string): {
  result: unknown | { error: string }
  sideEffects: {
    stateChanged: StateDiff | null
    newHistoryEntries: number
    newPendingEffects: PendingEffect[]
    dirtyBindingIndices: number[]
  }
}

// Implementation
evalInPage(code) {
  // Snapshot pre-state
  const stateBefore = JSON.parse(JSON.stringify(ci.state))
  const historyLenBefore = history.length
  const pendingBefore = new Set((ci._pendingEffects?.list() ?? []).map((p) => p.id))
  const dirtyMaskBefore = lastDirtyMask

  let result: unknown | { error: string }
  try {
    // Run in page context; code returns the expression value
    // The function body may reference globalThis, __lluiDebug, document, window, etc.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(`return (async () => { ${code} })()`) as () => Promise<unknown>
    // We can't await here synchronously; resolve in two phases if the code is async
    result = fn()
    if (result && typeof result === 'object' && 'then' in result) {
      // Synchronous path — return a marker and let the relay layer await
      // For simplicity in Phase 1, reject async code with a clear error.
      result = {
        error:
          'llui_eval does not support async expressions in Phase 1. Wrap awaits in an IIFE and expose the result synchronously via globalThis.',
      }
    }
  } catch (err) {
    result = { error: err instanceof Error ? err.message : String(err) }
  }

  // Flush any queued messages so side effects settle
  try {
    flushInstance(ci)
  } catch {
    // Keep going — the user's eval may have put state into an odd shape
  }

  const stateAfter = ci.state
  const stateDiff = diffStateInternal(stateBefore, stateAfter)
  const newHistoryEntries = history.length - historyLenBefore
  const pendingNow = ci._pendingEffects?.list() ?? []
  const newPendingEffects = pendingNow.filter((p) => !pendingBefore.has(p.id))
  const dirtyBindingIndices: number[] = []
  const maskDiff = lastDirtyMask ^ dirtyMaskBefore
  for (let i = 0; i < ci.allBindings.length; i++) {
    const b = ci.allBindings[i]!
    if ((b.mask & maskDiff) !== 0) dirtyBindingIndices.push(i)
  }

  return {
    result,
    sideEffects: {
      stateChanged: stateDiff.changed.length === 0 && Object.keys(stateDiff.added).length === 0 && Object.keys(stateDiff.removed).length === 0 ? null : stateDiff,
      newHistoryEntries,
      newPendingEffects,
      dirtyBindingIndices,
    },
  }
},

// Helper — local-scope diff to avoid circular import with ../src/util/diff.ts in @llui/mcp.
function diffStateInternal(a: unknown, b: unknown): StateDiff {
  // Mirror of diffState in packages/mcp/src/util/diff.ts; duplicated here because
  // this runs in the browser page context via the relay, not in @llui/mcp.
  const out: StateDiff = { added: {}, removed: {}, changed: {} }
  // ... (same algorithm as util/diff.ts diffState) ...
  return out
}
```

**Type addition in `packages/dom/src/devtools.ts`:**

```ts
export interface StateDiff {
  added: Record<string, unknown>
  removed: Record<string, unknown>
  changed: Record<string, { from: unknown; to: unknown }>
}
```

**MCP tool:**

```ts
registry.register(
  {
    name: 'llui_eval',
    description:
      "Arbitrary JavaScript in the page context via the debug relay. Returns { result, sideEffects }. 'result' is the expression's return value or { error }. 'sideEffects' makes any state changes, new history entries, new pending effects, and dirty bindings visible. Phase 1 does not support async expressions; expose async results via globalThis instead.",
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string' } },
      required: ['code'],
    },
  },
  'debug-api',
  async (args, ctx) => {
    if (!ctx.relay) throw new Error('Relay transport unavailable')
    return ctx.relay.call('evalInPage', [args.code])
  },
)
```

**Unit test:**

Create `packages/mcp/test/tools-eval.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { LluiMcpServer } from '../src/index'
import type { LluiDebugAPI } from '@llui/dom'

function mkApi(overrides: Partial<LluiDebugAPI> = {}): LluiDebugAPI {
  // ... (same shape as earlier) ...
  return {} as unknown as LluiDebugAPI
}

describe('llui_eval', () => {
  it('returns result and empty sideEffects for pure expressions', async () => {
    const api = mkApi({
      evalInPage: vi.fn(() => ({
        result: 42,
        sideEffects: {
          stateChanged: null,
          newHistoryEntries: 0,
          newPendingEffects: [],
          dirtyBindingIndices: [],
        },
      })),
    })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = (await server.handleToolCall('llui_eval', {
      code: '1 + 1 * 42 - 41',
    })) as { result: number; sideEffects: { newHistoryEntries: number } }
    expect(result.result).toBe(42)
    expect(result.sideEffects.newHistoryEntries).toBe(0)
  })

  it('surfaces state changes in sideEffects', async () => {
    const api = mkApi({
      evalInPage: vi.fn(() => ({
        result: undefined,
        sideEffects: {
          stateChanged: { added: {}, removed: {}, changed: { n: { from: 0, to: 5 } } },
          newHistoryEntries: 1,
          newPendingEffects: [],
          dirtyBindingIndices: [0, 1],
        },
      })),
    })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = (await server.handleToolCall('llui_eval', {
      code: 'window.__lluiDebug.send({ type: "set", n: 5 })',
    })) as { sideEffects: { stateChanged: { changed: Record<string, unknown> }; dirtyBindingIndices: number[] } }
    expect(result.sideEffects.stateChanged?.changed.n).toEqual({ from: 0, to: 5 })
    expect(result.sideEffects.dirtyBindingIndices).toEqual([0, 1])
  })

  it('returns { error } on thrown exception', async () => {
    const api = mkApi({
      evalInPage: vi.fn(() => ({
        result: { error: 'ReferenceError: foo is not defined' },
        sideEffects: {
          stateChanged: null,
          newHistoryEntries: 0,
          newPendingEffects: [],
          dirtyBindingIndices: [],
        },
      })),
    })
    const server = new LluiMcpServer()
    server.connectDirect(api)
    const result = (await server.handleToolCall('llui_eval', { code: 'foo.bar' })) as {
      result: { error: string }
    }
    expect(result.result).toEqual({ error: 'ReferenceError: foo is not defined' })
  })
})
```

Run:

```bash
pnpm --filter @llui/mcp test -- tools-eval.test.ts
```

Expected: 3 tests pass.

### Section G commit

- [ ] **Task G-commit: Commit eval tool**

```bash
git add packages/dom/src/devtools.ts packages/mcp/src/tools/debug-api.ts \
        packages/mcp/test/tools-eval.test.ts

git commit -m "$(cat <<'EOF'
feat(mcp,dom): add llui_eval — arbitrary JS in page context with observability envelope

New evalInPage() LluiDebugAPI method. Runs user-provided code via new Function() in
the page, then surfaces all side effects: state diff (pre vs post), new history
entries, new pending effects, dirty binding indices. Synchronous-only in Phase 1
(async returns an error with guidance).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Section H — Docs + verification gate

#### Task 29: Update documentation

**Files:**
- Modify: `packages/mcp/README.md`
- Modify: `docs/designs/07 LLM Friendliness.md`
- Modify: `docs/designs/09 API Reference.md`
- Modify: `CLAUDE.md`
- Modify: `packages/mcp/CHANGELOG.md`
- Modify: `packages/dom/CHANGELOG.md`
- Modify: `packages/effects/CHANGELOG.md`

- [ ] **Step 1: Update `packages/mcp/README.md` tool tables**

Add rows for all 21 new tools. Example addition for the "View and DOM" section:

```markdown
### View and DOM

| Tool                | Description                                                                 |
| ------------------- | --------------------------------------------------------------------------- |
| `inspect_element`   | Rich report: tag, attrs, classes, data-*, text, computed, box, bindings     |
| `get_rendered_html` | outerHTML of a selector (default = mount root), truncatable                 |
| `dom_diff`          | Structural diff expected vs actual HTML                                     |
| `dispatch_event`    | Synthesize a browser event; returns Msgs produced + resulting state         |
| `get_focus`         | Active element info: selector, tag, selection range                         |

### Bindings and Scope

| Tool                  | Description                                                           |
| --------------------- | --------------------------------------------------------------------- |
| `force_rerender`      | Re-evaluate all bindings with FULL_MASK; returns changed indices      |
| `each_diff`           | Per-each-site add/remove/move/reuse per update                         |
| `scope_tree`          | Scope hierarchy with kind + active state                               |
| `disposer_log`        | Recent onDispose events with scope id + cause                          |
| `list_dead_bindings`  | Bindings that are dead or never changed                               |
| `binding_graph`       | state path → bindingIndex[] edge list                                  |

### Effects

| Tool                | Description                                                              |
| ------------------- | ------------------------------------------------------------------------ |
| `pending_effects`   | Queued and in-flight effects                                             |
| `effect_timeline`   | Phased log: dispatched → in-flight → resolved/cancelled                   |
| `mock_effect`       | Register match→response mock; next matching effect resolves with mock    |
| `resolve_effect`    | Manually resolve a specific pending effect                               |

### Time Travel and Utilities

| Tool             | Description                                                     |
| ---------------- | --------------------------------------------------------------- |
| `step_back`      | Rewind N messages by replaying from init (pure mode default)    |
| `coverage`       | Per-Msg variant counts + list of never-fired variants           |
| `diff_state`     | Structured JSON diff between two state values                   |
| `assert`         | Evaluate eq/neq/exists/gt/lt/in against a state path            |
| `search_history` | Filter history by type, statePath change, effectType, or range  |

### Eval

| Tool         | Description                                                                    |
| ------------ | ------------------------------------------------------------------------------ |
| `eval`       | Arbitrary JS in page context; returns result + observability envelope          |
```

- [ ] **Step 2: Update `docs/designs/07 LLM Friendliness.md` §10**

Add the 21 new tools to the MCP catalog there with one-line descriptions.

- [ ] **Step 3: Update `docs/designs/09 API Reference.md`**

Add new `LluiDebugAPI` method signatures under the existing devtools section, plus the new types (`ElementReport`, `ScopeNode`, `EachDiff`, `DisposerEvent`, `PendingEffect`, `EffectTimelineEntry`, `EffectMatch`, `StateDiff`, `CoverageSnapshot`). Also document `_setEffectInterceptor` from `@llui/effects`.

- [ ] **Step 4: Update `CLAUDE.md`**

Add `@llui/mcp` row to the package table if missing:

```markdown
| `@llui/mcp`         | MCP server exposing LLui debug API + lint to LLMs                                       | @llui/dom, @llui/lint-idiomatic |
```

- [ ] **Step 5: Add changelog entries**

In `packages/mcp/CHANGELOG.md`:

```markdown
## [Unreleased]
### Added
- 21 new MCP tools (Phase 1): inspect_element, get_rendered_html, dom_diff, dispatch_event, get_focus, force_rerender, each_diff, scope_tree, disposer_log, list_dead_bindings, binding_graph, pending_effects, effect_timeline, mock_effect, resolve_effect, step_back, coverage, diff_state, assert, search_history, eval.
- Tool registry with layer-tag routing (debug-api, cdp, source, compiler).
- Marker file now includes optional devUrl field (consumed by Phase 2 CDP transport).
```

Analogous entries in `packages/dom/CHANGELOG.md` (new LluiDebugAPI methods; runtime trackers; `_forceFullRerender`) and `packages/effects/CHANGELOG.md` (`_setEffectInterceptor` hook).

#### Task 30: Phase 1 verification gate

- [ ] **Step 1: Type check**

```bash
pnpm turbo check
```

Expected: no errors.

- [ ] **Step 2: Lint**

```bash
pnpm turbo lint
```

Expected: no errors.

- [ ] **Step 3: Tests**

```bash
pnpm turbo test
```

Expected: all tests pass, including 21 new unit tests (~40 cases) and jsdom e2e additions.

- [ ] **Step 4: E2E**

```bash
pnpm --filter @llui/mcp test:e2e
```

Expected: existing Playwright suite passes; no Phase 1 changes should have broken it.

- [ ] **Step 5: Format**

```bash
pnpm format:check
```

Expected: clean. If not, run `pnpm format` and amend the last commit.

- [ ] **Step 6: Final docs commit**

```bash
git add packages/mcp/README.md docs/designs/07\ LLM\ Friendliness.md \
        docs/designs/09\ API\ Reference.md CLAUDE.md \
        packages/mcp/CHANGELOG.md packages/dom/CHANGELOG.md \
        packages/effects/CHANGELOG.md

git commit -m "$(cat <<'EOF'
docs: document Phase 1 MCP tools (21 new), new LluiDebugAPI methods, effect interceptor

Updates packages/mcp/README.md with all 21 new tool rows; extends the MCP catalog in
07 LLM Friendliness.md §10; adds new LluiDebugAPI method signatures + type glossary
to 09 API Reference.md; adds @llui/mcp row to CLAUDE.md; changelog entries per
affected package.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Confirm with user before running.

- [ ] **Step 7: Phase 1 done**

Announce completion to the user. Phase 1 delivers:
- 21 new MCP tools via debug-api transport.
- 4 dev-mode runtime trackers in @llui/dom (each-diff, disposer log, effect timeline, coverage).
- Effect interceptor hook in @llui/effects (zero-cost in production).
- Tool registry refactor; index.ts decomposed.
- Marker file extension (devUrl field) prepared for Phase 2.

Phase 2–5 plans are separate files — read the index for execution guidance.
