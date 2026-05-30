// Signal debug API — makes signal components observable/driveable by the MCP
// relay + agent tooling. Registers into the same global registry the relay reads
// (globalThis.__lluiComponents / __lluiDebug), exposing a SIGNAL-NATIVE surface:
// state, schemas, send, message history, snapshot/restore, search, validate.
//
// Deliberately NOT a port of the legacy binding/mask/scope methods — those are
// legacy-runtime concepts. The relay reports "unknown method" for anything not
// implemented here, so MCP tools degrade gracefully per-component.

import { resolvePath } from './mask.js'
import type { LifetimeNode } from '../types.js'
import type { EachDiff } from '../tracking/each-diff.js'
import type { DisposerEvent } from '../tracking/disposer-log.js'
import type { CoverageSnapshot } from '../tracking/coverage.js'
import type {
  PendingEffect,
  EffectTimelineEntry,
  EffectMatch,
} from '../tracking/effect-timeline.js'

export interface SignalMessageRecord {
  index: number
  timestamp: number
  msg: unknown
  stateBefore: unknown
  stateAfter: unknown
  effects: unknown[]
}

// ── Canonical debug-API contract ────────────────────────────────────
//
// `LluiDebugAPI` is the single source of truth for what an MCP/agent relay
// may call on a mounted component. It survives the legacy-runtime deletion by
// living here, in the signal runtime.
//
// The REQUIRED methods are exactly what `installSignalDebug` registers — every
// signal component implements them. The OPTIONAL methods (`?`) are
// binding/scope/effect-introspection surfaces that are LEGACY-RUNTIME concepts
// (per-binding masks, scope-tree walks, effect timelines). The signal runtime
// does not implement them yet, so they are optional: tools probe for the method
// and degrade gracefully when it is absent (the relay reports "unknown method").

export interface StateDiff {
  added: Record<string, unknown>
  removed: Record<string, unknown>
  changed: Record<string, { from: unknown; to: unknown }>
}

export interface MessageRecord {
  index: number
  timestamp: number
  msg: unknown
  stateBefore: unknown
  stateAfter: unknown
  effects: unknown[]
  /** Present only on the legacy runtime, which computes a dirty mask per update. */
  dirtyMask?: number
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

export interface ComponentInfo {
  name: string
  file: string | null
  line: number | null
  /** Identifies which runtime mounted the component. */
  runtime?: 'signal' | 'legacy'
}

export interface MessageSchemaInfo {
  discriminant: string
  variants: Record<string, Record<string, unknown>>
}

export interface BindingLocation {
  bindingIndex: number
  kind: string
  key: string | undefined
  mask: number
  lastValue: unknown
  /** How the binding's node relates to the matched element. */
  relation: 'self' | 'text-child' | 'comment-child'
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

export interface HydrationDivergence {
  path: string
  kind: 'attribute' | 'text' | 'structural'
  server: unknown
  client: unknown
}

/**
 * The relay-callable debug surface of a mounted LLui component.
 *
 * Required methods are implemented by every runtime (and by
 * `installSignalDebug`). Optional methods are binding/scope/effect
 * introspection that only the legacy runtime provides — callers must
 * feature-detect and degrade when they are absent.
 */
export interface LluiDebugAPI {
  // ── Core (always implemented) ──────────────────────────────────
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
  searchState(query: string): unknown
  getMessageSchema(): MessageSchemaInfo | object | null
  getStateSchema(): object | null
  getEffectSchema(): object | null
  getComponentInfo(): ComponentInfo
  snapshotState(): unknown
  restoreState(snap: unknown): void

  // ── Binding / scope introspection (legacy-only; optional) ──────
  getBindings?(): BindingDebugInfo[]
  whyDidUpdate?(bindingIndex: number): UpdateExplanation
  getMaskLegend?(): Record<string, number> | null
  decodeMask?(mask: number): string[]
  getBindingsFor?(selector: string): BindingLocation[]
  getBindingGraph?(): Array<{ statePath: string; bindingIndices: number[] }>
  getBindingSource?(bindingIndex: number): { file: string; line: number; column: number } | null
  forceRerender?(): { changedBindings: number[] }
  getEachDiff?(sinceIndex?: number): EachDiff[]
  getScopeTree?(opts?: { depth?: number; scopeId?: string }): LifetimeNode
  getDisposerLog?(limit?: number): DisposerEvent[]

