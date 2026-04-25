import { flushInstance, _forceState, type ComponentInstance } from './update-loop.js'
import { _setDevToolsInstall } from './mount.js'
import { _markDisposerLogInstalled } from './lifetime.js'
import type { Binding, Lifetime, LifetimeNode } from './types.js'
import { applyBinding } from './binding.js'
import { createRingBuffer, type EachDiff } from './tracking/each-diff.js'
import {
  createRingBuffer as createDisposerBuffer,
  type DisposerEvent,
} from './tracking/disposer-log.js'
import { createCoverageTracker, type CoverageSnapshot } from './tracking/coverage.js'
import {
  createRingBuffer as createTimelineBuffer,
  createMockRegistry,
  createPendingEffectsList,
  type PendingEffect,
  type EffectTimelineEntry,
  type EffectMatch,
} from './tracking/effect-timeline.js'

export interface StateDiff {
  added: Record<string, unknown>
  removed: Record<string, unknown>
  changed: Record<string, { from: unknown; to: unknown }>
}

function diffStateInternal(a: unknown, b: unknown): StateDiff {
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

/**
 * Enable devtools auto-installation for every mountApp call. Called by
 * compiler-generated dev code — never imported in production builds.
 * Once enabled, every mounted component attaches `globalThis.__lluiDebug`
 * to the most recently mounted instance.
 */
export function enableDevTools(): void {
  _setDevToolsInstall(installDevTools)
}

// ── MCP WebSocket Relay ─────────────────────────────────────────────
// Forwards method calls from an out-of-process MCP server to the
// current __lluiDebug API. Dev-mode only — compiler injects startRelay(port).
//
// On-demand: tries a SINGLE connection on page load. If it succeeds
// (MCP server is already running), the relay stays open and reconnects
// on drop. If it fails, no retry loop — just registers
// `window.__lluiConnect(port?)` so the developer can connect later
// from the console or when the MCP server starts.

let relayPort = 5200
let relayConnected = false

interface RelayRequest {
  id: string
  method: keyof LluiDebugAPI | '__listComponents' | '__selectComponent'
  args: unknown[]
}

function handleMessage(ws: WebSocket, event: MessageEvent): void {
  let req: RelayRequest
  try {
    req = JSON.parse(String(event.data)) as RelayRequest
  } catch {
    return
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any
  if (req.method === '__listComponents') {
    const keys = g.__lluiComponents ? Object.keys(g.__lluiComponents) : []
    const active =
      g.__lluiDebug && g.__lluiComponents
        ? (Object.entries(g.__lluiComponents).find(([, v]) => v === g.__lluiDebug)?.[0] ?? null)
        : null
    ws.send(JSON.stringify({ id: req.id, result: { components: keys, active } }))
    return
  }
  if (req.method === '__selectComponent') {
    const key = (req.args?.[0] as string | undefined) ?? ''
    const entry = g.__lluiComponents?.[key]
    if (!entry) {
      ws.send(JSON.stringify({ id: req.id, error: `unknown component: ${key}` }))
      return
    }
    g.__lluiDebug = entry
    ws.send(JSON.stringify({ id: req.id, result: { active: key } }))
    return
  }

  const api = g.__lluiDebug as LluiDebugAPI | undefined
  if (!api) {
    ws.send(JSON.stringify({ id: req.id, error: '__lluiDebug not available' }))
    return
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = (api as any)[req.method]
  if (typeof fn !== 'function') {
    ws.send(JSON.stringify({ id: req.id, error: `unknown method: ${req.method}` }))
    return
  }
  try {
    const result = fn.apply(api, req.args ?? [])
    ws.send(JSON.stringify({ id: req.id, result: result ?? null }))
  } catch (e) {
    ws.send(JSON.stringify({ id: req.id, error: e instanceof Error ? e.message : String(e) }))
  }
}

function connectRelay(port: number, isInitial: boolean): void {
  if (typeof WebSocket === 'undefined') return

  let ws: WebSocket
  try {
    ws = new WebSocket(`ws://127.0.0.1:${port}`)
  } catch {
    if (!isInitial) console.warn(`[LLui MCP] failed to connect to ws://127.0.0.1:${port}`)
    return
  }

  ws.onopen = () => {
    relayConnected = true
    console.log(`[LLui MCP] connected to ws://127.0.0.1:${port}`)
  }
  ws.onmessage = (event) => handleMessage(ws, event)
  ws.onclose = () => {
    if (relayConnected) {
      relayConnected = false
      console.log('[LLui MCP] disconnected — call __lluiConnect() to reconnect')
    }
  }
  ws.onerror = () => {
    // onclose fires after onerror — nothing to do here
  }
}

/**
 * Register the MCP relay for this page.
 *
 * Discovery happens in two phases:
 *
 * 1. **Status endpoint** (preferred): fetches `/__llui_mcp_status`,
 *    which the Vite plugin serves from the active marker file written
 *    by `@llui/mcp`. If the MCP server is running, the response gives
 *    us the actual port — we connect immediately. This avoids the race
 *    where HMR events fire before the listener registers, and handles
 *    cases where MCP runs on a non-default port. When the canonical
 *    path is shadowed (e.g. `@cloudflare/vite-plugin` routes every
 *    HTTP request to the worker), the client falls back to
 *    `/cdn-cgi/llui_mcp_status` which the Vite plugin also registers
 *    — Cloudflare lets `/cdn-cgi/*` paths through to the dev server.
 * 2. **Compile-time fallback**: if both endpoints are unavailable
 *    (network error, non-Vite environment), we attempt a single
 *    connection to the compiled-in `port` parameter as a best-effort.
 *
 * Either way: no retry loop. If both fail, `window.__lluiConnect(port?)`
 * is exposed so the developer can connect manually from the console
 * when the MCP server starts. The Vite plugin also dispatches an
 * `llui:mcp-ready` HMR custom event when the marker file appears later,
 * which the compiler-injected dev code forwards to `__lluiConnect`.
 */
export function startRelay(port = 5200): void {
  relayPort = port
  if (typeof WebSocket === 'undefined') return

  // Expose manual connect for on-demand use
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any
  g.__lluiConnect = (p?: number) => {
    connectRelay(p ?? relayPort, false)
  }

  if (typeof fetch !== 'undefined') {
    void resolveMcpStatus().then((result) => {
      if (result.kind === 'found') {
        relayPort = result.port
        connectRelay(result.port, true)
      } else if (result.kind === 'network-error') {
        // No Vite server reachable (e.g., production build, test
        // harness without a server). Fall back to the compile-time
        // port; the WS connect will either succeed or quietly fail.
        connectRelay(port, true)
      }
      // result.kind === 'not-running' → both endpoints 404'd. MCP isn't
      // active. Don't fall back to the compile-time port; the HMR
      // `llui:mcp-ready` event fires if MCP starts later, and manual
      // `window.__lluiConnect()` is the escape hatch.
    })
  } else {
    // No fetch available — use the compile-time port directly
    connectRelay(port, true)
  }
}

type McpStatusResult =
  | { kind: 'found'; port: number }
  | { kind: 'not-running' } // every path responded but with non-200/no port
  | { kind: 'network-error' } // every path threw — no server reachable

/**
 * Try the canonical Vite middleware path; if it 404s (Cloudflare
 * plugin's catch-all routes everything to the worker), fall back to
 * `/cdn-cgi/llui_mcp_status` which the Vite plugin also registers.
 *
 * Distinguishes "MCP not running" (404 from a real Vite server) from
 * "no Vite server" (fetch threw). Callers handle these differently —
 * the former should NOT fall back to the compile-time port (avoids
 * spurious WS connection attempts), the latter SHOULD.
 */
async function resolveMcpStatus(): Promise<McpStatusResult> {
  let allThrew = true
  for (const path of ['/__llui_mcp_status', '/cdn-cgi/llui_mcp_status']) {
    try {
      const res = await fetch(path)
      // We got a response — even a 404 means a server is live; don't
      // treat this as a network error.
      allThrew = false
      if (!res.ok) continue
      const data = (await res.json()) as { port?: unknown }
      if (typeof data.port === 'number') return { kind: 'found', port: data.port }
    } catch {
      // Network error on this path — try the next.
    }
  }
  return allThrew ? { kind: 'network-error' } : { kind: 'not-running' }
}

export interface MessageRecord {
  index: number
  timestamp: number
  msg: unknown
  stateBefore: unknown
  stateAfter: unknown
  effects: unknown[]
  dirtyMask: number
}

export interface BindingDebugInfo {
  index: number
  mask: number
  lastValue: unknown
  kind: string
  key: string | undefined
  dead: boolean
  perItem: boolean
}

export interface UpdateExplanation {
  bindingIndex: number
  bindingMask: number
  lastDirtyMask: number
  matched: boolean
  accessorResult: unknown
  lastValue: unknown
  changed: boolean
}

export interface ValidationError {
  path: string
  expected: string
  received: string
  message: string
}

export interface LluiDebugAPI {
  getState(): unknown
  send(msg: unknown): void
  flush(): void
  getMessageHistory(opts?: { since?: number; limit?: number }): MessageRecord[]
  evalUpdate(msg: unknown): { state: unknown; effects: unknown[] }
  exportTrace(): {
    lluiTrace: 1
    component: string
    generatedBy: string
    timestamp: string
    entries: Array<{ msg: unknown; expectedState: unknown; expectedEffects: unknown[] }>
  }
  clearLog(): void
  validateMessage(msg: unknown): ValidationError[] | null
  getBindings(): BindingDebugInfo[]
  whyDidUpdate(bindingIndex: number): UpdateExplanation
  searchState(query: string): unknown
  /** Returns the compiled Msg schema (discriminant + variant field types). */
  getMessageSchema(): MessageSchemaInfo | null
  /** Returns the bit→field map injected by the compiler. Lets tools decode dirty-mask values. */
  getMaskLegend(): Record<string, number> | null
  /** Given a dirty mask, return the list of top-level fields it represents. */
  decodeMask(mask: number): string[]
  /** Component name + source location (file/line from compiler-injected metadata). */
  getComponentInfo(): ComponentInfo
  /** Returns the compiled State type shape (from TypeScript `type State = { … }`). */
  getStateSchema(): object | null
  /** Returns the compiled Effect schema (from TypeScript `type Effect = { … }` union). */
  getEffectSchema(): object | null
  /** Deep-clone the current state. Pair with restoreState() to checkpoint before risky operations. */
  snapshotState(): unknown
  /** Overwrite the current state with a previously-captured snapshot. Triggers a full re-render. */
  restoreState(snap: unknown): void
  /** Find all bindings whose target node matches or is a child of the selector. */
  getBindingsFor(selector: string): BindingLocation[]
  /** Return a rich structural + style + binding report for the first element matching selector. Returns null if no element matches or document is unavailable. */
  inspectElement(selector: string): ElementReport | null
  /** Get the outerHTML of the mounted component or a specific element. Pass a selector for a specific node (defaults to the mount root). Pass maxLength to truncate output. */
  getRenderedHtml(selector?: string, maxLength?: number): string
  /** Synthesize and dispatch a browser event at a DOM element matched by selector. Returns dispatched status, the history indices of any Msgs the handler produced, and the resulting state. */
  dispatchDomEvent(
    selector: string,
    type: string,
    init?: EventInit,
  ): {
    dispatched: boolean
    messagesProducedIndices: number[]
    resultingState: unknown | null
  }
  /** Return info about the currently focused element: { selector (if it has an id), tagName, selectionStart, selectionEnd }. Useful for catching "focus lost on re-render" bugs. */
  getFocus(): {
    selector: string | null
    tagName: string | null
    selectionStart: number | null
    selectionEnd: number | null
  }
  /** Re-evaluate every binding's accessor against the current state, apply values that changed to the DOM, and return indices of bindings that changed. */
  forceRerender(): { changedBindings: number[] }
  /** Per-each-site reconciliation diffs (added/removed/moved/reused keys) from the dev-time diff log. Pass sinceIndex to filter to entries after a specific message history index. */
  getEachDiff(sinceIndex?: number): EachDiff[]
  /** Walk the component's scope tree and return a nested LifetimeNode with kind classification. Pass depth to limit traversal depth, scopeId to start from a specific scope. */
  getScopeTree(opts?: { depth?: number; scopeId?: string }): LifetimeNode
  /** Recent onDispose firings with scope id and cause. Pass 'limit' to cap results to the N most recent entries. Catches 'leak on branch swap' class bugs. */
  getDisposerLog(limit?: number): DisposerEvent[]
  /** Edge list: state path → binding indices that depend on it. Inverts the compiler-emitted mask legend to show, for each top-level state field, which bindings will re-evaluate when it changes. */
  getBindingGraph(): Array<{ statePath: string; bindingIndices: number[] }>
  /** Current queued and in-flight effects. Each entry has { id, type, dispatchedAt, status, payload }. Use 'id' with llui_resolve_effect to manually resolve one. */
  getPendingEffects(): PendingEffect[]
  /** Phased log of effect events: dispatched -> in-flight -> resolved/cancelled/resolved-mocked. Each entry has { effectId, type, phase, timestamp, durationMs? }. Pass 'limit' to cap the tail. */
  getEffectTimeline(limit?: number): EffectTimelineEntry[]
  /** Register a mock for an effect matching 'match'. The next matching effect resolves with 'response' instead of running. Mocks are one-shot by default; pass { persist: true } to keep across matches. Returns { mockId } for later reference. */
  mockEffect(
    match: EffectMatch,
    response: unknown,
    opts?: { persist?: boolean },
  ): { mockId: string }
  /** Manually resolve a pending effect with a given response. The effect's onSuccess callback (if any) runs as if it had actually resolved. Pass effectId from llui_pending_effects. */
  resolveEffect(effectId: string, response: unknown): { resolved: boolean }
  /** Rewind state by replaying from init() with the last N messages excluded. mode='pure' suppresses effects; mode='live' re-fires them. Returns the new state and rewind depth. */
  stepBack(n: number, mode: 'pure' | 'live'): { state: unknown; rewindDepth: number }
  /** Per-Msg-variant coverage for the current session. Shows which message types have run and which haven't. */
  getCoverage(): CoverageSnapshot
  /** Run arbitrary JS in page context and return { result, sideEffects }. result is the expression's return value or { error }. sideEffects captures state diff, new history entries, new pending effects, and dirty binding indices. Phase 1 does not support async expressions. */
  evalInPage(code: string): {
    result: unknown | { error: string }
    sideEffects: {
      stateChanged: StateDiff | null
      newHistoryEntries: number
      newPendingEffects: PendingEffect[]
      dirtyBindingIndices: number[]
    }
  }
  /** Returns the pre- and post-transform source of the view function injected by the compiler. Pass an optional viewFn name to select a specific view (currently unused — returns the component's view). Returns null if no source was injected. */
  getCompiledSource(_viewFn?: string): { pre: string; post: string } | null
  /** Returns the per-Msg-variant → dirty-mask map injected by the compiler. Lets tools explain which state fields a given message type will dirty. Returns null if not injected. */
  getMsgMaskMap(): Record<string, number> | null
  /** Returns the source location (file, line, column) for the binding at the given index, as recorded by the compiler. Returns null if the index is out of range or no source map was injected. */
  getBindingSource(bindingIndex: number): { file: string; line: number; column: number } | null
  /** Compare server-rendered HTML (stored in data-llui-ssr-html on the mount root) against the current client DOM. Returns an array of divergences — empty when hydration is clean. */
  getHydrationReport(): HydrationDivergence[]
}

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

export interface BindingLocation {
  bindingIndex: number
  kind: string
  key: string | undefined
  mask: number
  lastValue: unknown
  /** How the binding's node relates to the matched element: 'self' (binding on the element itself) or 'text-child' (text node inside). */
  relation: 'self' | 'text-child' | 'comment-child'
}

export interface ComponentInfo {
  name: string
  file: string | null
  line: number | null
}

export interface MessageSchemaInfo {
  discriminant: string
  variants: Record<string, Record<string, unknown>>
}

export interface HydrationDivergence {
  path: string
  kind: 'attribute' | 'text' | 'structural'
  server: unknown
  client: unknown
}

function diffNodes(
  client: Element,
  server: Element,
  path: string,
  out: HydrationDivergence[],
): void {
  const clientAttrs = new Map(Array.from(client.attributes).map((a) => [a.name, a.value]))
  const serverAttrs = new Map(Array.from(server.attributes).map((a) => [a.name, a.value]))
  for (const [name, val] of serverAttrs) {
    if (clientAttrs.get(name) !== val) {
      out.push({
        path,
        kind: 'attribute',
        server: `${name}="${val}"`,
        client: `${name}="${clientAttrs.get(name) ?? ''}"`,
      })
    }
  }
  if (client.children.length === 0 && server.children.length === 0) {
    if (client.textContent !== server.textContent) {
      out.push({ path, kind: 'text', server: server.textContent, client: client.textContent })
    }
    return
  }
  if (client.children.length !== server.children.length) {
    out.push({
      path,
      kind: 'structural',
      server: server.children.length,
      client: client.children.length,
    })
    return
  }
  for (let i = 0; i < client.children.length; i++) {
    const tag = client.children[i]!.tagName.toLowerCase()
    diffNodes(
      client.children[i] as Element,
      server.children[i] as Element,
      `${path} > ${tag}:nth-child(${i + 1})`,
      out,
    )
  }
}

const MAX_HISTORY = 1000

function findLifetimeById(root: Lifetime, id: string): Lifetime | null {
  const n = Number(id)
  if (root.id === n) return root
  for (const c of root.children) {
    const found = findLifetimeById(c, id)
    if (found) return found
  }
  return null
}

function walkLifetime(s: Lifetime, depth: number, maxDepth: number): LifetimeNode {
  const node: LifetimeNode = {
    scopeId: String(s.id),
    kind: s._kind ?? 'root',
    active: true,
    children: [],
  }
  if (depth < maxDepth) {
    for (const c of s.children) node.children.push(walkLifetime(c, depth + 1, maxDepth))
  }
  return node
}

export function installDevTools(inst: object): void {
  const ci = inst as ComponentInstance
  const history: MessageRecord[] = []
  let idx = 0
  let lastDirtyMask = 0

  // Tracker storage — populated by primitives when they detect dev-mode
  // is active (via `inst._eachDiffLog !== undefined` guard). Zero cost in
  // production where installDevTools never runs.
  ci._eachDiffLog = createRingBuffer(100)
  ci._updateCounter = 0
  // Disposer log — consumed by `llui_disposer_log` MCP tool. Stamped by
  // `disposeLifetime` via `findInstance(scope)` — which only works when the
  // rootLifetime carries an `instance` back-reference.
  ci._disposerLog = createDisposerBuffer(500)
  // Coverage tracker — consumed by `llui_coverage` MCP tool. Records the
  // discriminant of each dispatched message along with the message index
  // it fired at, allowing the tool to surface Msg variants that never
  // fired this session. Recorded inside the update interceptor below.
  ci._coverage = createCoverageTracker()
  // Effect timeline / pending / mocks — consumed by the
  // `llui_effect_timeline`, `llui_pending_effects`, `llui_mock_effect`,
  // and `llui_resolve_effect` MCP tools. Populated by the
  // `dispatchEffectDev` wrapper in `update-loop.ts`; zero cost in
  // production where `_effectTimeline` stays undefined.
  ci._effectTimeline = createTimelineBuffer(500)
  ci._effectMocks = createMockRegistry()
  ci._pendingEffects = createPendingEffectsList()
  ci.rootLifetime.instance = ci
  // Flip the scope-module flag so disposeLifetime starts walking the parent
  // chain to emit disposer events. Before the first installDevTools call
  // the flag stays false and disposeLifetime skips findInstance entirely.
  _markDisposerLogInstalled()

  const api: LluiDebugAPI = {
    getState: () => ci.state,
    send: (msg) => ci.send(msg as never),
    flush: () => flushInstance(ci),
    getMessageHistory: (opts) => {
      let result = history
      if (opts?.since !== undefined) {
        const since = opts.since
        result = result.filter((r) => r.index > since)
      }
      if (opts?.limit !== undefined && opts.limit > 0) {
        result = result.slice(-opts.limit)
      }
      return result.slice()
    },

    evalUpdate(msg) {
      const [state, effects] = ci.def.update(ci.state, msg as never)
      return { state, effects }
    },

    exportTrace() {
      return {
        lluiTrace: 1 as const,
        component: ci.def.name,
        generatedBy: 'devtools',
        timestamp: new Date().toISOString(),
        entries: history.map((h) => ({
          msg: h.msg,
          expectedState: h.stateAfter,
          expectedEffects: h.effects,
        })),
      }
    },

    clearLog() {
      history.length = 0
      idx = 0
      ci._updateCounter = 0
      ci._eachDiffLog?.clear()
      ci._disposerLog?.clear()
      ci._coverage?.clear()
      ci._effectTimeline?.clear()
      ci._effectMocks?.clear()
      // NB: `_pendingEffects` is intentionally NOT cleared — pending
      // entries represent in-flight effects that still have to land
      // resolution/cancellation phases. Dropping them here would leak
      // the ids that MCP tools hold onto for `llui_resolve_effect`.
    },

    validateMessage(msg: unknown): ValidationError[] | null {
      const schema = ci.def.__msgSchema as
        | { discriminant: string; variants: Record<string, Record<string, unknown>> }
        | undefined
      if (!schema) return null

      if (msg == null || typeof msg !== 'object') {
        return [
          {
            path: '',
            expected: 'object',
            received: typeof msg,
            message: 'Message must be an object',
          },
        ]
      }

      const msgObj = msg as Record<string, unknown>
      const discriminant = schema.discriminant
      const typeValue = msgObj[discriminant]

      if (typeValue === undefined) {
        return [
          {
            path: `.${discriminant}`,
            expected: `one of: ${Object.keys(schema.variants)
              .map((v) => `'${v}'`)
              .join(', ')}`,
            received: 'undefined',
            message: `Missing discriminant field '${discriminant}'`,
          },
        ]
      }

      if (typeof typeValue !== 'string') {
        return [
          {
            path: `.${discriminant}`,
            expected: 'string',
            received: typeof typeValue,
            message: `Discriminant field '${discriminant}' must be a string`,
          },
        ]
      }

      const variant = schema.variants[typeValue]
      if (!variant) {
        return [
          {
            path: `.${discriminant}`,
            expected: `one of: ${Object.keys(schema.variants)
              .map((v) => `'${v}'`)
              .join(', ')}`,
            received: `'${typeValue}'`,
            message: `Unknown message type '${typeValue}'`,
          },
        ]
      }

      // Validate fields of the matched variant
      const errors: ValidationError[] = []
      for (const [field, expectedType] of Object.entries(variant)) {
        if (field === discriminant) continue
        const value = msgObj[field]
        if (value === undefined) {
          errors.push({
            path: `.${field}`,
            expected: String(expectedType),
            received: 'undefined',
            message: `Missing required field '${field}'`,
          })
        } else if (typeof expectedType === 'string' && expectedType !== 'unknown') {
          if (typeof value !== expectedType) {
            errors.push({
              path: `.${field}`,
              expected: expectedType,
              received: typeof value,
              message: `Field '${field}' has wrong type`,
            })
          }
        }
      }

      return errors.length > 0 ? errors : null
    },

    getBindings(): BindingDebugInfo[] {
      const bindings: Binding[] = ci.allBindings ?? []
      return bindings.map((b, i) => ({
        index: i,
        mask: b.mask,
        lastValue: b.lastValue,
        kind: b.kind,
        key: b.key,
        dead: b.dead,
        perItem: b.perItem,
      }))
    },

    whyDidUpdate(bindingIndex: number): UpdateExplanation {
      const bindings: Binding[] = ci.allBindings ?? []
      const binding = bindings[bindingIndex]
      if (!binding) {
        return {
          bindingIndex,
          bindingMask: 0,
          lastDirtyMask: 0,
          matched: false,
          accessorResult: undefined,
          lastValue: undefined,
          changed: false,
        }
      }

      const matched = (binding.mask & lastDirtyMask) !== 0
      let accessorResult: unknown
      try {
        accessorResult = binding.accessor(ci.state)
      } catch {
        accessorResult = '<error>'
      }
      const changed = !Object.is(accessorResult, binding.lastValue)

      return {
        bindingIndex,
        bindingMask: binding.mask,
        lastDirtyMask,
        matched,
        accessorResult,
        lastValue: binding.lastValue,
        changed,
      }
    },

    searchState(query: string): unknown {
      const parts = query.split('.')
      let current: unknown = ci.state
      for (const part of parts) {
        if (current == null || typeof current !== 'object') return undefined
        current = (current as Record<string, unknown>)[part]
      }
      return current
    },

    getMessageSchema(): MessageSchemaInfo | null {
      return (ci.def.__msgSchema as MessageSchemaInfo | undefined) ?? null
    },

    getMaskLegend(): Record<string, number> | null {
      return ci.def.__maskLegend ?? null
    },

    decodeMask(mask: number): string[] {
      const legend = ci.def.__maskLegend
      if (!legend) return []
      const fields: string[] = []
      for (const [field, bit] of Object.entries(legend)) {
        if ((mask & bit) !== 0) fields.push(field)
      }
      return fields
    },

    getComponentInfo(): ComponentInfo {
      const meta = ci.def.__componentMeta
      return {
        name: ci.def.name,
        file: meta?.file ?? null,
        line: meta?.line ?? null,
      }
    },

    getStateSchema(): object | null {
      return (ci.def.__stateSchema as object | undefined) ?? null
    },

    getEffectSchema(): object | null {
      return (ci.def.__effectSchema as object | undefined) ?? null
    },

    snapshotState(): unknown {
      return JSON.parse(JSON.stringify(ci.state))
    },

    restoreState(snap: unknown): void {
      _forceState(ci, snap)
    },

    getBindingsFor(selector: string): BindingLocation[] {
      if (typeof document === 'undefined') return []
      const elements = Array.from(document.querySelectorAll(selector))
      if (elements.length === 0) return []
      const elementSet = new Set<Element>(elements)
      const results: BindingLocation[] = []
      for (let i = 0; i < ci.allBindings.length; i++) {
        const b = ci.allBindings[i]!
        if (b.dead) continue
        const node = b.node
        let relation: 'self' | 'text-child' | 'comment-child' | null = null
        if (node.nodeType === 1 && elementSet.has(node as Element)) {
          relation = 'self'
        } else if (
          (node.nodeType === 3 || node.nodeType === 8) &&
          node.parentElement &&
          elementSet.has(node.parentElement)
        ) {
          relation = node.nodeType === 3 ? 'text-child' : 'comment-child'
        }
        if (!relation) continue
        results.push({
          bindingIndex: i,
          kind: b.kind,
          key: b.key,
          mask: b.mask,
          lastValue: b.lastValue,
          relation,
        })
      }
      return results
    },

    inspectElement(selector: string): ElementReport | null {
      if (typeof document === 'undefined') return null
      const el = document.querySelector(selector)
      if (!el) return null

      const attributes: Record<string, string> = {}
      for (const attr of Array.from(el.attributes)) {
        attributes[attr.name] = attr.value
      }

      const classes = Array.from(el.classList)

      const dataset: Record<string, string> = {}
      if (el instanceof HTMLElement) {
        for (const [key, value] of Object.entries(el.dataset)) {
          if (typeof value === 'string') dataset[key] = value
        }
      }

      const rawText = el.textContent ?? ''
      const text = rawText.length > 1000 ? rawText.slice(0, 1000) : rawText

      const rect = el.getBoundingClientRect()
      const boundingBox = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }

      let computed: ElementReport['computed']
      try {
        const cs = window.getComputedStyle(el)
        computed = {
          display: cs.display,
          visibility: cs.visibility,
          position: cs.position,
          width: rect.width,
          height: rect.height,
        }
      } catch {
        computed = {
          display: 'unknown',
          visibility: 'unknown',
          position: 'unknown',
          width: 0,
          height: 0,
        }
      }

      const rawBindings = api.getBindingsFor(selector)
      const bindings = rawBindings.map((b) => ({
        bindingIndex: b.bindingIndex,
        kind: b.kind,
        mask: b.mask,
        lastValue: b.lastValue,
        relation: b.relation,
      }))

      return {
        selector,
        tagName: el.tagName.toLowerCase(),
        attributes,
        classes,
        dataset,
        text,
        computed,
        boundingBox,
        bindings,
      }
    },

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

    dispatchDomEvent(
      selector: string,
      type: string,
      init?: EventInit,
    ): {
      dispatched: boolean
      messagesProducedIndices: number[]
      resultingState: unknown | null
    } {
      const noOp = { dispatched: false, messagesProducedIndices: [], resultingState: null }
      if (typeof document === 'undefined') return noOp
      const el = document.querySelector(selector)
      if (!el) return noOp

      const preIndex = history.length > 0 ? history[history.length - 1]!.index : -1

      let event: Event
      if (type === 'click' || type === 'mousedown' || type === 'mouseup') {
        event = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          ...(init as MouseEventInit),
        })
      } else if (type === 'keydown' || type === 'keyup' || type === 'keypress') {
        event = new KeyboardEvent(type, {
          bubbles: true,
          cancelable: true,
          ...(init as KeyboardEventInit),
        })
      } else {
        event = new Event(type, { bubbles: true, cancelable: true, ...init })
      }

      el.dispatchEvent(event)
      flushInstance(ci)

      const messagesProducedIndices = history.filter((r) => r.index > preIndex).map((r) => r.index)

      return {
        dispatched: true,
        messagesProducedIndices,
        resultingState: ci.state,
      }
    },

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

    forceRerender(): { changedBindings: number[] } {
      const changed: number[] = []
      const allBindings = ci.allBindings
      for (let i = 0; i < allBindings.length; i++) {
        const b = allBindings[i]!
        if (b.dead) continue
        const next = b.accessor(ci.state)
        if (!Object.is(next, b.lastValue)) {
          changed.push(i)
          b.lastValue = next
          applyBinding(b, next)
        }
      }
      return { changedBindings: changed }
    },

    getEachDiff(sinceIndex?: number): EachDiff[] {
      const all = ci._eachDiffLog?.toArray() ?? []
      if (sinceIndex === undefined) return all
      return all.filter((e) => e.updateIndex >= sinceIndex)
    },

    getScopeTree(opts?: { depth?: number; scopeId?: string }): LifetimeNode {
      const maxDepth = opts?.depth ?? Infinity
      const startScope = opts?.scopeId
        ? findLifetimeById(ci.rootLifetime, opts.scopeId)
        : ci.rootLifetime
      if (!startScope) {
        return { scopeId: '0', kind: 'root', active: false, children: [] }
      }
      return walkLifetime(startScope, 0, maxDepth)
    },

    getDisposerLog(limit?: number): DisposerEvent[] {
      const all = ci._disposerLog?.toArray() ?? []
      if (limit === undefined) return all
      return all.slice(-Math.max(0, limit))
    },

    getBindingGraph(): Array<{ statePath: string; bindingIndices: number[] }> {
      const legend = ci.def.__maskLegend as Record<string, number> | undefined
      if (!legend) return []
      const result: Array<{ statePath: string; bindingIndices: number[] }> = []
      for (const [path, bit] of Object.entries(legend)) {
        const indices: number[] = []
        for (let i = 0; i < ci.allBindings.length; i++) {
          const b = ci.allBindings[i]!
          if ((b.mask & bit) !== 0) indices.push(i)
        }
        result.push({ statePath: path, bindingIndices: indices })
      }
      return result
    },

    getPendingEffects(): PendingEffect[] {
      return ci._pendingEffects?.list() ?? []
    },

    getEffectTimeline(limit?: number): EffectTimelineEntry[] {
      const all = ci._effectTimeline?.toArray() ?? []
      if (limit === undefined) return all
      return all.slice(-Math.max(0, limit))
    },

    mockEffect(match, response, opts) {
      if (!ci._effectMocks) return { mockId: '' }
      return { mockId: ci._effectMocks.add(match, response, Boolean(opts?.persist)) }
    },

    resolveEffect(effectId, response) {
      const pending = ci._pendingEffects?.findById(effectId)
      if (!pending) return { resolved: false }
      const payload = pending.payload as { onSuccess?: (d: unknown) => unknown } | undefined
      if (payload?.onSuccess) {
        const msg = payload.onSuccess(response)
        ci.send(msg as never)
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

    stepBack(n: number, mode: 'pure' | 'live') {
      const rewindDepth = Math.min(Math.max(0, n), history.length)
      const keep = history.slice(0, history.length - rewindDepth)
      const [initialState] = ci.def.init(undefined) as [unknown, unknown[]]
      let state = initialState
      const collectedEffects: unknown[] = []
      for (const record of keep) {
        const [newState, newEffects] = (
          ci.def.update as unknown as (s: unknown, m: unknown) => [unknown, unknown[]]
        )(state, record.msg)
        state = newState
        if (mode === 'live') collectedEffects.push(...newEffects)
      }
      _forceState(ci, state)
      history.length = keep.length
      if (mode === 'live') {
        for (const eff of collectedEffects) {
          if (ci.def.onEffect)
            ci.def.onEffect({ effect: eff as never, send: ci.send, signal: ci.signal })
        }
      }
      return { state, rewindDepth }
    },

    getCoverage(): CoverageSnapshot {
      if (!ci._coverage) return { fired: {}, neverFired: [] }
      const schema = ci.def.__msgSchema as { variants?: Record<string, unknown> } | undefined
      const known = schema?.variants ? Object.keys(schema.variants) : undefined
      return ci._coverage.snapshot(known)
    },

    getCompiledSource(_viewFn?: string): { pre: string; post: string } | null {
      const def = ci.def as unknown as Record<string, unknown>
      const pre = def['__preSource']
      const post = def['__postSource']
      if (typeof pre !== 'string' || typeof post !== 'string') return null
      return { pre, post }
    },

    getMsgMaskMap(): Record<string, number> | null {
      const def = ci.def as unknown as Record<string, unknown>
      const map = def['__msgMaskMap']
      return map != null && typeof map === 'object' ? (map as Record<string, number>) : null
    },

    getBindingSource(bindingIndex: number): { file: string; line: number; column: number } | null {
      const def = ci.def as unknown as Record<string, unknown>
      const sources = def['__bindingSources']
      if (!Array.isArray(sources)) return null
      const entry = (
        sources as Array<{ bindingIndex: number; file: string; line: number; column: number }>
      ).find((s) => s.bindingIndex === bindingIndex)
      return entry ? { file: entry.file, line: entry.line, column: entry.column } : null
    },

    getHydrationReport(): HydrationDivergence[] {
      if (typeof document === 'undefined') return []
      // Find a mounted element that carries the server-rendered HTML attribute.
      // @llui/vike stamps this attribute during SSR so the client can compare.
      const root = document.querySelector('[data-llui-ssr-html]')
      if (!root) return []
      const serverHtml = root.getAttribute('data-llui-ssr-html')
      if (!serverHtml) return []
      const parser = new DOMParser()
      const serverDoc = parser.parseFromString(serverHtml, 'text/html')
      const serverRoot = serverDoc.body.firstChild as Element | null
      if (!serverRoot) return []
      const divergences: HydrationDivergence[] = []
      diffNodes(root, serverRoot, 'root', divergences)
      return divergences
    },

    evalInPage(code: string) {
      const stateBefore = JSON.parse(JSON.stringify(ci.state))
      const historyLenBefore = history.length
      const pendingBefore = new Set((ci._pendingEffects?.list() ?? []).map((p) => p.id))
      const dirtyMaskBefore = lastDirtyMask

      let result: unknown | { error: string }
      try {
        const fn = new Function(`return (${code})`) as () => unknown
        const rv = fn()
        if (rv && typeof rv === 'object' && 'then' in (rv as object)) {
          result = {
            error:
              'llui_eval does not support async expressions in Phase 1. Wrap awaits in an IIFE and expose the result synchronously via globalThis.',
          }
        } else {
          result = rv
        }
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) }
      }

      try {
        flushInstance(ci)
      } catch {
        // Best-effort; user's eval may have left the instance in a weird state
      }

      const stateAfter = ci.state
      const stateDiff = diffStateInternal(stateBefore, stateAfter)
      const stateChanged =
        Object.keys(stateDiff.added).length === 0 &&
        Object.keys(stateDiff.removed).length === 0 &&
        Object.keys(stateDiff.changed).length === 0
          ? null
          : stateDiff

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
          stateChanged,
          newHistoryEntries,
          newPendingEffects,
          dirtyBindingIndices,
        },
      }
    },
  }

  // Intercept update to record transitions
  const originalUpdate = ci.def.update
  ci.def.update = ((state: unknown, msg: unknown) => {
    const [newState, effects] = (
      originalUpdate as (s: unknown, m: unknown) => [unknown, unknown[]]
    )(state, msg)
    const dirty = ci.def.__dirty
      ? (ci.def.__dirty as (o: unknown, n: unknown) => number)(state, newState)
      : -1

    lastDirtyMask = typeof dirty === 'number' ? dirty : -1

    const record: MessageRecord = {
      index: idx,
      timestamp: Date.now(),
      msg,
      stateBefore: state,
      stateAfter: newState,
      effects,
      dirtyMask: lastDirtyMask,
    }

    // _updateCounter and the history index track the same thing —
    // tie them so EachDiff entries emitted during the ensuing Phase 1
    // reconcile carry the same updateIndex as the message record that
    // caused the reconcile. `each.ts` reads `inst._updateCounter` when
    // stamping EachDiff entries.
    ci._updateCounter = idx

    // Coverage: record the discriminant of this message at the SAME
    // index stamped on the MessageRecord above, so tools can cross-
    // reference `getMessageHistory()[i]` with `coverage.fired[v].lastIndex`.
    const variant =
      msg && typeof msg === 'object' && 'type' in (msg as Record<string, unknown>)
        ? String((msg as Record<string, unknown>).type)
        : '<non-discriminant>'
    ci._coverage?.record(variant, idx)

    idx++

    if (history.length >= MAX_HISTORY) history.shift()
    history.push(record)

    return [newState, effects]
  }) as typeof ci.def.update

  // Register in the multi-component registry and point __lluiDebug at the
  // newest mount (so single-component apps keep working unchanged). Tools
  // can switch the active pointer via llui_select_component.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any
  if (!g.__lluiComponents) g.__lluiComponents = {} as Record<string, LluiDebugAPI>
  const componentKey = uniqueName(g.__lluiComponents, ci.def.name)
  g.__lluiComponents[componentKey] = api
  g.__lluiDebug = api
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(api as any).__componentKey = componentKey
}

// Generate a unique key for a component name if it's already taken
// (e.g. same component mounted into multiple containers).
function uniqueName(registry: Record<string, unknown>, name: string): string {
  if (!(name in registry)) return name
  let i = 2
  while (`${name}#${i}` in registry) i++
  return `${name}#${i}`
}
