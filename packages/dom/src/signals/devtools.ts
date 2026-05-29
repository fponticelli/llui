// Signal debug API — makes signal components observable/driveable by the MCP
// relay + agent tooling. Registers into the same global registry the relay reads
// (globalThis.__lluiComponents / __lluiDebug), exposing a SIGNAL-NATIVE surface:
// state, schemas, send, message history, snapshot/restore, search, validate.
//
// Deliberately NOT a port of the legacy binding/mask/scope methods — those are
// legacy-runtime concepts. The relay reports "unknown method" for anything not
// implemented here, so MCP tools degrade gracefully per-component.

import { resolvePath } from './mask.js'

export interface SignalMessageRecord {
  index: number
  timestamp: number
  msg: unknown
  stateBefore: unknown
  stateAfter: unknown
  effects: unknown[]
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

interface ValidationError {
  path: string
  message: string
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
  return errors
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
  const api = {
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
      generatedBy: '@llui/dom/signals devtools',
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