  // ── DOM inspection (legacy-only; optional) ─────────────────────
  inspectElement?(selector: string): ElementReport | null
  getRenderedHtml?(selector?: string, maxLength?: number): string
  dispatchDomEvent?(
    selector: string,
    type: string,
    init?: EventInit,
  ): {
    dispatched: boolean
    messagesProducedIndices: number[]
    resultingState: unknown | null
  }
  getFocus?(): {
    selector: string | null
    tagName: string | null
    selectionStart: number | null
    selectionEnd: number | null
  }
  getHydrationReport?(): HydrationDivergence[]

  // ── Effect introspection (legacy-only; optional) ───────────────
  getPendingEffects?(): PendingEffect[]
  getEffectTimeline?(limit?: number): EffectTimelineEntry[]
  mockEffect?(
    match: EffectMatch,
    response: unknown,
    opts?: { persist?: boolean },
  ): { mockId: string }
  resolveEffect?(effectId: string, response: unknown): { resolved: boolean }

  // ── Time-travel / coverage / eval (legacy-only; optional) ──────
  stepBack?(n: number, mode: 'pure' | 'live'): { state: unknown; rewindDepth: number }
  getCoverage?(): CoverageSnapshot
  getCompiledSource?(viewFn?: string): { pre: string; post: string } | null
  getMsgMaskMap?(): Record<string, number> | null
  evalInPage?(code: string): {
    result: unknown | { error: string }
    sideEffects: {
      stateChanged: StateDiff | null
      newHistoryEntries: number
      newPendingEffects: PendingEffect[]
      dirtyBindingIndices: number[]
    }
  }
}

/** Everything the signal debug API needs from a mounted component. Supplied by
 * mountSignalComponent; keeps this module decoupled from the mount internals. */
export interface SignalDebugHooks {
  name: string
  getState: () => unknown
  /** replace state and re-render (restore / time-travel) */
  setState: (s: unknown) => void
  send: (msg: unknown) => void
  /** pure reducer, normalized to [state, effects] (for evalUpdate / dry-run) */
  pureUpdate: (s: unknown, msg: unknown) => [unknown, unknown[]]
  /** captured message log (newest last); installSignalDebug reads it live */
  history: readonly SignalMessageRecord[]
  clearHistory: () => void
  msgSchema?: object
  stateSchema?: object
  effectSchema?: object
  componentMeta?: { file: string; line: number }
}

export interface ValidationError {
  path: string
  message: string
  /** Set by the legacy validator; the signal validator omits these. */
  expected?: string
  received?: string
}

interface MsgSchemaShape {
  discriminant: string
  variants: Record<string, Record<string, string>>
}

/** Minimal message validation against the discriminated-union __msgSchema. */
function validateAgainstSchema(msg: unknown, schema: object | undefined): ValidationError[] | null {
  if (!schema) return null
  const s = schema as MsgSchemaShape
  if (typeof msg !== 'object' || msg === null) {
    return [{ path: '', message: 'message must be an object' }]
  }
  const m = msg as Record<string, unknown>
  const tag = m[s.discriminant]
  if (typeof tag !== 'string' || !(tag in s.variants)) {
    return [
      {
        path: s.discriminant,
        message: `unknown variant ${JSON.stringify(tag)}; expected one of ${Object.keys(s.variants)
          .map((v) => JSON.stringify(v))
          .join(', ')}`,
      },
    ]
  }
  const errors: ValidationError[] = []
  const fields = s.variants[tag]!
  for (const [field, type] of Object.entries(fields)) {
    if (!(field in m)) errors.push({ path: field, message: `missing field (expected ${type})` })
  }
  // Contract is `ValidationError[] | null`: a VALID message is `null`, not `[]`.
  // Callers gate on truthiness (`if (errors) …`) and an empty array is truthy —
  // returning `[]` here made every schema-valid `send_message` report sent:false.
  return errors.length > 0 ? errors : null
}

function clone<T>(v: T): T {
  return typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v))
}

function uniqueName(reg: Record<string, unknown>, base: string): string {
  if (!(base in reg)) return base
  let n = 2
  while (`${base}#${n}` in reg) n++
  return `${base}#${n}`
}

