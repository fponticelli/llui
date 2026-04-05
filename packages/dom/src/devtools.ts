import { flushInstance, type ComponentInstance } from './update-loop'
import { _setDevToolsInstall } from './mount'
import type { Binding } from './types'

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

let relayStarted = false

interface RelayRequest {
  id: string
  method: keyof LluiDebugAPI
  args: unknown[]
}

/**
 * Connect to a local MCP server's WebSocket and forward tool calls to
 * `window.__lluiDebug`. Auto-reconnects on close. Safe to call multiple times
 * (only the first call actually runs).
 */
export function startRelay(port = 5200): void {
  if (relayStarted) return
  relayStarted = true
  if (typeof WebSocket === 'undefined') return

  function connect(): void {
    let ws: WebSocket
    try {
      ws = new WebSocket(`ws://127.0.0.1:${port}`)
    } catch {
      // Unable to open — retry later
      setTimeout(connect, 3000)
      return
    }

    ws.onmessage = (event: MessageEvent) => {
      let req: RelayRequest
      try {
        req = JSON.parse(String(event.data)) as RelayRequest
      } catch {
        return
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api = (globalThis as any).__lluiDebug as LluiDebugAPI | undefined
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

    ws.onclose = () => {
      // Retry until the MCP server is up
      setTimeout(connect, 2000)
    }
    ws.onerror = () => {
      // onclose will fire and handle retry
    }
  }

  connect()
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
  getMessageHistory(): MessageRecord[]
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
}

const MAX_HISTORY = 1000

export function installDevTools(inst: object): void {
  const ci = inst as ComponentInstance
  const history: MessageRecord[] = []
  let idx = 0
  let lastDirtyMask = 0

  const api: LluiDebugAPI = {
    getState: () => ci.state,
    send: (msg) => ci.send(msg as never),
    flush: () => flushInstance(ci),
    getMessageHistory: () => history.slice(),

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
      index: idx++,
      timestamp: Date.now(),
      msg,
      stateBefore: state,
      stateAfter: newState,
      effects,
      dirtyMask: lastDirtyMask,
    }

    if (history.length >= MAX_HISTORY) history.shift()
    history.push(record)

    return [newState, effects]
  }) as typeof ci.def.update

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).__lluiDebug = api
}
