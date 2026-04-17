import { flushInstance, _forceState, type ComponentInstance } from './update-loop.js'
import { _setDevToolsInstall } from './mount.js'
import { _markDisposerLogInstalled } from './scope.js'
import type { Binding } from './types.js'
import { createRingBuffer } from './tracking/each-diff.js'
import { createRingBuffer as createDisposerBuffer } from './tracking/disposer-log.js'
import { createCoverageTracker } from './tracking/coverage.js'
import {
  createRingBuffer as createTimelineBuffer,
  createMockRegistry,
  createPendingEffectsList,
} from './tracking/effect-timeline.js'

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
 *    cases where MCP runs on a non-default port.
 * 2. **Compile-time fallback**: if the status endpoint is unavailable
 *    (404, network error, non-Vite environment), we attempt a single
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

  // Try the Vite middleware first (knows the actual port from the marker file)
  if (typeof fetch !== 'undefined') {
    fetch('/__llui_mcp_status')
      .then((res) => (res.ok ? (res.json() as Promise<{ port: number }>) : null))
      .then((data) => {
        if (data && typeof data.port === 'number') {
          relayPort = data.port
          connectRelay(data.port, true)
        } else {
          // Endpoint replied 404 — MCP not running. Don't fall back to the
          // compile-time port; the HMR event will fire if MCP starts later.
        }
      })
      .catch(() => {
        // Network error or non-Vite environment — fall back to compile-time port
        connectRelay(port, true)
      })
  } else {
    // No fetch available — use the compile-time port directly
    connectRelay(port, true)
  }
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

const MAX_HISTORY = 1000

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
  // `disposeScope` via `findInstance(scope)` — which only works when the
  // rootScope carries an `instance` back-reference.
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
  ci.rootScope.instance = ci
  // Flip the scope-module flag so disposeScope starts walking the parent
  // chain to emit disposer events. Before the first installDevTools call
  // the flag stays false and disposeScope skips findInstance entirely.
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