/** Build the signal debug API and register it. Returns an unregister function. */
export function installSignalDebug(hooks: SignalDebugHooks): () => void {
  const api: LluiDebugAPI = {
    getState: () => hooks.getState(),
    send: (msg: unknown) => hooks.send(msg),
    flush: () => {}, // signal send is synchronous — nothing pending
    getMessageHistory: (opts?: { since?: number; limit?: number }) => {
      let out = hooks.history.slice()
      if (opts?.since != null) out = out.filter((r) => r.index >= opts.since!)
      if (opts?.limit != null) out = out.slice(-opts.limit)
      return out
    },
    evalUpdate: (msg: unknown) => {
      const [state, effects] = hooks.pureUpdate(hooks.getState(), msg)
      return { state, effects }
    },
    exportTrace: () => ({
      lluiTrace: 1 as const,
      component: hooks.name,
      generatedBy: '@llui/dom devtools',
      timestamp: new Date().toISOString(),
      entries: hooks.history.map((r) => ({
        msg: r.msg,
        expectedState: r.stateAfter,
        expectedEffects: r.effects,
      })),
    }),
    clearLog: () => hooks.clearHistory(),
    validateMessage: (msg: unknown) => validateAgainstSchema(msg, hooks.msgSchema),
    searchState: (query: string) => resolvePath(hooks.getState(), query),
    getMessageSchema: () => hooks.msgSchema ?? null,
    getStateSchema: () => hooks.stateSchema ?? null,
    getEffectSchema: () => hooks.effectSchema ?? null,
    getComponentInfo: () => ({
      name: hooks.name,
      file: hooks.componentMeta?.file ?? null,
      line: hooks.componentMeta?.line ?? null,
      runtime: 'signal' as const,
    }),
    snapshotState: () => clone(hooks.getState()),
    restoreState: (snap: unknown) => hooks.setState(snap),
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any
  if (!g.__lluiComponents) g.__lluiComponents = {}
  const key = uniqueName(g.__lluiComponents as Record<string, unknown>, hooks.name)
  g.__lluiComponents[key] = api
  g.__lluiDebug = api

  return () => {
    if (g.__lluiComponents?.[key] === api) delete g.__lluiComponents[key]
    if (g.__lluiDebug === api) g.__lluiDebug = undefined
  }
}

// ── MCP relay ───────────────────────────────────────────────────────
//
// Browser-side WebSocket bridge between the MCP server and the live
// `globalThis.__lluiDebug` API that `installSignalDebug` registers.
// Runtime-agnostic — it only reads the global registry, so it works
// identically for any debug API shape. Dev-mode only; the vite-plugin
// emits `startRelay(port)` into compiled dev bundles.
//
// On-demand: tries a SINGLE connection on page load. If it succeeds
// (MCP server already running) the relay stays open and reconnects on
// drop. If it fails, no retry loop — just registers
// `window.__lluiConnect(port?)` so the developer can connect later from
// the console or when the MCP server starts.

let relayPort = 5200
let relayConnected = false

interface RelayRequest {
  id: string
  method: keyof LluiDebugAPI | '__listComponents' | '__selectComponent'
  args: unknown[]
}

function handleRelayMessage(ws: WebSocket, event: MessageEvent): void {
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
  ws.onmessage = (event) => handleRelayMessage(ws, event)
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
 * "no Vite server" (fetch threw). Callers handle these differently.
 */
async function resolveMcpStatus(): Promise<McpStatusResult> {
  let allThrew = true
  for (const path of ['/__llui_mcp_status', '/cdn-cgi/llui_mcp_status']) {
    try {
      const res = await fetch(path)
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

/**
 * Register the MCP relay for this page. Discovery: fetch the Vite
 * plugin's `/__llui_mcp_status` marker for the live port and connect; if
 * unreachable, fall back to the compile-time `port`. No retry loop —
 * `window.__lluiConnect(port?)` is exposed for manual/late connection,
 * and the vite-plugin's `llui:mcp-ready` HMR event also forwards here.
 */
export function startRelay(port = 5200): void {
  relayPort = port
  if (typeof WebSocket === 'undefined') return

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
        connectRelay(port, true)
      }
    })
  } else {
    connectRelay(port, true)
  }
}
